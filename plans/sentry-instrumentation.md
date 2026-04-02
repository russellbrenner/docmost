# Sentry Instrumentation Plan

## Context

Docmost (self-hosted fork) has no production error monitoring or performance tracing. The user has Sentry available via the GitHub Education Pack. Instrumenting Docmost gives us production error capture with stack traces, request context (workspaceId, actorId), performance transactions, and user-scoped error attribution — things Trivy/Semgrep/ZAP do not provide (those cover supply chain and code vulnerabilities, not runtime behaviour).

PostHog is already integrated in both the backend (`TelemetryModule`) and frontend (`PostHogProvider` + `posthog-user.tsx`). Sentry follows the same pattern.

---

## Scope

- **Backend** (`apps/server`): `@sentry/nestjs` — error capture + performance tracing, request context from CLS, global exception filter
- **Frontend** (`apps/client`): `@sentry/react` — error boundaries, performance tracing, user identity
- **Config**: environment variables, `EnvironmentService` additions, Vite env exposure

---

## 1. Backend

### 1.1 Install

```bash
cd apps/server && pnpm add @sentry/nestjs @sentry/profiling-node
```

### 1.2 `apps/server/src/instrument.ts` (new file)

Create Sentry init module that MUST be imported before everything else:

```typescript
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production',
  enabled: Boolean(process.env.SENTRY_DSN),
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  profilesSampleRate: 1.0,
  integrations: [nodeProfilingIntegration()],
});
```

### 1.3 `apps/server/src/main.ts`

Add `import './instrument';` as the **first line** of the file (before any NestJS imports). Replace the existing `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers (lines 102-108) with Sentry-aware equivalents that still call `logger.error` but also call `Sentry.captureException`.

### 1.4 `apps/server/src/integrations/environment/environment.service.ts`

Add two methods alongside the existing `getPostHogKey()` method:

```typescript
getSentryDsn(): string | undefined {
  return process.env.SENTRY_DSN;
}

getSentryEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT ?? this.isDevelopment() ? 'development' : 'production';
}
```

### 1.5 Global Exception Filter

Create `apps/server/src/common/filters/sentry-exception.filter.ts`:

```typescript
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Only capture 500s — 4xx are client errors, not bugs
    if (status >= 500) {
      Sentry.captureException(exception);
    }

    throw exception; // re-throw so existing error handling continues
  }
}
```

Register it in `apps/server/src/app.module.ts` as an `APP_FILTER` provider (same pattern as `APP_INTERCEPTOR` for `AuditActorInterceptor`).

### 1.6 Request Context Middleware (CLS → Sentry scope)

Extend `apps/server/src/common/middlewares/audit-context.middleware.ts` to set Sentry scope after populating CLS:

```typescript
import * as Sentry from '@sentry/nestjs';

// After the existing CLS population, add:
Sentry.getCurrentScope().setUser({ id: actorId });
Sentry.getCurrentScope().setTag('workspaceId', workspaceId);
Sentry.getCurrentScope().setTag('actorType', actorType);
```

Only attach when `actorId` is present (authenticated requests).

---

## 2. Frontend

### 2.1 Install

```bash
cd apps/client && pnpm add @sentry/react
```

### 2.2 `apps/client/src/lib/config.ts`

Add alongside the existing PostHog config pattern:

```typescript
export const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
export const SENTRY_ENVIRONMENT = import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined;
export const SENTRY_ENABLED = import.meta.env.VITE_SENTRY_ENABLED === 'true';
```

### 2.3 `apps/client/src/main.tsx`

Call `Sentry.init()` **before** the ReactDOM.createRoot call:

```typescript
import * as Sentry from '@sentry/react';
import { browserTracingIntegration, replayIntegration } from '@sentry/react';
import { SENTRY_DSN, SENTRY_ENABLED, SENTRY_ENVIRONMENT } from './lib/config';

