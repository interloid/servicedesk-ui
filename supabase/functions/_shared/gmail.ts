// Sends one email through the Gmail API as the Google account that granted
// GOOGLE_REFRESH_TOKEN (scope gmail.send). Shared by every function that
// sends mail: email-jobs (queued app mail) and paypal-webhook (invoices).
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, and
// FROM_EMAIL ("addr@gmail.com" or "Name <addr@gmail.com>"), which must be that
// account or one of its verified "Send mail as" aliases -- Gmail rewrites any
// other From to the account's own address.
//
// The access token is cached in module scope (isolates are reused across
// requests) and refreshed shortly before it expires.

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")?.trim();
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")?.trim();
const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN")?.trim();
const FROM_EMAIL = Deno.env.get("FROM_EMAIL")?.trim();

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_TIMEOUT_MS = 15_000;
/** Refresh this long before Google's expiry so a token never lapses mid-send. */
const TOKEN_EXPIRY_MARGIN_MS = 2 * 60 * 1000;
/** Gmail's quota reasons: retrying later is the fix. */
const GMAIL_RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
  "quotaExceeded",
  "RESOURCE_EXHAUSTED",
]);

/**
 * Retrying won't fix it (mail not configured, credentials refused, bad
 * recipient): callers should fail at once instead of retrying.
 */
export class PermanentEmailError extends Error {}

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The ready-to-use From header value. */
  from: string;
};

// Deliberately simple: one @, a dot in the domain, nothing that could break
// out of a header (whitespace, CR/LF, <>, quotes, commas).
const EMAIL_ADDRESS =
  /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** Printable ASCII only: safe to put in a header as it is. */
const PLAIN_HEADER_TEXT = /^[\x20-\x7e]*$/;

let gmailConfig: GmailConfig | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

function utf8Base64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

/**
 * RFC 2047 encoded-words for a header holding non-ASCII text. Each word
 * carries at most 45 UTF-8 bytes (60 base64 chars), so it stays within the
 * 75-char limit, and a character is never split across two words.
 */
function encodedWords(value: string): string {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk = "";

  for (const char of value) {
    if (encoder.encode(chunk + char).length > 45) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  chunks.push(chunk);

  return chunks.map((part) => `=?UTF-8?B?${utf8Base64(part)}?=`).join("\r\n ");
}

/** Subject text: line breaks flattened (no header injection), UTF-8 encoded. */
function encodeHeaderText(value: string): string {
  const flat = value.replace(/[\r\n]+/g, " ").trim();

  return PLAIN_HEADER_TEXT.test(flat) && flat.length <= 900
    ? flat
    : encodedWords(flat);
}

/** FROM_EMAIL is either "addr@example.com" or "Display Name <addr@example.com>". */
function parseFromEmail(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new PermanentEmailError("FROM_EMAIL must be a single line.");
  }

  const named = /^(.*?)\s*<([^<>]+)>$/.exec(value);
  const address = (named ? named[2] : value).trim();
  const name = named ? named[1].trim().replace(/^"(.*)"$/, "$1") : "";

  if (!EMAIL_ADDRESS.test(address)) {
    throw new PermanentEmailError(
      'FROM_EMAIL is not a valid address. Use "you@gmail.com" or "Name <you@gmail.com>".',
    );
  }

  if (!name) {
    return address;
  }

  const displayName = PLAIN_HEADER_TEXT.test(name)
    ? `"${name.replace(/(["\\])/g, "\\$1")}"`
    : encodedWords(name);

  return `${displayName} <${address}>`;
}

