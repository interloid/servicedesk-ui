"use client";

import * as React from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, CircleAlert } from "lucide-react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { AuthCard } from "@/features/auth/components/auth-card";
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/features/auth/schemas/forgot-password";

/**
 * "Reset your password", transcribed from `Update design.dc.html` → the `scrForgot` block
 * (route id `forgot`), and measured against design-reference/forgot-password--light.png
 * and --error--light.png, both 1:1 at 1440.
 *
 * The design puts TWO states in one card, switched by `resetSent`/`resetForm`:
 *   • the request form, and
 *   • a "Check your inbox" confirmation.
 * Its own state logic returns to the form whenever an error is present
 * (`resetForm: !s.resetSent || error`), which is reproduced here.
 *
 * Measured: card 440px · 335px tall as the form, 467px in error; field 374×42 with a 6px
 * radius; "Send reset link" 154×52 and LEFT-ALIGNED — the markup passes `fullBtn`
 * (width:100%) but the design's own render ignores it, exactly as create-org does.
 *
 * NO EMAIL IS SENT. No server action, no mail provider, no token. Submitting only moves
 * this component's own state.
 */

/**
 * The design's error is a RATE LIMIT ("Too many attempts from this address"), not a
 * validation failure — so it is reached the way a rate limit would be: by asking again.
 * The second send in a session trips it. See docs/FORGOT-PASSWORD-DIFF.md. It lives
 * outside the schema for that reason: no shape check could produce it.
 */
const RATE_LIMIT_AFTER = 1;

export function ForgotPasswordForm() {
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const [sends, setSends] = React.useState(0);
  const [sent, setSent] = React.useState(false);

  function send() {
    // The design shows the form again, banner and all, whenever the error is present.
    if (sends >= RATE_LIMIT_AFTER) {
      setSent(false);
      form.setError("root", { message: "rate-limited" });
      form.setError("email", { message: "Rate limited" });
      return;
    }
    setSends((count) => count + 1);
    form.clearErrors("root");
    setSent(true);
  }

  const rateLimited = Boolean(form.formState.errors.root);

  return (
    <Form {...form}>
      <AuthCard onSubmit={form.handleSubmit(send)}>
        {sent ? (
          // 12px gap, left-aligned — the design's `resetSent` block.
          <div className="flex flex-col items-start gap-3">
            {/* 44px tile, 14px radius. The design paints it green-50 on green-800; the
                success triple is used instead so no palette literal enters, matching the
                precedent set in DIFFERENCE-LIST A7. */}
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-xl bg-success-soft text-success-strong"
            >
              <Check className="size-[22px]" strokeWidth={2} />
            </span>
            <h1 className="text-2xl font-bold tracking-[-0.025em] text-balance text-foreground">
              Check your inbox
            </h1>
            <p className="text-sm leading-[1.6] text-muted-foreground">
              If that email has an account, a reset link is on its way. It
              expires in 30 minutes — check spam before asking for another.
            </p>
            {/* Secondary, auto-width, 42px — the design's `tapBtn`. */}
            <Button
              type="button"
              variant="neutral"
              onClick={send}
              className="h-10.5 border-input text-brand-accent"
            >
              Resend link
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-bold tracking-[-0.025em] text-balance text-foreground">
                Reset your password
              </h1>
              <p className="text-sm leading-[1.6] text-muted-foreground">
                Enter the email you sign in with. We&apos;ll send a link
                that&apos;s valid for 30 minutes.
              </p>
            </div>

            {/* Form-level banner, as the design draws it — alongside the field error, not
                instead of it. Only the radius and padding differ from the Alert default. */}
            {rateLimited ? (
              <Alert tone="error" className="rounded-[10px] px-3.5 py-3">
                <CircleAlert className="size-[18px]" aria-hidden />
                <AlertDescription className="text-sm leading-[1.55]">
                  <span className="font-bold">
                    We couldn&apos;t send that link.
                  </span>{" "}
                  Too many attempts from this address — try again in 60 seconds,
                  or contact your admin.
                </AlertDescription>
              </Alert>
            ) : null}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem id="forgot-email" className="flex flex-col gap-1.5">
                  <FormLabel className="font-semibold text-foreground">
                    Work email
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="you@northwind.io"
                      className="h-11 rounded-sm text-sm md:h-10.5"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 154×52, left-aligned — the capture's own geometry, not login's full-width CTA. */}
            <div className="flex gap-2.5">
              <Button
                type="submit"
                className="h-13 bg-brand-accent px-5 text-base font-semibold text-brand-accent-foreground hover:bg-brand-accent/90"
              >
                Send reset link
              </Button>
            </div>
          </>
        )}

        {/* Outside both states in the design — it shows on the form and the confirmation. */}
        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-semibold text-brand-accent hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </AuthCard>
    </Form>
  );
}
