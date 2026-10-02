"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { setPasswordAction } from "@/features/portal/actions/portal.actions";
import { PortalPasswordFields } from "@/features/portal/components/portal-password-fields";
import { applyFieldErrors } from "@/features/portal/form-errors";
import { portalToastSuccess } from "@/features/portal/portal-toast";
import {
  portalSetPasswordSchema,
  type PortalSetPasswordValues,
} from "@/features/portal/schemas/portal.schema";

export function PortalSetPasswordForm({
  tenantSlug,
  skipTo,
  skipLabel = "Skip for now",
  signedInWith = "link",
}: {
  tenantSlug: string;
  /** Where "Skip" lands — the welcome wizard, or the queue if it is done. */
  skipTo: string;
  /**
   * "Skip" reads as an offer being declined, which is only true the once. A
   * customer who came back here from the account menu is leaving, not skipping.
   */
  skipLabel?: string;
  /** How they just signed in, so the banner names the right thing. */
  signedInWith?: "link" | "password";
}) {
  const router = useRouter();
  const [banner, setBanner] = useState<string | undefined>();

  const form = useForm<PortalSetPasswordValues>({
    defaultValues: { password: "", confirmPassword: "" },
    resolver: zodResolver(portalSetPasswordSchema),
  });

  async function onSubmit(values: PortalSetPasswordValues) {
    setBanner(undefined);

    const result = await setPasswordAction(tenantSlug, values);

    if (result.success) {
      // Before the redirect: the Toaster lives in the root layout and survives a
      // client-side navigation, so the confirmation has to be fired first.
      //
      // Says what changes for them next time rather than "password saved": until
      // now this account signed in by emailed link, and that is the part they
      // need telling.
      portalToastSuccess(
        "Password set. Sign in with it next time instead of waiting for an email.",
      );
      router.replace(result.data.redirectTo);
      return;
    }

    applyFieldErrors(form, result.fieldErrors);
    setBanner(result.message);
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <>
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-success/20 bg-success-soft px-4 py-3"
      >
        <CheckCircle2
          aria-hidden
          className="mt-px size-5 shrink-0 fill-success text-white"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-success-strong">Signed in</p>
          <p className="mt-0.5 text-xs text-success-strong/80">
            {signedInWith === "password"
              ? "You're now signed in with your password."
              : "You're now signed in with your email link."}
          </p>
        </div>
      </div>

      <h1 className="mt-6 text-2xl font-bold tracking-tight text-balance text-foreground">
        Set a password?
      </h1>

      <p className="mt-1.5 text-sm leading-[1.6] text-muted-foreground">
        Optional. Create a password so you can sign in without requesting an
        email link each time.
      </p>

      {banner ? (
        <Alert
          variant="destructive"
          className="mt-4 rounded-[10px] px-3.5 py-3"
        >
          <CircleAlert className="size-4.5" aria-hidden />
          <AlertDescription className="text-sm leading-[1.55]">
            {banner}
          </AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="mt-5 flex flex-col gap-4"
        >
          <PortalPasswordFields control={form.control} />

          <div className="mt-2 grid grid-cols-2 gap-2.5 sm:flex sm:justify-end">
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="h-11 px-5 font-semibold"
              disabled={isSubmitting}
              onClick={() => router.replace(skipTo)}
            >
              {skipLabel}
            </Button>

            <Button
              type="submit"
              size="lg"
              className="h-11 px-5 font-semibold"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Set password"
              )}
            </Button>
          </div>
        </form>
      </Form>

      <p className="mt-6 border-t pt-4 text-xs leading-5 text-muted-foreground">
        Your requests are already visible either way. You can add a password
        later from your profile.
      </p>
    </>
  );
}
