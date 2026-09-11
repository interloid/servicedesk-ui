// Content-Security-Policy for document responses, built per request by the
// proxy. script-src allows scripts by a fresh per-request nonce instead of
// 'unsafe-inline', so an inline <script> that reaches the page by injection
// cannot run. Next.js reads the nonce from the request's CSP header while
// rendering and stamps it on its own scripts; 'strict-dynamic' then extends
// that trust to the chunks those scripts load.
//
// Only script-src changed from the previous static policy in next.config.ts.
// style-src keeps 'unsafe-inline': components set inline style attributes,
// which a nonce cannot cover.

const isDev = process.env.NODE_ENV === "development";

const sentryIngestHost = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? new URL(process.env.NEXT_PUBLIC_SENTRY_DSN).host
  : null;

const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : null;

export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

export function buildContentSecurityPolicy(nonce: string): string {
  return `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""} https://www.paypal.com https://www.sandbox.paypal.com;
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
}
