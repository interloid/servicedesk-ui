"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
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
import { AuthCard, AuthShell } from "@/features/auth/components/auth-card";
import { createSupabaseClient } from "@/lib/supabase/client";

import {
  UpdatePasswordValues,
  updatePasswordSchema,
} from "@/features/auth/schemas/reset-password";

import { APP_ROUTES } from "@/lib/routes";
import { PageLoader } from "@/components/shared/page-loader";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "sonner";

const INVALID_INVITE_MESSAGE =
  "This invitation link is invalid or has expired.";

export default function DirectResetPasswordPage() {
  const router = useRouter();

  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug;

  const [isVerifyingSession, setIsVerifyingSession] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
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
              setAuthError(
                "This password reset link is invalid or has expired.",
              );
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

        if (
          (type === "invite" || type === "recovery") &&
          accessToken &&
          refreshToken
        ) {
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
              setAuthError(
                "This password reset link is invalid or has expired.",
              );
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
            setAuthError("This password reset link is invalid or has expired.");
          }

          return;
        }

        if (mounted) {
          setAuthError(null);
        }
      } catch (error) {
        console.error("[Reset Password] Session verification failed:", error);

        if (mounted) {
          setAuthError("This password reset link is invalid or has expired.");
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

      const supabase = createSupabaseClient();

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError || !session) {
          setAuthError(INVALID_INVITE_MESSAGE);

          form.setError("root", {
            message: INVALID_INVITE_MESSAGE,
          });

          toast.error(INVALID_INVITE_MESSAGE);

          return;
        }

        const { error: updateError } = await supabase.auth.updateUser({
          password: values.password,
        });

        if (updateError) {
          console.error(
            "[Reset Password] Password update failed:",
            updateError.message,
          );

          const message = "Failed to update password. Please try again.";

          form.setError("root", {
            message,
          });

          toast.error(message);

          return;
        }

        setUpdated(true);

        toast.success("Password updated successfully.");

        await supabase.auth.signOut();

        setTimeout(() => {
          router.push(APP_ROUTES.LOGIN);
        }, 2000);
      } catch (error) {
        console.error(
          "[Reset Password] Unexpected password update error:",
          error,
        );

        const message = "Failed to update password. Please try again.";

        form.setError("root", {
          message,
        });

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
                  Password reset complete
                </h1>

                <p className="text-sm text-muted-foreground">
                  Password updated successfully. Redirecting to sign in...
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    Set new password
                  </h1>

                  <p className="text-sm text-muted-foreground">
                    Enter your new password below.
                  </p>
                </div>

                {(authError || form.formState.errors.root) && (
                  <Alert
                    variant="destructive"
                    className="rounded-[10px] px-3.5 py-3"
                  >
                    <CircleAlert className="size-4.5" aria-hidden />

                    <AlertDescription className="text-sm">
                      {authError || form.formState.errors.root?.message}
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
                          disabled={isPending || Boolean(authError)}
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
                          disabled={isPending || Boolean(authError)}
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
                  disabled={isPending || Boolean(authError)}
                  className="h-11 font-semibold"
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <LoadingSpinner />
                      Updating...
                    </span>
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
