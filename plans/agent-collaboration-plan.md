# Plan: Docmost Agent Collaboration — Full CRUD API + Granular Editing

## Context

After syncing our Docmost fork with upstream main, we need to close the gap between what human editors can do (edit specific words, sentences, sections in real-time) and what agents can do via REST API (currently limited to replace-all, append, prepend). The goal is agents as true collaborators: attributed edits, granular document manipulation, and properly tuned persistence.

The existing REST update flow is already CRDT-safe — it goes through HocusPocus direct connections and Yjs transactions. We extend this pattern rather than inventing new ones.

## Phase 1: Persistence Tuning + Agent Identity (config only, no code)

### 1a. HocusPocus Debounce — Keep at 10s (DO NOT increase to 2min)

**Why not 2 minutes**: The 10s `debounce` in `collaboration.gateway.ts:49` controls how often the in-memory Yjs CRDT state flushes to PostgreSQL. It is NOT the "auto save" interval visible to users. Increasing to 120s means up to 2 minutes of collaborative edits lost on server/pod crash — the Yjs state lives only in RAM and Redis until `onStoreDocument` fires. With our single-node k3s setup, that risk is unacceptable.

What the user probably perceives as "auto save" is the **history snapshot interval** (5 minutes, in `collaboration/constants.ts`). The 10s debounce is invisible to users — it just determines DB write frequency during active editing.

**Recommendation**: Leave debounce at 10s. Optionally make it configurable via env var for future tuning without rebuilds.

### 1b. Agent User Attribution (mechanism works, provisioning gap exists)

The REST API authenticates via JWT. The `@AuthUser()` decorator injects the authenticated user. `page.service.ts:update()` adds `user.id` to `contributorIds` and sets `lastUpdatedById`. The collaboration handler passes user context into `withYdocConnection`, so `onStoreDocument` picks up `context.user.id`. **The attribution mechanism is sound.**

**The gap**: There is no API endpoint to create agent users programmatically. The current `POST /api/api-keys/create` creates a key tied to the **authenticated user** (`creatorId: user.id`), so an admin can only create keys for themselves. For per-agent tokens (each agent has its own identity), we need:

1. A way to create user accounts for agents (e.g., `research-agent@agents.itsa.house`)
2. A way to create API keys tied to those agent users (not the admin)

This is addressed in Phase 2 (Agent Provisioning module).

### 1c. DNS: agents.itsa.house

User will set up `agents.itsa.house` as a domain. Agent user emails will follow the pattern `{agent-name}@agents.itsa.house`. No MX records needed since these are not real mailboxes; the email is purely an identifier within Docmost's user system.

---

## Phase 2: EE Agent Provisioning Module (`apps/server/src/ee/agent-provision/`)

### Problem

The existing user creation paths require either:
- Interactive signup (browser-based, needs password + email verification)
- Workspace invitation (sends email, requires acceptance)
- Direct DB insert (not API-accessible)

The existing API key creation (`POST /api/api-keys/create`) always ties the key to the authenticated user's ID. An admin cannot create an API key for a different user.

### Solution: Agent Provisioning Endpoint

New EE module at `apps/server/src/ee/agent-provision/` with a single endpoint:

**`POST /api/agents/provision`** (requires admin role + EE license)

```typescript
// DTO
export class ProvisionAgentDto {
  @IsString() name: string;           // e.g. "Research Agent"
  @IsEmail() email: string;           // e.g. "research-agent@agents.itsa.house"
  @IsOptional() @IsString() role?: string;  // default 'member'
  @IsOptional() @IsArray() spaceIds?: string[];  // spaces to add agent to
}

// Response
{
  user: { id, name, email, role, workspaceId },
  apiKey: { id, name, token }  // long-lived API token (100yr, no expiry)
}
```

### Implementation

The service:
1. Validates caller is workspace admin (CASL check)
2. Creates user via `UserRepo.insertUser()` with no password (agents don't log in via browser)
3. Adds user to workspace via `WorkspaceService.addUserToWorkspace()`
4. Adds user to default group via `GroupUserRepo.addUserToDefaultGroup()`
5. Optionally adds user to specified spaces via `SpaceMemberRepo`
6. Creates API key via `ApiKeyService.createApiKey()` with `creatorId` set to the **new agent user's ID** (not the admin's)
7. Returns the user record and API token

**Key change**: The `ApiKeyService.createApiKey()` already accepts a `creatorId` parameter, so we can pass the new agent user's ID. No changes to ApiKeyService needed.

