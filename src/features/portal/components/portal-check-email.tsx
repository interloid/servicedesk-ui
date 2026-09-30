"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Mail,
  MonitorSmartphone,
  RotateCw,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requestSignInLinkAction } from "@/features/portal/actions/portal.actions";
import { PortalSplit } from "@/features/portal/components/portal-split";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import { portalToastResult } from "@/features/portal/portal-toast";

/**
 * Terminal screen for the magic-link flow. There is nothing to type here — the
 * customer leaves for their inbox and comes back through
 * /portal/auth/callback, which is where the session is actually created.
 *
 * Read order: the icon says what happened, the address says to whom, the note
 * says where to open it, and the two buttons are the only things to press. The
 * address is the one thing worth being able to check at a glance, so it gets a
 * chip of its own instead of being buried mid-sentence — a customer who typed
 * the wrong address recognises that here, before waiting for a mail that will
 * never come, rather than on a login page with no memory of it.
 */
export function PortalCheckEmail({
  tenantSlug,
  email,
}: {
  tenantSlug: string;
  email: string;
}) {
  const router = useRouter();

  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [isResending, setIsResending] = useState(false);

  async function resend() {
    setError(undefined);
    setNotice(undefined);
    setIsResending(true);

    const result = await requestSignInLinkAction(tenantSlug, { email });

    setIsResending(false);

    if (result.success) {
      // The inline notice below already reads as status (role="status"), and
      // this is a terminal screen in the sign-in flow -- a toast saying "sent
      // again" would only repeat the line above the button.
      setNotice(`We sent another link to ${email}.`);
      return;
    }

    setError(result.message);
    portalToastResult(result);
  }

  return (
    <PortalSplit>
      <span
        aria-hidden
        className="flex size-11 items-center justify-center rounded-xl bg-brand-accent/10 text-brand-accent"
      >
        <Mail className="size-5" />
      </span>

      <h1 className="mt-4 text-2xl font-bold tracking-tight text-balance text-foreground">
        Check your inbox
      </h1>

      <p className="mt-1.5 text-sm leading-[1.6] text-muted-foreground">
        We sent a sign-in link to
      </p>

      <p className="mt-2 flex items-center gap-2.5 rounded-xl border bg-muted/40 px-3.5 py-3 text-sm font-semibold text-foreground">
        <Mail aria-hidden className="size-4 shrink-0 text-brand-accent" />
        <span className="min-w-0 wrap-break-word">{email}</span>
      </p>

      <p className="mt-4 flex gap-2.5 text-xs leading-5 text-muted-foreground">
        <MonitorSmartphone
          aria-hidden
          className="mt-px size-4 shrink-0 text-brand-accent"
        />
        <span>
          <span className="font-semibold text-foreground">
            Open it on this device.
          </span>{" "}
          The link signs you in on the browser that asked for it. If you open it
          somewhere else, come back here and send a new one.
        </span>
      </p>

      {error ? (
        <Alert
          variant="destructive"
          className="mt-5 rounded-[10px] px-3.5 py-3"
        >
          <CircleAlert className="size-4.5" aria-hidden />
          <AlertDescription className="text-sm leading-[1.55]">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="mt-5 flex items-center gap-2 rounded-[10px] bg-brand-badge px-3.5 py-2.5 text-sm font-semibold text-brand-badge-foreground"
        >
          <CheckCircle2 aria-hidden className="size-4 shrink-0" />
          {notice}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2.5">
        <Button
          type="button"
          size="lg"
          onClick={() => void resend()}
          disabled={isResending}
          className="h-11 w-full px-5 font-semibold"
        >
          {isResending ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <RotateCw aria-hidden className="size-4" />
              Resend link
            </>
          )}
        </Button>

        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={() =>
            router.push(portalPath(tenantSlug, PORTAL_ROUTES.LOGIN))
          }
          className="h-11 w-full px-5 font-semibold"
        >
          <AtSign aria-hidden className="size-4" />
          Use a different email
        </Button>
      </div>
    </PortalSplit>
  );
}
