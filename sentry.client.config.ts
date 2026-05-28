// Sentry initialization for the browser runtime.
// Loaded automatically by @sentry/nextjs.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Production: 10% trace sampling is plenty at V1 scale and stays in free tier.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Don't capture user PII in error reports beyond what Sentry's defaults allow.
    sendDefaultPii: false,
    debug: false,
    environment: process.env.NODE_ENV,

    // Avoid noise from common ad-blocker / extension issues
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
    ],
  });
}