### Database: `agent_registry` table

New migration (`20260401T120000-agent-registry.ts`):

```
agent_registry
  id          uuid PK (gen_uuid_v7)
  name        varchar NOT NULL          -- display name, e.g. "Research Agent"
  slug        varchar NOT NULL          -- machine name, e.g. "research-agent"
  user_id     uuid NOT NULL FK users.id ON DELETE CASCADE
  api_key_id  uuid NOT NULL FK api_keys.id ON DELETE CASCADE
  token       text NOT NULL             -- the JWT string (long-lived, 100yr)
  workspace_id uuid NOT NULL FK workspaces.id ON DELETE CASCADE
  created_at  timestamptz NOT NULL DEFAULT now()
  updated_at  timestamptz NOT NULL DEFAULT now()
  deleted_at  timestamptz

  UNIQUE(workspace_id, slug)
  INDEX(workspace_id, deleted_at)
```

**Why store the JWT token**: The `api_keys` table stores the key metadata, but the JWT string is generated once at creation and returned. It cannot be reconstructed (different `iat` each time). Storing it in `agent_registry` means the MCP server can look it up at any time.

### API Endpoints

**`POST /api/agents/provision`** (admin only, EE license required)
- Creates user, API key, and agent_registry entry in one transaction
- Returns `{ agent: { id, name, slug, email }, token }`

**`GET /api/agents/registry`** (admin only, EE license required)
- Returns all active agents with their tokens for the workspace
- Response: `{ agents: [{ slug, name, email, token, userId, lastUsedAt }] }`
- Content-mcp calls this at startup and caches the result

**`POST /api/agents/revoke`** (admin only)
- Soft-deletes the agent_registry entry, revokes the API key, deactivates the user

**`POST /api/agents/rotate-token`** (admin only)
- Generates a new API key + JWT for an existing agent, updates agent_registry
- Revokes the old API key

### Module structure

```
apps/server/src/ee/agent-provision/
  agent-provision.module.ts
  agent-provision.controller.ts
  agent-provision.service.ts
  agent-provision.dto.ts
  agent-registry.repo.ts           -- Kysely queries for agent_registry table

apps/server/src/database/migrations/
  20260401T120000-agent-registry.ts  -- new migration
```

### Content-MCP: Multi-Agent Token Routing

The content-mcp server needs to route API calls through different agent identities. Changes to `~/git/homelab/services/content-mcp/`:

**Config** (`config.ts`):
```typescript
// Existing: DOCMOST_API_TOKEN remains as the admin/default token
// New: on startup, fetch agent registry and build token map
DOCMOST_URL: string;
DOCMOST_API_TOKEN: string;       // admin token (used for provisioning + default)
DOCMOST_AGENT_CACHE_TTL: number; // cache TTL in seconds, default 300
```

**Agent token cache** (`agents/agent-cache.ts`):
- On first use (or cache miss), calls `GET /api/agents/registry` using the admin token
- Caches `slug → token` mapping in memory with TTL
- Provides `getTokenForAgent(slug: string): string | null`
- Falls back to admin token if slug not found

**Tool parameter**: All Docmost tools gain an optional `as_agent` parameter:
```typescript
as_agent: z.string().optional().describe(
  "Agent slug to act as (e.g. 'research-agent'). "
  + "Uses the agent's own API token for attribution. "
  + "Omit to use the default admin identity."
)
```

**Request routing** (`docmostPost` function):
```typescript
async function docmostPost(cfg: Config, path: string, body: Record<string, unknown> = {}, agentSlug?: string) {
  const token = agentSlug
    ? await agentCache.getTokenForAgent(agentSlug) ?? cfg.DOCMOST_API_TOKEN
    : cfg.DOCMOST_API_TOKEN;
  // ... rest of fetch with Authorization: Bearer ${token}
}
```

### MCP Tools

Add to content-mcp:

**`docmost_provision_agent`** — Create an agent with API token:
```
Parameters: name, email (must be @agents.itsa.house), role (default 'member'), space_ids (optional)
Returns: { slug, user_id, email, api_token }
Side effect: refreshes the agent token cache
```

**`docmost_list_agents`** — List all provisioned agents:
```
Returns: [{ slug, name, email, last_used_at }]
```

**`docmost_revoke_agent`** — Revoke an agent's access:
```
Parameters: slug
```

