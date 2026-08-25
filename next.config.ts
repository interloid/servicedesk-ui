import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Sentry's ingest host has 3 subdomain labels (o<id>.ingest.<region>.sentry.io).
// CSP host-wildcard matching across labels is inconsistent enough not to trust
// blindly (a `*.sentry.io` wildcard silently breaking Sentry reporting in
// production would undo everything verified in docs/SENTRY.md), so the exact
// host is derived from the DSN instead of guessed.
const sentryIngestHost = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? new URL(process.env.NEXT_PUBLIC_SENTRY_DSN).host
  : null;

// Static (no-nonce) CSP — see docs/CONVENTIONS.md and Next.js's CSP guide for why:
// nonce-based CSP requires every page to render dynamically via proxy.ts (this
// fork's renamed middleware.ts), which would take the homepage and every other
// static route off static generation. 'unsafe-inline' is required for script-src
// because Next.js's App Router injects inline bootstrap/streaming scripts
// (the `__next_f.push(...)` payload) by design — this is Next's own documented
// "without nonces" pattern, not a shortcut taken here.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self'${sentryIngestHost ? ` https://${sentryIngestHost}` : ""};
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'self';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspHeader },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Emit a minimal, self-contained server bundle (.next/standalone) for Docker —
  // only the traced runtime files + node_modules, not the whole repo. See Dockerfile.
  output: "standalone",
  // Pin the build ID when running multiple replicas of the same build (so they all
  // agree and avoid version skew). Reads NEXT_BUILD_ID if set; otherwise returns null,
  // which tells Next.js to use its own per-build default (fine for single-instance).
  generateBuildId: async () => process.env.NEXT_BUILD_ID || null,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT
    ? { project: process.env.SENTRY_PROJECT }
    : {}),
  ...(process.env.SENTRY_AUTH_TOKEN
    ? { authToken: process.env.SENTRY_AUTH_TOKEN }
    : {}),
  silent: true,
  widenClientFileUpload: true,
});
