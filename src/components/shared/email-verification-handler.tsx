"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { createSupabaseClient } from "@/lib/supabase/client";

const SKIP_TYPES = new Set(["recovery", "invite"]);
// Pages that read their own link params. The login pages also put their own
// `?error=` codes in the URL, which are not email-link failures.
const OWNED_PATHS =
  /\/(reset-password|auth\/callback|auth\/confirm|login|portal\/login)$/;

export function EmailVerificationHandler() {
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;

    const url = window.location;
    const search = new URLSearchParams(url.search);
    const hash = new URLSearchParams(url.hash.slice(1));

    // Supabase's own failure marker only. A bare `?error=` belongs to
    // whichever page set it (a login redirect, a portal error), not to us.
    const providerError = hash.get("error_code") || search.get("error_code");
    const type = hash.get("type") || search.get("type");
    const code = search.get("code") || hash.get("code");
    const tokenHash = search.get("token_hash");
    const accessToken = hash.get("access_token");

    if (!providerError && !code && !tokenHash && !accessToken) {
      return;
    }

    if (OWNED_PATHS.test(url.pathname)) return;

    if (SKIP_TYPES.has(type ?? "")) return;

    handledRef.current = true;

    const cleanUrl = () => {
      window.history.replaceState({}, document.title, url.pathname);
    };

    const finish = (success: boolean, message?: string) => {
      if (success) {
        toast.success("Email verified successfully");
      } else {
        toast.error(message || "Email link is invalid or has expired.");
      }
      cleanUrl();
    };

    const supabase = createSupabaseClient();

    void (async () => {
      if (providerError) {
        toast.error("Email link is invalid or has expired. Request a new one.");
        cleanUrl();
        return;
      }

      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type === "email_change" || type === "email" ? type : "signup",
        });
        finish(!error, error?.message);
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        finish(!error, error?.message);
        return;
      }

      const refreshToken = hash.get("refresh_token");
      if (refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken as string,
          refresh_token: refreshToken,
        });
        finish(!error, error?.message);
      }
    })();
  }, []);

  return null;
}