### Files
- `apps/server/src/ee/agent-provision/agent-provision.module.ts` — NEW
- `apps/server/src/ee/agent-provision/agent-provision.controller.ts` — NEW
- `apps/server/src/ee/agent-provision/agent-provision.service.ts` — NEW
- `apps/server/src/ee/agent-provision/agent-provision.dto.ts` — NEW
- `apps/server/src/ee/agent-provision/agent-registry.repo.ts` — NEW
- `apps/server/src/database/migrations/20260401T120000-agent-registry.ts` — NEW
- `apps/server/src/ee/ee.module.ts` — add AgentProvisionModule import
- `~/git/homelab/services/content-mcp/src/agents/agent-cache.ts` — NEW
- `~/git/homelab/services/content-mcp/src/config.ts` — extend with cache TTL

---

## Phase 3: EE Granular Editing Module (all new code in `apps/server/src/ee/`)

### Architecture: EE module as plugin

All new code lives in `apps/server/src/ee/granular-edit/` to keep our fork's additions isolated from upstream core. This follows the same pattern as our existing EE modules (ApiKey, Label, Webhook). The EE module imports `CollaborationModule` (which exports `CollaborationGateway`) to access the Yjs collaboration layer.

**Why EE, not core**: Core Docmost files stay untouched. On upstream sync, we only merge core; our EE additions never conflict. The EE module is loaded dynamically via `require('./ee/ee.module')` in `app.module.ts:32`.

### Module structure

```
apps/server/src/ee/granular-edit/
  granular-edit.module.ts       — NestJS module, imports CollaborationModule + PageModule
  granular-edit.controller.ts   — POST /api/pages/granular-update endpoint
  granular-edit.service.ts      — orchestrates operations, calls collaboration gateway
  granular-edit.dto.ts          — DTOs for all three operation types
  yjs/
    fragment-utils.ts           — Yjs XmlFragment traversal utilities
    find-replace.ts             — find_replace operation logic
    section-ops.ts              — replace_section + insert_after logic
  __tests__/
    fragment-utils.spec.ts      — unit tests
    find-replace.spec.ts
    section-ops.spec.ts
    granular-edit.e2e-spec.ts   — integration tests
```

### 2a. Yjs Utility Functions (`ee/granular-edit/yjs/fragment-utils.ts`)

Building on existing traversal patterns (`applyMarkToYFragment` in `collaboration/yjs.util.ts:56-95`):

```
findTextInFragment(fragment, searchText, matchCase, occurrence)
  → { textNode: Y.XmlText, offset: number } | null

findHeadingByText(fragment, text)
  → { index: number, element: Y.XmlElement, level: number } | null

findNodeById(fragment, nodeId)
  → { index: number, element: Y.XmlElement } | null

getSectionBoundaries(fragment, headingIndex, headingLevel)
  → { start: number, length: number }
  // start = index after heading, length = count of nodes until next heading of same/higher level or end

extractTextFromXmlElement(element)
  → string  // plain text content of an XmlElement and its children
```

**Key detail**: The UniqueID extension (`collaboration.util.ts:61-63`) assigns `id` attributes to `heading` and `paragraph` nodes. On the Yjs side, these are `XmlElement` attributes readable via `element.getAttribute('id')`. This gives us stable identifiers for node-level targeting.

### 2b. Operation Implementations

**`find_replace`** (`ee/granular-edit/yjs/find-replace.ts`):
- Walk XmlText nodes in the fragment using the existing traversal pattern
- Find target text at the specified occurrence
- Call `xmlText.delete(offset, findText.length)` then `xmlText.insert(offset, replaceText)`
- Return match count for client feedback

**`replace_section`** (`ee/granular-edit/yjs/section-ops.ts`):
- Find the heading by text or UniqueID
- Determine section boundaries (heading index to next same-or-higher-level heading)
- Delete content nodes between boundaries (keep the heading itself)
- Insert new ProseMirror-to-Yjs elements at the deletion point using `prosemirrorNodeToYElement()` from `collaboration.util.ts:173`

**`insert_after`** (`ee/granular-edit/yjs/section-ops.ts`):
- Find target node by heading text or UniqueID
- Insert new elements at `targetIndex + 1` in the fragment

### 2c. Controller + Service (`ee/granular-edit/`)

**DTO** (`granular-edit.dto.ts`):

