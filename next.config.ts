import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const sentryIngestHost = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? new URL(process.env.NEXT_PUBLIC_SENTRY_DSN).host
  : null;

const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : null;

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://www.paypal.com https://www.sandbox.paypal.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""} https://www.paypal.com https://www.sandbox.paypal.com;
  font-src 'self';
  connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}${
    sentryIngestHost ? ` https://${sentryIngestHost}` : ""
  } https://www.paypal.com https://www.sandbox.paypal.com https://api-m.sandbox.paypal.com https://api-m.paypal.com;
  object-src 'none';
  base-uri 'self';
  form-action 'self' https://www.paypal.com https://www.sandbox.paypal.com;
  frame-ancestors 'self';
  frame-src 'self' https://www.paypal.com https://www.sandbox.paypal.com;
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
