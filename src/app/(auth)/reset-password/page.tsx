"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, CircleAlert, Eye, EyeOff, Loader2 } from "lucide-react";
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

import { createSupabaseClient } from "@/lib/supabase/client";
import {
  UpdatePasswordValues,
  updatePasswordSchema,
} from "@/features/auth/schemas/reset-password";
import { updatePasswordAction } from "@/features/auth/actions";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isExchangingToken, setIsExchangingToken] = React.useState(true);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [updated, setUpdated] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<UpdatePasswordValues>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  React.useEffect(() => {
    async function exchangeCode() {
      const code = searchParams.get("code");
      const supabase = createSupabaseClient();

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setAuthError(error.message);
        }
      } else {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setAuthError("Invalid or expired password reset link.");
        }
      }
      setIsExchangingToken(false);
    }

    exchangeCode();
  }, [searchParams]);

  function onSubmit(values: UpdatePasswordValues) {
    startTransition(async () => {
      form.clearErrors("root");

      const result = await updatePasswordAction(values);

      if (!result.success) {
        form.setError("root", {
          message: result.error || "Failed to update password.",
        });
        return;
      }

      setUpdated(true);
      setTimeout(() => {
        router.push("/login");
      }, 3000);
    });
  }

  if (isExchangingToken) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-brand-accent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
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

              {authError || form.formState.errors.root ? (
                <Alert
                  variant="destructive"
                  className="rounded-[10px] px-3.5 py-3"
                >
                  <CircleAlert className="size-4.5" aria-hidden />
                  <AlertDescription className="text-sm">
                    {authError || form.formState.errors.root?.message}
                  </AlertDescription>
                </Alert>
              ) : null}

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="flex flex-col gap-1.5">
                    <FormLabel className="font-semibold text-foreground">
                      New password
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          disabled={isPending || Boolean(authError)}
                          className="h-11 rounded-sm text-sm pr-10"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        >
                          {showPassword ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem className="flex flex-col gap-1.5">
                    <FormLabel className="font-semibold text-foreground">
                      Confirm password
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        disabled={isPending || Boolean(authError)}
                        className="h-11 rounded-sm text-sm"
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
                className="h-13 bg-brand-accent text-brand-accent-foreground font-semibold"
              >
                {isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> Updating...
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
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="size-8 animate-spin text-brand-accent" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