Sentry.init({
  dsn: SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT ?? 'production',
  enabled: SENTRY_ENABLED && Boolean(SENTRY_DSN),
  integrations: [browserTracingIntegration(), replayIntegration()],
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

Wrap the root render with `Sentry.ErrorBoundary` (replaces or wraps the outermost provider, falling back gracefully):

```tsx
root.render(
  <Sentry.ErrorBoundary fallback={<p>An unexpected error occurred.</p>}>
    <BrowserRouter>
      ...existing provider chain...
    </BrowserRouter>
  </Sentry.ErrorBoundary>
);
```

### 2.4 User Identity (`apps/client/src/ee/components/sentry-user.tsx`)

Create alongside `posthog-user.tsx` — a component that reads the current user atom and sets Sentry user context:

```typescript
import * as Sentry from '@sentry/react';
import { useAtomValue } from 'jotai';
import { currentUserAtom } from '@/features/user/atoms/current-user-atom';
import { useEffect } from 'react';

export function SentryUser() {
  const user = useAtomValue(currentUserAtom);

  useEffect(() => {
    if (user) {
      Sentry.setUser({ id: user.id, email: user.email });
    } else {
      Sentry.setUser(null);
    }
  }, [user]);

  return null;
}
```

Mount `<SentryUser />` inside `App.tsx` alongside `<PosthogUser />`.

### 2.5 `apps/client/vite.config.ts`

`VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_ENABLED` are automatically picked up by Vite's `loadEnv()` (prefix `VITE_`). No config change required unless source maps upload is desired — that can be added later via the Sentry Vite plugin.

---

## 3. Environment Variables

Add to deployment secret / k8s ConfigMap in `~/git/homelab/k8s/docmost/`:

| Variable | Backend | Frontend | Notes |
|---|---|---|---|
| `SENTRY_DSN` | ✓ | — | Server-side DSN |
| `SENTRY_ENVIRONMENT` | ✓ | — | e.g. `production` |
| `SENTRY_TRACES_SAMPLE_RATE` | ✓ | — | Default `0.1` |
| `VITE_SENTRY_DSN` | — | ✓ | Client-side (public) DSN |
| `VITE_SENTRY_ENVIRONMENT` | — | ✓ | |
| `VITE_SENTRY_ENABLED` | — | ✓ | `true` in prod builds |

Note: Sentry provides separate DSNs for backend and frontend projects. Create two projects in Sentry: `docmost-server` and `docmost-client`.

---

## 4. Critical Files

| File | Change |
|---|---|
| `apps/server/src/instrument.ts` | Create — Sentry.init() |
| `apps/server/src/main.ts` | Add `import './instrument'` first line; update unhandled rejection handlers |
| `apps/server/src/integrations/environment/environment.service.ts` | Add `getSentryDsn()`, `getSentryEnvironment()` |
| `apps/server/src/common/filters/sentry-exception.filter.ts` | Create — global 500 capture |
| `apps/server/src/app.module.ts` | Register `SentryExceptionFilter` as `APP_FILTER` |
| `apps/server/src/common/middlewares/audit-context.middleware.ts` | Attach workspaceId/actorId to Sentry scope |
| `apps/client/src/main.tsx` | `Sentry.init()` + `ErrorBoundary` wrap |
| `apps/client/src/lib/config.ts` | Add `SENTRY_DSN`, `SENTRY_ENABLED`, `SENTRY_ENVIRONMENT` exports |
| `apps/client/src/ee/components/sentry-user.tsx` | Create — user identity hook |
| `~/git/homelab/k8s/docmost/` | Add env vars to ConfigMap/Secret |

---

## 5. Verification

1. Set `SENTRY_DSN` to the real DSN (from Sentry project settings) and `VITE_SENTRY_ENABLED=true` in a local `.env.local`
2. Run backend: `pnpm --filter server dev` — confirm no startup errors; throw a test error via a route, verify it appears in Sentry Issues
3. Run frontend: `pnpm --filter client dev` — open browser console, verify no Sentry init errors; manually throw via `Sentry.captureException(new Error('test'))` in browser console
4. Log in as a user — verify user ID appears on the event in Sentry
5. Make an authenticated API call — verify `workspaceId` tag appears on the server-side event
6. CI build: `pnpm --filter server build` and `pnpm --filter client build` must pass clean
7. After k8s deploy: trigger a real 500 (e.g. call an endpoint with a malformed UUID that hits the DB) and confirm it surfaces in Sentry with full context