```typescript
export class GranularEditDto {
  @IsString()
  pageId: string;

  @IsIn(['find_replace', 'replace_section', 'insert_after'])
  operation: 'find_replace' | 'replace_section' | 'insert_after';

  // find_replace fields
  @ValidateIf(o => o.operation === 'find_replace')
  findText?: string;

  @ValidateIf(o => o.operation === 'find_replace')
  replaceText?: string;

  @IsOptional()
  matchCase?: boolean;  // default false

  @IsOptional()
  occurrence?: number;  // default 1, -1 for all

  // section operation fields
  @ValidateIf(o => ['replace_section', 'insert_after'].includes(o.operation))
  sectionIdentifier?: string;

  @IsOptional()
  @IsIn(['text', 'id'])
  identifierType?: 'text' | 'id';  // default 'text'

  // content for replace_section and insert_after
  @ValidateIf(o => ['replace_section', 'insert_after'].includes(o.operation))
  content?: string | object;

  @ValidateIf(o => o.content !== undefined)
  @IsIn(['json', 'markdown', 'html'])
  format?: 'json' | 'markdown' | 'html';
}
```

**Controller** (`granular-edit.controller.ts`):
- `POST /api/pages/granular-update` — new endpoint, uses `@UseGuards(JwtAuthGuard)`
- Validates permissions via `PageAccessService.validateCanEdit()`
- Delegates to `GranularEditService`

**Service** (`granular-edit.service.ts`):
- Injects `CollaborationGateway` (from CollaborationModule)
- For `find_replace`: opens direct connection, calls `findTextInFragment` + delete/insert in a `transact()`
- For `replace_section`/`insert_after`: parses content via `parseProsemirrorContent()` (reuses pattern from `page.service.ts`), then opens direct connection and applies Yjs mutations
- Updates `lastUpdatedById` and `contributorIds` on the page record

### 2d. Register in EE Module

Add `GranularEditModule` to `ee.module.ts` imports:
```typescript
@Module({
  imports: [ApiKeyModule, EeAuditModule, LabelModule, WebhookModule, GranularEditModule],
})
export class EeModule {}
```

### 2e. Error Responses

Return structured errors (not 500s):
- `find_replace`: text not found → 404 with `{ message: "Text not found", searchedFor: findText }`
- `replace_section`/`insert_after`: heading/node not found → 404 with identifier details
- Multiple heading matches when using text identifier → 400 with `{ message: "Ambiguous: N headings match", count: N, suggestion: "Use identifierType: 'id'" }`

### Files (all new, no core files modified)
- `apps/server/src/ee/granular-edit/granular-edit.module.ts`
- `apps/server/src/ee/granular-edit/granular-edit.controller.ts`
- `apps/server/src/ee/granular-edit/granular-edit.service.ts`
- `apps/server/src/ee/granular-edit/granular-edit.dto.ts`
- `apps/server/src/ee/granular-edit/yjs/fragment-utils.ts`
- `apps/server/src/ee/granular-edit/yjs/find-replace.ts`
- `apps/server/src/ee/granular-edit/yjs/section-ops.ts`
- `apps/server/src/ee/ee.module.ts` (add import)

---

## Phase 4: Content-MCP Tool Updates

### Location: `~/git/homelab/services/content-mcp/src/tools/docmost.ts`

### 4a. Agent management tools (covered in Phase 2)

`docmost_provision_agent`, `docmost_list_agents`, `docmost_revoke_agent` are defined in Phase 2 alongside the agent registry.

### 4b. Add `as_agent` parameter to ALL existing Docmost tools

Every tool (search, get_page, create_page, update_page, delete, move, etc.) gains the optional `as_agent` parameter. This routes through the agent token cache, so any tool call can be attributed to a specific agent.

### 4c. Add dedicated MCP tools for granular editing

All three call the new EE endpoint `POST /api/pages/granular-update`.

**`docmost_find_replace`** — Find and replace text in a page:
```
Parameters: page_id, find_text, replace_text, match_case (default false), occurrence (default 1, -1 for all)
Calls: POST /api/pages/granular-update { pageId, operation: 'find_replace', findText, replaceText, matchCase, occurrence }
```

**`docmost_replace_section`** — Replace content under a heading:
```
Parameters: page_id, section_identifier, identifier_type (text|id, default text), content (markdown)
Calls: POST /api/pages/granular-update { pageId, operation: 'replace_section', sectionIdentifier, identifierType, content, format: 'markdown' }
```

**`docmost_insert_after`** — Insert content after a heading/node:
```
Parameters: page_id, after_identifier, identifier_type (text|id, default text), content (markdown)
Calls: POST /api/pages/granular-update { pageId, operation: 'insert_after', sectionIdentifier, identifierType, content, format: 'markdown' }
```

### 4d. Build and deploy content-mcp

