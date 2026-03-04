# Assessment: Forking Docmost for Full Agent Operability

**Date:** 2026-03-04
**Status:** Assessment (not an implementation plan)
**Prior art:** `~/git/homelab/plans/soft-floating-knuth.md`, `~/git/homelab/docs/doc-management-evaluation.md`

---

## Context

We evaluated Docmost as an Outline replacement in early 2025 and rejected it because "Docmost's API cannot update document content (WebSocket/Tiptap only, confirmed by maintainer April 2025)." The prior plan (`soft-floating-knuth.md`) chose Outline as the single source of truth for agent-human document collaboration.

The user now wants to reassess: **is forking Docmost workable to make all features fully operable by an agent (via MCP or new API endpoints)?** The use case is human/agent document collaboration and an authoritative wiki for all project and git work.

## Ecosystem Survey

Searched GitHub forks (1.1k total), MCP servers, and community projects:

| Project | Status | Relevance |
|---|---|---|
| [MrMartiniMo/docmost-mcp](https://github.com/MrMartiniMo/docmost-mcp) | Active (Jan 2026), MIT | **High** - Working MCP server with 10 tools. Needs `update_page` fix and auth switch. |
| [Forkmost](https://github.com/Vito0912/forkmost) | Winding down (Dec 2025) | Low - Editor additions only (audio, columns, highlights). No API/agent work. |
| [HaruHunab1320/docmost-mcp](https://github.com/HaruHunab1320/docmost-mcp) | Archived (Jan 2026) | Low - "Raven Docs" fork, diverged heavily from upstream. Comprehensive MCP tools but incompatible. |
| [Docmost API docs](https://docmost.com/api-docs) | Official | Reference - Full API documentation with Postman collection. |
| [Webhooks request #1827](https://github.com/docmost/docmost/discussions/1827) | Unanswered | Confirms webhooks are not planned for core. Must build ourselves. |
| [API automation #1390](https://github.com/docmost/docmost/issues/1390) | Closed (resolved) | Confirms user CRUD, group management, space management all work via API. |

**No fork exists with the EE/agent features we need.** The MrMartiniMo MCP server saves ~1 session of MCP development work. Everything else must be built.

## Critical Finding: The April 2025 API Gap Is Resolved

The current Docmost codebase (cloned at `~/git/docmost`, main branch, commit `37355452`) **does** have full REST API support for page content CRUD. This invalidates the primary reason we rejected Docmost.

**Evidence:**

- `apps/server/src/core/page/page.controller.ts:99-166` - `POST /pages/create` accepts `content` (string or object) with `format` (json/markdown/html)
- `apps/server/src/core/page/page.controller.ts:168-203` - `POST /pages/update` accepts `content` with `operation` (append/prepend/replace) and `format`
- `apps/server/src/core/page/services/page.service.ts:251-266` - Content updates route through the Hocuspocus collaboration gateway internally, meaning REST updates are CRDT-aware and won't conflict with concurrent human editors
- `apps/server/src/core/page/services/page.service.ts:909-939` - Format conversion: Markdown -> HTML -> ProseMirror JSON, with validation

An agent can now do:
```
POST /pages/create  { spaceId, title, content: "# Hello", format: "markdown" }
POST /pages/update  { pageId, content: "New section", format: "markdown", operation: "append" }
POST /pages/info    { pageId, format: "markdown" }  // returns content as markdown
```

## API Coverage Assessment (88+ endpoints)

| Capability | API Coverage | Agent-Ready? |
|---|---|---|
| Page CRUD (create/read/update/delete) | Full | Yes - JSON/Markdown/HTML formats |
| Content append/prepend/replace | Full | Yes - via `operation` parameter |
| Page hierarchy (parent/child, move, breadcrumbs) | Full | Yes |
| Page history/versioning | Full | Yes |
| Page duplication (same/cross-space) | Full | Yes |
| Spaces (CRUD, members, roles) | Full | Yes |
| Search (full-text, suggest) | Full (basic), EE for Typesense | Yes |
| Comments (CRUD, resolve) | Full | Yes |
| Attachments (upload, retrieve) | Full | Yes |
| Export (page/space as ZIP) | Full | Yes |
| Import (MD, HTML, Notion, Confluence) | Partial (EE for large files) | Mostly |
| User management | Limited - profile only, no creation API | No |
| Auth - JWT Bearer token | Full | Yes |
| Auth - API keys | EE only (not in open-source) | No (needs fork work) |
| Webhooks/event streams | None | No (needs new development) |
| Labels/tags on documents | None | No (needs new development) |
| Bulk operations | None | No (needs new development) |
| Workspace/user provisioning | Limited | Partial |

## Enterprise Edition Architecture

The EE module is cleanly separated, making it fork-friendly:

- **Server-side:** `apps/server/src/ee/` exists but is **empty** in the open-source repo. The `EeModule` is loaded dynamically via `require('./ee/ee.module')` in `app.module.ts:34`. If absent, the app runs without EE features and throws descriptive errors ("Enterprise module not bundled in this build").

- **Client-side:** All EE UI code **is** included at `apps/client/src/ee/` - API keys UI, SSO config, MFA, audit logs, AI features, page permissions, billing.

- **License check:** `hasLicenseOrEE({ licenseKey, plan, isCloud })` in `common/helpers/utils.ts:94-101`. Simply checks if a license key exists or if it's a cloud business plan. No cryptographic validation in the open-source code; the actual validation lives in the missing `license-check.service.ts` EE module.

**EE features relevant to agent operability:**

| EE Feature | Importance for Agents | Fork Effort |
|---|---|---|
| API Keys | Critical - service account auth | Medium (implement ApiKeyModule) |
| Audit Logs | High - track agent vs human edits | Medium (implement AuditModule) |
| Page-Level Permissions | High - restrict agent access per page | Low (DB schema + CASL rules already exist in open-source) |
| Advanced Search (Typesense) | Medium - better search quality | Medium (integration code, Typesense deployment) |
| SSO/SAML/LDAP | Medium - Authentik integration | Medium |
| AI Features | Low - we have our own AI pipeline | Skip |
| MFA | Low | Skip |
| Billing/Cloud | None | Skip |

## Fork Feasibility: High

**Architecture strengths for forking:**

1. **NestJS modular architecture** - Clean separation of concerns, well-defined module boundaries
2. **Kysely ORM** - Type-safe migrations, no magic. Easy to add new tables/columns
3. **EE is a plug-in** - Create your own `ee.module.ts` without touching core code
4. **TypeScript throughout** - Strong types, good IDE support, maintainable
5. **Standard infrastructure** - PostgreSQL, Redis, S3-compatible storage. Already in our stack
6. **Content format flexibility** - ProseMirror JSON internally, but accepts/returns Markdown and HTML via API
7. **CRDT collaboration** - Yjs/Hocuspocus means REST API updates are collaboration-safe

**Architecture risks:**

1. **Upstream merge burden** - Docmost is actively developed (4 commits in recent history). Keeping a fork current requires ongoing merge work. Mitigation: keep fork changes isolated to `ee/` module and new API endpoints
2. **Hocuspocus dependency** - Content updates route through the Yjs collaboration layer even for REST calls. If Hocuspocus has bugs, content updates break. But this is also a strength (CRDT consistency)
3. **No server-side EE reference implementation** - We have the client-side EE code as a spec, but the server implementation must be written from scratch
4. **Redis required** - Content updates via REST go through `redisSync.handleEvent()`. Redis must be running even for non-collaborative use

## What Needs Building (Fork Work Items)

### Phase 1: Core Agent Operability (MCP server + auth)

1. **Implement API Key module** in `apps/server/src/ee/`
   - Database: `api_keys` table (key hash, user_id, workspace_id, permissions, expiry)
   - JWT strategy already has `JwtType.API_KEY` enum value and stub handling
   - Client-side UI already exists at `apps/client/src/ee/api-key/`
   - Effort: ~1-2 sessions

2. **Build Docmost MCP server** (similar to existing Outline MCP tools)
   - Tools: `docmost_create_page`, `docmost_update_page`, `docmost_search`, `docmost_get_page`, `docmost_list_spaces`, `docmost_list_pages`, `docmost_delete_page`
   - Auth via API key or JWT
   - Content format: accept Markdown, return Markdown (agent-friendly)
   - Effort: ~1 session (straightforward REST wrapper)

3. **Bypass license check** for self-hosted fork
   - Either: implement `isValidEELicense()` to always return true
   - Or: set a license key in workspace config
   - Effort: trivial

### Phase 2: Agent-Aware Features

4. **Document labels/tags system**
   - New `page_labels` and `labels` tables
   - API endpoints: create/list/apply/remove labels
   - Labels for: `[public]`, `[private]`, `[confidential]`, `[agent-authored]`, `[needs-review]`
   - Enables the n8n publication pipeline from `soft-floating-knuth.md`
   - Effort: ~1 session

5. **Webhooks/event notifications**
   - NestJS EventEmitter2 already in use (page created/deleted/moved events)
   - Add webhook registration endpoint + HTTP dispatch on events
   - Events: page.created, page.updated, page.deleted, page.moved, comment.created
   - Effort: ~1 session

6. **User creation/management API**
   - Currently only setup flow creates users
   - Add `POST /users/create` (admin-only) for service account provisioning
   - Effort: ~0.5 session

### Phase 3: Publication Pipeline Integration

7. **Bulk export API** - Export multiple pages/spaces in single request
8. **Page metadata API** - Custom metadata fields per page (publication date, author, category)
9. **n8n integration** - Webhook triggers + Docmost API for the tiered publication pipeline

### Total Estimated Fork Effort

- Phase 1 (core): 3-4 sessions
- Phase 2 (agent features): 2-3 sessions
- Phase 3 (publication): 2-3 sessions

## Docmost vs Outline: Updated Comparison

| Factor | Docmost (Fork) | Outline (Current) |
|---|---|---|
| Content update via API | Yes (now works) | Yes (always worked) |
| Editor quality | TipTap (richer, more extensible) | ProseMirror (solid but less extensible) |
| Real-time collaboration | Yjs/Hocuspocus CRDT | Y.js-based |
| Page hierarchy | Native (parent_page_id, tree) | Collection > Document (flat within collection) |
| Page-level permissions | Supported (CASL-based) | Collection-level only |
| Labels/tags | Not built-in (needs fork work) | Built-in |
| API maturity | 88+ endpoints, good coverage | Mature, well-documented |
| MCP tools | Need building | Already exist and working |
| Search | PostgreSQL FTS (+ Typesense EE) | PostgreSQL FTS |
| Comments | Inline comments on content | Document-level comments |
| Content format | ProseMirror JSON + MD/HTML conversion | Markdown-native |
| Import sources | MD, HTML, Notion, Confluence | MD, Notion, Confluence, more |
| Active development | Yes (active, growing) | Yes (mature, stable) |
| Self-hosted complexity | PostgreSQL + Redis | PostgreSQL + Redis + MinIO |
| Fork maintenance burden | Medium (active upstream) | N/A (no fork needed) |
| Existing deployment | None | Running at wiki.itsa.house |

## Licensing Analysis

**Core (AGPL-3.0):** Fork, modify, deploy freely. AGPL Section 13 requires making modified source available to network users. Hosting the fork on Gitea at git.itsa.house satisfies this (internal Tailscale users can access the repo).

**EE server module:** Not present in the repo. `apps/server/src/ee/` is empty. The proprietary Docmost Enterprise License (`packages/ee/LICENSE`) covers code that Docmost distributes separately to paying customers. We don't have it and won't be using it.

**Our approach:** Write our own module at `apps/server/src/ee/ee.module.ts` that plugs into the documented extension point (`require('./ee/ee.module')` in `app.module.ts:34`). Our code, our copyright, AGPL-licensed as part of the combined work. The client-side EE UI code (API key forms, audit views, etc.) is already in the AGPL-licensed main repo.

**License guard handling:** `hasLicenseOrEE()` just checks `Boolean(licenseKey)`. Set a license key value in the workspace DB row (it's a plain text column, no cryptographic validation in the AGPL code). This unlocks features that gate on `hasLicenseKey` without modifying any core code.

## Decision: Fork Docmost, Run Side-by-Side with Outline

Fork Docmost to Gitea (primary) with GitHub mirror. Run at a separate domain (e.g., `docs2.itsa.house`) alongside Outline at `wiki.itsa.house`. Migrate MCP tools incrementally. Cut over when Docmost reaches feature parity for agent operations.

## Implementation Plan

### Phase 1: Fork Setup + Build Validation (1 session)

1. **Fork to Gitea** at `git.itsa.house/rbrenner/docmost`
   - Add upstream as remote: `git remote add upstream https://github.com/docmost/docmost.git`
   - Add GitHub mirror: `git remote add github git@github.com:rbrenner/docmost.git`
   - Create `fork/main` branch for our changes

2. **Build validation**
   - `pnpm install && pnpm build` - confirm clean build
   - Docker build - confirm image produces
   - Local test: create page via REST API with markdown content, verify in browser

3. **REST API smoke test** (validates the April 2025 gap is truly resolved)
   ```
   # Create page with markdown
   curl -X POST /api/pages/create \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"spaceId":"...","title":"Test","content":"# Hello\nWorld","format":"markdown"}'

   # Update with append
   curl -X POST /api/pages/update \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"pageId":"...","content":"## New Section","format":"markdown","operation":"append"}'

   # Read back as markdown
   curl -X POST /api/pages/info \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"pageId":"...","format":"markdown"}'
   ```

### Phase 2: Custom EE Module + API Keys (1-2 sessions)

1. **Create `apps/server/src/ee/ee.module.ts`** - NestJS module that registers:
   - `ApiKeyModule` - API key CRUD + JWT strategy integration
   - `AuditModule` - Audit log recording (the event emitter hooks already exist in core)

2. **API Key implementation**
   - DB migration: `api_keys` table (id, key_hash, name, user_id, workspace_id, permissions, expires_at, last_used_at)
   - JWT strategy at `core/auth/strategies/jwt.strategy.ts:73` already has `JwtType.API_KEY` handling - implement the missing `apiKeyService.validateToken()`
   - Controller: `POST /api-keys/create`, `POST /api-keys/list`, `POST /api-keys/revoke`
   - Client-side UI already exists at `apps/client/src/ee/api-key/`

3. **Set workspace license key** via direct DB update or migration seed to unlock `hasLicenseOrEE()` gates

### Phase 3: MCP Server (0.5-1 session)

**Existing work:** [MrMartiniMo/docmost-mcp](https://github.com/MrMartiniMo/docmost-mcp) (MIT license, January 2026) already implements core tools: `create_page`, `update_page`, `get_page`, `delete_page`/`delete_pages`, `move_page`, `search`, `list_spaces`, `list_pages`, `list_groups`, `get_workspace`. Handles automatic ProseMirror JSON to Markdown conversion.

**Option A: Adopt MrMartiniMo/docmost-mcp** - Fork the MIT-licensed MCP server, fix `update_page` to use REST `POST /pages/update` with content/operation/format instead of the WebSocket workaround, add missing tools. Lowest effort.

**Option B: Build in agent-tools-mcp** - Add Docmost tools alongside existing Outline tools in `~/git/homelab/services/agent-tools-mcp/src/tools/docmost.ts`. More consistent with our existing infrastructure but more work.

**Fixes and additions needed regardless of approach:**

| Change | Detail |
|---|---|
| Fix `update_page` | Use `POST /pages/update` with `operation: append/prepend/replace` and `format: markdown` instead of WebSocket replacement hack |
| Switch auth | Email/password to API key (once Phase 2 EE module is built) |
| Add `docmost_add_comment` | `POST /comments/create` - inline comments |
| Add `docmost_page_history` | `POST /pages/history` - version tracking |
| Add `docmost_create_space` | `POST /spaces/create` - agent workspace setup |
| Add `docmost_add_label` | Custom endpoint (Phase 4) |
| Add `docmost_remove_label` | Custom endpoint (Phase 4) |
| Add `docmost_export_page` | `POST /pages/export` - export as markdown/html |

### Phase 4: Labels + Webhooks (1-2 sessions)

1. **Labels/tags system**
   - DB migration: `labels` table (id, name, colour, workspace_id) + `page_labels` junction table
   - Controller: `POST /labels/create`, `POST /labels/list`, `POST /pages/add-label`, `POST /pages/remove-label`
   - MCP tools: `docmost_add_label`, `docmost_remove_label`, `docmost_list_labels`
   - Required for the n8n publication pipeline (`[public]`, `[private]`, `[confidential]`)

2. **Webhooks**
   - DB migration: `webhooks` table (id, url, events, secret, workspace_id, active)
   - NestJS EventEmitter2 already fires events (PAGE_CREATED, PAGE_DELETED, etc.) - subscribe and dispatch HTTP
   - Controller: `POST /webhooks/create`, `POST /webhooks/list`, `POST /webhooks/delete`

### Phase 5: k8s Deployment (1 session)

1. **k8s manifests** at `~/git/homelab/k8s/docmost/`
   - Deployment (Docmost container + Redis sidecar)
   - Service + Ingress at `docs2.itsa.house` (Tailscale-only via Traefik)
   - PostgreSQL connection to existing 10.0.6.112 (new `docmost` database)
   - S3 storage via existing MinIO or local PVC
   - ConfigMap/Secret for env vars

2. **Side-by-side validation**
   - Run both Outline and Docmost
   - Test MCP tools against Docmost
   - Validate agent workflows (create, update, search, label)

### Phase 6: Migration + Cutover (1 session, when ready)

1. Export Outline content via API
2. Import into Docmost via REST API (markdown format)
3. Update MCP tool references in agent-tools-mcp
4. Redirect `wiki.itsa.house` to Docmost
5. Keep Outline running for rollback period

## Verification

| Step | Verification |
|---|---|
| Fork + build | `pnpm build` succeeds, Docker image builds |
| REST API | Create/update/read page via curl with markdown content |
| Collaboration safety | Open page in browser, update via API simultaneously, no data loss |
| API keys | Create key via API, use key to authenticate subsequent requests |
| MCP tools | Each tool callable from Claude Code, returns expected data |
| Labels | Apply label via API, query pages by label |
| Webhooks | Register webhook, trigger page event, verify HTTP callback received |
| k8s deployment | `kubectl get pods -n docmost` shows Running, `curl docs2.itsa.house` returns UI |
| Side-by-side | Both Outline and Docmost serve content, MCP tools work against both |

## Timeline Estimate

- **Phase 1** (fork + build validation): 0.5-1 session
- **Phase 2** (EE module + API keys): 1-2 sessions
- **Phase 3** (MCP server, building on MrMartiniMo/docmost-mcp): 0.5-1 session
- **Phase 4** (labels + webhooks): 1-2 sessions
- **Phase 5** (k8s deployment): 1 session
- **Phase 6** (migration): 1 session, deferred until Docmost proves stable

Total: 5-7 sessions to full agent operability with side-by-side deployment.
