import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment:
    process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production',
  enabled: Boolean(process.env.SENTRY_DSN),
  tracesSampleRate: parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1',
  ),
  profilesSampleRate: 1.0,
  integrations: [nodeProfilingIntegration()],
});