/** Missing or malformed config fails the job at once: retrying won't fix it. */
function getGmailConfig(): GmailConfig {
  if (gmailConfig) {
    return gmailConfig;
  }

  const missing = [
    ["GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID],
    ["GOOGLE_CLIENT_SECRET", GOOGLE_CLIENT_SECRET],
    ["GOOGLE_REFRESH_TOKEN", GOOGLE_REFRESH_TOKEN],
    ["FROM_EMAIL", FROM_EMAIL],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new PermanentEmailError(
      `Email sending is not configured. Set ${missing.join(", ")} as Edge Function secrets.`,
    );
  }

  gmailConfig = {
    clientId: GOOGLE_CLIENT_ID!,
    clientSecret: GOOGLE_CLIENT_SECRET!,
    refreshToken: GOOGLE_REFRESH_TOKEN!,
    from: parseFromEmail(FROM_EMAIL!),
  };

  return gmailConfig;
}

/**
 * Exchanges the refresh token for an access token. Only Google's error code
 * and description are kept -- never the request or the token itself.
 */
async function refreshAccessToken(config: GmailConfig): Promise<string> {
  let response: Response;

  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Google token request failed: ${errorMessage(error)}`);
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || typeof body?.access_token !== "string") {
    const code = typeof body?.error === "string" ? body.error : "no error code";
    const description =
      typeof body?.error_description === "string"
        ? ` ${body.error_description.slice(0, 200)}`
        : "";

    // invalid_grant: the refresh token was revoked, or expired (a Testing-mode
    // consent screen expires them after 7 days). invalid_client /
    // unauthorized_client: wrong client ID or secret. A new token is needed.
    if (response.status === 400 || response.status === 401) {
      throw new PermanentEmailError(
        `Google refused the OAuth credentials (${response.status} ${code}):${description} Re-authorize the sending account and update GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.`,
      );
    }

    throw new Error(
      `Google token endpoint returned ${response.status} (${code}).${description}`,
    );
  }

  if (
    typeof body.scope === "string" &&
    !body.scope.split(" ").includes(GMAIL_SEND_SCOPE)
  ) {
    throw new PermanentEmailError(
      `GOOGLE_REFRESH_TOKEN was granted without the ${GMAIL_SEND_SCOPE} scope. Re-authorize with that scope.`,
    );
  }

  const expiresInMs = (Number(body.expires_in) || 3600) * 1000;
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + expiresInMs,
  };

  return body.access_token;
}

/** Cached until shortly before it expires; a batch shares one refresh. */
function getAccessToken(config: GmailConfig): Promise<string> {
  if (
    cachedToken &&
    Date.now() < cachedToken.expiresAt - TOKEN_EXPIRY_MARGIN_MS
  ) {
    return Promise.resolve(cachedToken.value);
  }

  pendingToken ??= refreshAccessToken(config).finally(() => {
    pendingToken = null;
  });

  return pendingToken;
}

/** RFC 2822 multipart/alternative message; both bodies base64 so any UTF-8 is safe. */
function buildMimeMessage(from: string, message: EmailMessage): string {
  const boundary = `=_${crypto.randomUUID().replace(/-/g, "")}`;
  const wrap = (value: string) => value.replace(/.{1,76}/g, "$&\r\n");

  return [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeaderText(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(utf8Base64(message.text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(utf8Base64(message.html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/**
 * A request that throws (timeout, dropped connection) may or may not have
 * reached Gmail, so it is NOT retried here: the job's own retry picks it up.
 */
async function postToGmail(
  raw: string,
  accessToken: string,
): Promise<Response> {
  try {
    return await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Gmail send request failed without a response (it may still have been sent): ${errorMessage(error)}`,
    );
  }
}

/** 429, 5xx and Gmail's quota 403s are retried; anything else won't change. */
async function gmailError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  const reason: string =
    body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "";
  const detail = `Gmail API ${response.status}${reason ? ` ${reason}` : ""}: ${String(
    body?.error?.message ?? "no message",
  ).slice(0, 300)}`;

  if (
    response.status === 429 ||
    response.status >= 500 ||
    (response.status === 403 && GMAIL_RATE_LIMIT_REASONS.has(reason))
  ) {
    return new Error(detail);
  }

  if (response.status === 401) {
    return new PermanentEmailError(
      `${detail} (a freshly refreshed token was refused too; check the gmail.send scope and that the account still exists)`,
    );
  }

  return new PermanentEmailError(detail);
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const config = getGmailConfig();

  if (!EMAIL_ADDRESS.test(message.to)) {
    throw new PermanentEmailError("Invalid recipient address.");
  }

  const raw = bytesToBase64(
    new TextEncoder().encode(buildMimeMessage(config.from, message)),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const token = await getAccessToken(config);
  let response = await postToGmail(raw, token);

  // Revoked or expired early. Gmail refused it outright, so one retry with a
  // fresh token cannot send the email twice.
  if (response.status === 401) {
    await response.body?.cancel();

    if (cachedToken?.value === token) {
      cachedToken = null;
    }

    response = await postToGmail(raw, await getAccessToken(config));
  }

  if (!response.ok) {
    throw await gmailError(response);
  }

  await response.body?.cancel();
}
