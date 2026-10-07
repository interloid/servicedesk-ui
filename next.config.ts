import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

/**
 * The only external host `<Image>` is allowed to load from.
 *
 * The portal renders the tenant logo with `next/image`. An unconfigured host
 * there is not a warning: the optimizer answers 400 and the image is simply
 * broken. Rather than allow every hostname (`hostname: "**"`, which would let
 * anyone make our server fetch a URL of their choosing), the pattern is pinned
 * to this project's public storage, which is where an uploaded logo lives.
 * trustedTenantLogoUrl drops anything outside that prefix before it reaches the
 * component, so the two halves agree.
 */
function remotePatterns(): NonNullable<NextConfig["images"]>["remotePatterns"] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!url) {
    return [];
  }

  try {
    const { protocol, hostname } = new URL(url);

    return [
      {
        protocol: protocol === "http:" ? "http" : "https",
        hostname,
        pathname: "/storage/v1/object/public/**",
      },
    ];
  } catch {
    return [];
  }
}

const securityHeaders = [
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
  images: {
    remotePatterns: remotePatterns(),
  },
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
