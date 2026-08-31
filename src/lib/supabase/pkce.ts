import "server-only";

import { createHash, randomBytes } from "crypto";

import { env } from "@/config/env";

function getCredentials() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase is not configured.");
  }

  return { url, key };
}

export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  return { verifier, challenge };
}

export function appendQueryParam(url: string, key: string, value: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

type SignUpWithPkceParams = {
  email: string;
  password: string;
  userData?: Record<string, unknown>;
  emailRedirectTo: string;
};

export async function signUpWithPkce({
  email,
  password,
  userData,
  emailRedirectTo,
}: SignUpWithPkceParams) {
  const { url, key } = getCredentials();
  const { verifier, challenge } = createPkcePair();
  const redirectTo = appendQueryParam(
    emailRedirectTo,
    "code_verifier",
    verifier,
  );

  const response = await fetch(
    `${url}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        data: userData ?? {},
        code_challenge: challenge,
        code_challenge_method: "s256",
      }),
    },
  );

  const json = await response.json().catch(() => ({}));
  const userId = json?.user?.id ?? json?.id;

  if (!response.ok || typeof userId !== "string") {
    throw new Error(
      json?.msg ||
        json?.error_description ||
        "Failed to create authentication user.",
    );
  }

  return {
    userId,
    requiresEmailConfirmation: !json?.access_token,
  };
}

export async function exchangePkceAuthCode(code: string, codeVerifier: string) {
  const { url, key } = getCredentials();

  const response = await fetch(`${url}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_code: code,
      code_verifier: codeVerifier,
    }),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok || typeof json?.access_token !== "string") {
    throw new Error(
      json?.msg ||
        json?.error_description ||
        "This email link is invalid or has expired. Request a new one.",
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
  };
}
