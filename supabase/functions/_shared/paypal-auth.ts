// PayPal OAuth (client_credentials) access tokens, shared by every function
// that talks to PayPal.
//
// A token is valid for hours (`expires_in`, typically ~9h), and edge function
// isolates are reused across requests, so the token is cached in module scope
// and only re-minted once it is about to expire. Without this, every billing
// action and every webhook delivery paid an extra OAuth round trip -- several
// per request on some paths -- and bursts of webhook redeliveries multiplied
// calls against PayPal's own rate limits.

export interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

// Refresh a minute early so a token never expires between being handed out
// and being used.
const EXPIRY_MARGIN_MS = 60_000;

export function createPayPalTokenProvider({
  clientId,
  clientSecret,
  baseUrl,
}: PayPalCredentials): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null;
  // Concurrent callers on a cold or expired cache share one OAuth request
  // instead of each minting their own.
  let inFlight: Promise<string> | null = null;

  const mintToken = async (): Promise<string> => {
    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });

    const responseText = await response.text();
    let data: {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
      message?: string;
    } = {};

    try {
      data = JSON.parse(responseText);
    } catch {
      data = {};
    }

    if (!response.ok || !data.access_token) {
      console.error("PayPal Auth Error:", {
        status: response.status,
        error: data.error,
        description: data.error_description,
        message: data.message,
      });
      throw new Error("Failed to obtain PayPal access token.");
    }

    const lifetimeMs = Number(data.expires_in ?? 0) * 1000;

    cached = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(0, lifetimeMs - EXPIRY_MARGIN_MS),
    };

    return data.access_token;
  };

  return async () => {
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }

    inFlight ??= mintToken().finally(() => {
      inFlight = null;
    });

    return await inFlight;
  };
}
