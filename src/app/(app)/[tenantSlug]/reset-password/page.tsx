"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Check, CircleAlert, ShieldX } from "lucide-react";
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
import { AuthCard, AuthShell } from "@/features/auth/components/auth-card";
import { createSupabaseClient } from "@/lib/supabase/client";

import {
  UpdatePasswordValues,
  updatePasswordSchema,
} from "@/features/auth/schemas/reset-password";

import {
  checkTenantPasswordAccessAction,
  updateTenantPasswordAction,
} from "@/features/auth/actions/actions";
import { tenantForgotPasswordPath, tenantLoginPath } from "@/lib/tenancy";
import { PageLoader } from "@/components/shared/page-loader";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "sonner";

const EXPIRED_LINK_MESSAGE =
  "This link is invalid or has expired. Request a new one to continue.";

/** Why the form can't be used at all, as opposed to one bad attempt. */
type BlockedReason = "expired" | "no-access";

/**
 * Invite: Supabase's own invite mail. Magic link: the mail an existing account
 * gets when it's invited to another workspace. Both are a first password, not
 * a reset, and the page says so.
 */
const FIRST_PASSWORD_TYPES = new Set(["invite", "magiclink"]);
const LINK_TYPES = new Set(["invite", "magiclink", "recovery"]);

export default function DirectResetPasswordPage() {
  const router = useRouter();

  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug;

  const [isVerifyingSession, setIsVerifyingSession] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<BlockedReason>("expired");
  const [isFirstPassword, setIsFirstPassword] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<UpdatePasswordValues>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    let mounted = true;

    const verifyAuthSession = async () => {
      const supabase = createSupabaseClient();

      try {
        const code = new URLSearchParams(window.location.search).get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            console.error(
              "[Reset Password] Code exchange failed:",
              error.message,
            );

            if (mounted) {
              setAuthError(EXPIRED_LINK_MESSAGE);
            }

            return;
          }

          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        }

        const hash = window.location.hash.substring(1);
        const hashParams = new URLSearchParams(hash);

        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const type = hashParams.get("type");

        if (type && LINK_TYPES.has(type) && accessToken && refreshToken) {
          if (mounted) {
            setIsFirstPassword(FIRST_PASSWORD_TYPES.has(type));
          }

          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error || !data.session) {
            console.error(
              "[Reset Password] Failed to establish session:",
              error?.message,
            );

            if (mounted) {
              setAuthError(EXPIRED_LINK_MESSAGE);
            }

            return;
          }

          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError || !session) {
          console.error(
            "[Reset Password] No valid session:",
            sessionError?.message,
          );

          if (mounted) {
            setAuthError(EXPIRED_LINK_MESSAGE);
          }

          return;
        }

        // The link's session proves who they are, not that they still belong
        // here: a revoked invite or a removed member keeps a working link.
        const access = await checkTenantPasswordAccessAction(tenantSlug);

        if (!access.success) {
          // The server already ended the session; clear this tab's copy too.
          await supabase.auth.signOut({ scope: "local" });

          if (mounted) {
            setBlockedReason(
              access.reason === "no-access" ? "no-access" : "expired",
            );
            setAuthError(access.error);
          }

          return;
        }

        if (mounted) {
          setAuthError(null);
        }
      } catch (error) {
        console.error("[Reset Password] Session verification failed:", error);

        if (mounted) {
          setAuthError(EXPIRED_LINK_MESSAGE);
        }
      } finally {
        if (mounted) {
          setIsVerifyingSession(false);
        }
      }
    };

    verifyAuthSession();

    return () => {
      mounted = false;
    };
  }, [tenantSlug]);

  function onSubmit(values: UpdatePasswordValues) {
    startTransition(async () => {
      form.clearErrors("root");

      try {
        // Saved on the server, which checks the membership again: an admin
        // can revoke the invite while this page sits open.
        const result = await updateTenantPasswordAction(values, tenantSlug);

        if (!result.success) {
          if (result.reason === "retry") {
            form.setError("root", { message: result.error });
            toast.error(result.error);
            return;
          }

          await createSupabaseClient().auth.signOut({ scope: "local" });
          setBlockedReason(result.reason);
          setAuthError(result.error);
          toast.error(result.error);
          return;
        }

        // The server signed the link's session out; clear this tab's copy.
        await createSupabaseClient().auth.signOut({ scope: "local" });

        setUpdated(true);
        toast.success(
          isFirstPassword
            ? "Password set. Sign in to open your workspace."
            : "Password updated. Sign in with your new password.",
        );

        setTimeout(() => {
          router.push(tenantLoginPath(tenantSlug));
        }, 2000);
      } catch (error) {
        console.error(
          "[Reset Password] Unexpected password update error:",
          error,
        );

        const message =
          "We couldn't update your password. Check your connection and try again.";

        form.setError("root", { message });
        toast.error(message);
      }
    });
  }

  if (isVerifyingSession) {
    return <PageLoader />;
  }

  return (
    <AuthShell>
      <div className="flex h-full w-full items-center justify-center bg-background px-4 py-12">
        <Form {...form}>
          <AuthCard onSubmit={form.handleSubmit(onSubmit)}>
            {updated ? (
              <div className="flex flex-col items-start gap-3">
                <span
                  aria-hidden
                  className="flex size-11 items-center justify-center rounded-xl bg-success-soft text-success-strong"
                >
                  <Check className="size-5.5" strokeWidth={2} />
                </span>

                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {isFirstPassword ? "You're all set" : "Password updated"}
                </h1>

                <p className="text-sm text-muted-foreground">
                  {isFirstPassword
                    ? "Your password is saved. Taking you to sign in…"
                    : "Sign in with your new password. Taking you there now…"}
                </p>
              </div>
            ) : authError ? (
              // A dead link or revoked access can't be fixed by typing, so
              // the form goes away and the way forward takes its place.
              <div className="flex flex-col items-start gap-3">
                <span
                  aria-hidden
                  className="flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive"
                >
                  {blockedReason === "no-access" ? (
                    <ShieldX className="size-5.5" strokeWidth={2} />
                  ) : (
                    <CircleAlert className="size-5.5" strokeWidth={2} />
                  )}
                </span>

                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {blockedReason === "no-access"
                    ? "Access removed"
                    : "Link expired"}
                </h1>

                <p className="text-sm leading-[1.6] text-muted-foreground">
                  {authError}
                </p>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <Button asChild variant="outline" className="h-10.5">
                    <Link href={tenantLoginPath(tenantSlug)}>
                      Back to sign in
                    </Link>
                  </Button>
                  {blockedReason === "expired" && (
                    <Button asChild className="h-10.5 font-semibold">
                      <Link href={tenantForgotPasswordPath(tenantSlug)}>
                        Request a new link
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    {isFirstPassword
                      ? "Set your password"
                      : "Set a new password"}
                  </h1>

                  <p className="text-sm text-muted-foreground">
                    {isFirstPassword
                      ? "Choose a password to finish joining the workspace. At least 8 characters."
                      : "Choose a new password for your account. At least 8 characters."}
                  </p>
                </div>

                {form.formState.errors.root && (
                  <Alert
                    variant="destructive"
                    className="rounded-[10px] px-3.5 py-3"
                  >
                    <CircleAlert className="size-4.5" aria-hidden />

                    <AlertDescription className="text-sm">
                      {form.formState.errors.root?.message}
                    </AlertDescription>
                  </Alert>
                )}

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                      <FormLabel className="font-semibold text-foreground">
                        New password
                      </FormLabel>

                      <FormControl>
                        <PasswordInput
                          placeholder="••••••••"
                          disabled={isPending}
                          className="h-11 rounded-sm pr-10 text-sm"
                          {...field}
                        />
                      </FormControl>

                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                      <FormLabel className="font-semibold text-foreground">
                        Confirm password
                      </FormLabel>

                      <FormControl>
                        <PasswordInput
                          placeholder="••••••••"
                          disabled={isPending}
                          className="h-11 rounded-lg text-sm"
                          {...field}
                        />
                      </FormControl>

                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={isPending}
                  className="h-11 font-semibold"
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <LoadingSpinner />
                      Saving...
                    </span>
                  ) : isFirstPassword ? (
                    "Set password"
                  ) : (
                    "Update password"
                  )}
                </Button>
              </>
            )}
          </AuthCard>
        </Form>
      </div>
    </AuthShell>
  );
}
