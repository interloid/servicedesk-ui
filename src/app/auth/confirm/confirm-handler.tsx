"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, MailCheck } from "lucide-react";

import {
  confirmEmailAction,
  exchangeConfirmationCodeAction,
} from "@/features/auth/actions/actions";
import { tenantPath } from "@/lib/tenancy";
import { APP_ROUTES } from "@/lib/routes";
import { Button } from "@/components/ui/button";

type Status = "verifying" | "redirecting" | "error";

export function AuthConfirmHandler() {
  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState<string>("");
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));

    const providerError =
      search.get("error_description") ||
      hash.get("error_description") ||
      search.get("error") ||
      hash.get("error");
    const type = search.get("type") || hash.get("type");
    const tokenHash = search.get("token_hash") || hash.get("token_hash");
    const code = search.get("code") || hash.get("code");
    const codeVerifier = search.get("code_verifier") || hash.get("code_verifier");

    const fail = (errorMessage: string) => {
      setStatus("error");
      setMessage(errorMessage);
    };

    const go = (tenantSlug: string | null | undefined) => {
      setStatus("redirecting");
      const target =
        type === "recovery"
          ? APP_ROUTES.RESET_PASSWORD
          : tenantSlug
            ? tenantPath(tenantSlug, "/tickets")
            : APP_ROUTES.LOGIN;

      window.location.assign(target);
    };

    void (async () => {
      if (providerError) {
        fail(
          "This email link is invalid or has expired. Request a new one.",
        );
        return;
      }

      if (tokenHash) {
        const result = await confirmEmailAction(tokenHash, type);
        if (result.success) {
          go(result.data.tenantSlug);
        } else {
          fail(result.message);
        }
        return;
      }

      if (code) {
        const result = await exchangeConfirmationCodeAction(code, codeVerifier);
        if (result.success) {
          go(result.data.tenantSlug);
        } else {
          fail(result.message);
        }
        return;
      }

      fail(
        "That email link is incomplete. Open it from the email we sent you.",
      );
    })();
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xl">
        {status === "verifying" && (
          <div className="flex flex-col items-center gap-4">
            <LoaderCircle className="size-8 animate-spin text-brand-accent" />
            <p className="text-sm text-slate-500">Verifying your email…</p>
          </div>
        )}

        {status === "redirecting" && (
          <div className="flex flex-col items-center gap-4">
            <MailCheck className="size-10 text-brand-accent" aria-hidden />
            <h1 className="text-xl font-bold text-slate-900">
              Email verified
            </h1>
            <p className="text-sm text-slate-500">
              Taking you to your workspace…
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-4">
            <CircleAlert className="size-10 text-destructive" aria-hidden />
            <h1 className="text-xl font-bold text-slate-900">
              We couldn&apos;t verify that link
            </h1>
            <p className="text-sm text-slate-500">{message}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.assign(APP_ROUTES.LOGIN)}
              className="mt-2 h-11 w-full font-semibold"
            >
              Back to sign in
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}