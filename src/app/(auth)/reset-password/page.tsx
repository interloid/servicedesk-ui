"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { PasswordInput } from "@/components/ui/password-input";
import { PageLoader } from "@/components/shared/page-loader";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { toast } from "sonner";
import {
  checkPasswordAccessAction,
  updatePasswordAction,
} from "@/features/auth/actions/actions";

const EXPIRED_LINK_MESSAGE =
  "This link has expired or was already used. Request a new one.";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isExchangingToken, setIsExchangingToken] = useState(true);
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
    async function handleAuthentication() {
      const supabase = createSupabaseClient();

      try {
        // Supabase sends a dead link back with the reason in the URL
        // (#error=access_denied&error_code=otp_expired, or ?error=… on the
        // code flow) and no tokens. Stop there: falling through to
        // getSession() would pick up whoever is already signed in on this
        // browser and offer to change THEIR password.
        const linkParams = new URLSearchParams(
          window.location.hash.substring(1),
        );
        const linkError =
          searchParams.get("error_code") ??
          searchParams.get("error") ??
          linkParams.get("error_code") ??
          linkParams.get("error");

        if (linkError) {
          console.error("[Reset Password] Link rejected:", linkError);
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
          setAuthError(EXPIRED_LINK_MESSAGE);
          return;
        }

        const code = searchParams.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            console.error("Code exchange failed:", error);
            setAuthError(EXPIRED_LINK_MESSAGE);
            return;
          }

          // A used code must not stay in the URL to be replayed or shared.
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        } else if (window.location.hash) {
          const accessToken = linkParams.get("access_token");
          const refreshToken = linkParams.get("refresh_token");
          const type = linkParams.get("type");

          if (accessToken && refreshToken) {
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (error) {
              console.error("Failed to establish invite session:", error);
              setAuthError(EXPIRED_LINK_MESSAGE);
              return;
            }

            if (!data.session) {
              setAuthError("Unable to establish authentication session.");
              return;
            }

            window.history.replaceState(null, "", window.location.pathname);
          } else if (type === "invite") {
            setAuthError("Invalid or expired invitation link.");
            return;
          }
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setAuthError("Invalid or expired password reset link.");
          return;
        }

        // The link's session is valid on its own (it is Supabase's, not ours),
        // so check the person still belongs to a workspace before offering
        // the form. A revoked invitee is signed out by the check.
        const access = await checkPasswordAccessAction();

        if (!access.success) {
          setAuthError(access.error);
        }
      } catch (error) {
        console.error("Authentication error:", error);
        setAuthError("Invalid or expired password reset link.");
      } finally {
        setIsExchangingToken(false);
      }
    }

    handleAuthentication();
  }, [searchParams]);

  function onSubmit(values: UpdatePasswordValues) {
    startTransition(async () => {
      form.clearErrors("root");

      const result = await updatePasswordAction(values);

      if (!result.success) {
        form.setError("root", {
          message: result.error || "Failed to update password.",
        });

        toast.error(result.error || "Failed to update password.");
        return;
      }

      toast.success("Password updated successfully");

      setUpdated(true);

      setTimeout(() => {
        router.push("/login");
      }, 3000);
    });
  }

  if (isExchangingToken) {
    return <PageLoader />;
  }

  return (
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
                Your password has been updated. Redirecting to sign in...
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
                        className="h-11 rounded-lg text-sm"
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
  );
}

export default function DirectResetPasswordPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AuthShell>
        <ResetPasswordForm />
      </AuthShell>
    </Suspense>
  );
}
