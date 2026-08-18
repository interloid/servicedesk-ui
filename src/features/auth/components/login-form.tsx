"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert } from "lucide-react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useGoogleLogin, useLogin } from "@/features/auth/hooks/use-auth";
import { loginSchema, type LoginValues } from "@/features/auth/schemas/login";
import type { AuthFailureCode } from "@/features/auth/types";
import type { ShellIdentity } from "@/lib/identity";

/**
 * Login card, transcribed from `Update design.dc.html` → `authCard` and the `scrLogin`
 * block, and measured against design-reference/log-in--light.png (1:1 at 1440).
 *
 * Measured: card 440px wide, 16px radius, 32px padding, 18px gap between blocks; fields
 * 42px tall with a 6px radius; both buttons 52px. Field metrics override the design
 * system's documented 40px — this screen renders 42px and the screen wins.
 *
 * LIVE. Submit runs `loginSchema` client-side, then calls `loginAction`, which re-validates
 * and signs in against Supabase. On success the session lands in httpOnly cookies and
 * `useLogin` redirects to `/`. The error states below are real server outcomes now, not the
 * hand-set demo copy this screen shipped with.
 */

/** 42px measured on this screen, 44px touch floor below md; 6px radius. */
const FIELD_CLASS = "h-11 rounded-sm text-sm md:h-10.5";

/**
 * The bold lead-in of the design's error Alert, per failure. The design only drew the
 * credential case; the rest reuse its shape so a rate limit or a misconfigured project
 * doesn't render as a blank headline.
 */
const ERROR_HEADLINE: Record<AuthFailureCode, string> = {
  invalid_credentials: "That email and password don't match.",
  email_not_confirmed: "Confirm your email first.",
  rate_limited: "Too many attempts.",
  validation: "Check your details.",
  no_workspace_access: "This is another team's workspace.",
  unknown: "We couldn't sign you in.",
};

export function LoginForm({
  identity,
  tenant,
  initialError,
  next,
}: {
  identity: ShellIdentity | null;
  /** The tenant this subdomain belongs to, resolved before sign-in. */
  tenant: { name: string } | null;
  /** Message from the OAuth callback's `?error=`, shown in the same banner as a failed submit. */
  initialError?: string;
  /**
   * Where the user was headed when the proxy's guard sent them here (`?next=`).
   * Sign-in puts them back there instead of dropping everyone on the queue.
   */
  next?: string;
}) {
  const { login, isPending } = useLogin({ next });
  const { signInWithGoogle, isPending: isGooglePending } = useGoogleLogin({
    next,
  });

  const form = useForm<LoginValues>({
    defaultValues: { email: "", password: "", remember: false },
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(values: LoginValues) {
    form.clearErrors("root");

    const result = await login(values);

    if (result.success) {
      return;
    }

    for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
      const message = messages?.[0];
      if (message) {
        form.setError(field as keyof LoginValues, { message });
      }
    }

    form.setError("root", { type: result.code, message: result.message });
  }

  async function onGoogleSignIn() {
    form.clearErrors("root");

    const result = await signInWithGoogle();

    if (!result.success) {
      form.setError("root", { type: result.code, message: result.message });
    }
  }

  const formError = form.formState.errors.root;
  const bannerMessage = formError?.message ?? initialError;
  const errorHeadline =
    ERROR_HEADLINE[(formError?.type as AuthFailureCode) ?? "unknown"];
  const busy = isPending || isGooglePending;

  return (
    <Form {...form}>
      <AuthCard onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-[-0.02.5em] text-balance text-foreground">
            Sign in to {tenant?.name ?? identity?.org.name ?? "your workspace"}
          </h1>
          <p className="text-sm leading-[1.6] text-muted-foreground">
            Work your queue against live SLA targets.
          </p>
        </div>

        {bannerMessage ? (
          <Alert variant="destructive" className="rounded-[10px] px-3.5 py-3">
            <CircleAlert className="size-4.5" aria-hidden />
            <AlertDescription className="text-sm leading-[1.55]">
              <span className="font-bold">{errorHeadline}</span> {bannerMessage}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3.5">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem id="login-email" className="flex flex-col gap-1.5">
                <FormLabel className="font-semibold text-foreground">
                  Work email
                </FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@northwind.io"
                    className={FIELD_CLASS}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem id="login-password" className="flex flex-col gap-1.5">
                <FormLabel className="font-semibold text-foreground">
                  Password
                </FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    className={FIELD_CLASS}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <FormField
              control={form.control}
              name="remember"
              render={({ field }) => (
                <FormItem
                  id="login-remember"
                  className="flex flex-row items-center gap-2.5"
                >
                  <FormControl>
                    <Checkbox
                      name={field.name}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      onBlur={field.onBlur}
                      className="size-4.5 rounded-[5px]"
                    />
                  </FormControl>
                  <FormLabel className="text-sm font-normal text-foreground">
                    Keep me signed in
                  </FormLabel>
                </FormItem>
              )}
            />
            <Link
              href="/forgot-password"
              className="text-sm font-semibold text-brand-accent hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <Button
            type="submit"
            disabled={busy}
            className="h-13 w-full bg-brand-accent text-base font-semibold text-brand-accent-foreground hover:bg-brand-accent/90"
          >
            {isPending ? "Signing in…" : "Sign in"}
          </Button>

          <div className="flex items-center gap-2.5 text-xs text-muted-foreground/80">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onGoogleSignIn}
            className="h-13 w-full border-input text-base text-brand-accent"
          >
            {isGooglePending
              ? "Redirecting to Google…"
              : "Continue with Google"}
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link
            href="/setup"
            className="font-semibold text-brand-accent hover:underline"
          >
            Create an organization
          </Link>
        </p>
      </AuthCard>
    </Form>
  );
}