- Build via `bun build` in `~/git/homelab/services/content-mcp/`
- Push image to `git.itsa.house/homelab/content-mcp:latest`
- Restart content-mcp deployment in k8s

---

## Phase 5: Verification

### Testing strategy

1. **Unit tests** for Yjs utilities (Phase 2): build Y.Doc from known ProseMirror JSON, run utility functions, verify results
2. **Integration tests** for collaboration handler: create page via API, apply each operation, read back and verify
3. **E2E test via MCP tools**: use content-mcp tools to create a page, then use find_replace/replace_section/insert_after, verify content
4. **Concurrent edit test**: open a human WebSocket session while sending REST API granular edits, verify CRDT merge produces correct result

### Manual verification checklist

- [ ] Provision agent via `POST /api/agents/provision` → user created with @agents.itsa.house email
- [ ] Provisioned agent's API token authenticates successfully against Docmost REST API
- [ ] Create page using provisioned agent's token → page creator shows agent name
- [ ] `find_replace` a word → verify change in browser
- [ ] `replace_section` under a heading → verify section updated, other sections untouched
- [ ] `insert_after` a heading → verify new content appears in correct position
- [ ] Check contributor list shows agent user after API edits (not admin)
- [ ] Open page in browser during agent API edit → verify no conflicts, live update visible
- [ ] History shows agent edits with correct attribution (agent name, not admin)
- [ ] MCP `docmost_provision_agent` tool creates agent and returns working token

---

## Critical Files Summary

| File | Change | Location |
|------|--------|----------|
| **Agent Provisioning (EE)** | | |
| `ee/agent-provision/agent-provision.module.ts` | Agent provisioning module | NEW |
| `ee/agent-provision/agent-provision.controller.ts` | /api/agents/* endpoints | NEW |
| `ee/agent-provision/agent-provision.service.ts` | User + API key + registry | NEW |
| `ee/agent-provision/agent-provision.dto.ts` | Request validation | NEW |
| `ee/agent-provision/agent-registry.repo.ts` | DB queries for agent_registry | NEW |
| `database/migrations/20260401T120000-agent-registry.ts` | agent_registry table | NEW |
| **Granular Editing (EE)** | | |
| `ee/granular-edit/granular-edit.module.ts` | NestJS module definition | NEW |
| `ee/granular-edit/granular-edit.controller.ts` | POST /api/pages/granular-update | NEW |
| `ee/granular-edit/granular-edit.service.ts` | Orchestration layer | NEW |
| `ee/granular-edit/granular-edit.dto.ts` | Request validation | NEW |
| `ee/granular-edit/yjs/fragment-utils.ts` | Yjs fragment traversal utilities | NEW |
| `ee/granular-edit/yjs/find-replace.ts` | find_replace operation | NEW |
| `ee/granular-edit/yjs/section-ops.ts` | replace_section + insert_after | NEW |
| **EE Module Root** | | |
| `ee/ee.module.ts` | Add AgentProvisionModule + GranularEditModule | EDIT (2 lines) |
| **Content-MCP (homelab)** | | |
| `content-mcp/src/agents/agent-cache.ts` | Token registry + cache | NEW |
| `content-mcp/src/config.ts` | Add cache TTL config | EDIT |
| `content-mcp/src/tools/docmost.ts` | Add as_agent to all tools + 6 new tools | EDIT |

**Zero core Docmost files modified.** All server-side changes are new files in the EE module, one migration, and two import lines in `ee.module.ts`.

## Existing Code to Reuse (import, not copy)

- `CollaborationGateway.openDirectConnection()` — via NestJS DI from `CollaborationModule` export
- `prosemirrorNodeToYElement()` in `collaboration.util.ts:173` — converts PM JSON nodes to Yjs elements
- `applyMarkToYFragment()` traversal pattern in `yjs.util.ts:56-95` — basis for text search logic
- `TiptapTransformer.toYdoc()` / `TiptapTransformer.fromYdoc()` — round-trip conversion for testing
- `parseProsemirrorContent()` pattern from `page.service.ts:909-938` — markdown/html to PM JSON (replicate in EE service)
- `PageAccessService.validateCanEdit()` — permission checks via import

## Out of Scope

- WebSocket-based agent editing (agents use REST, humans use WebSocket; both go through Yjs)
- Phase 4 of the multi-workspace plan (second content-mcp for jia.itsa.house) — separate task
- MX records for agents.itsa.house (no actual email delivery needed; the domain is an identifier namespace only)
- Agent-to-agent delegation (agents don't provision other agents in this phase; admin provisions all)
