"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
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
import { updateTenantPasswordAction } from "@/features/auth/actions";

export default function DirectResetPasswordPage() {
  const router = useRouter();

  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug;

  const [isVerifyingSession, setIsVerifyingSession] = React.useState(true);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [updated, setUpdated] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<UpdatePasswordValues>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  React.useEffect(() => {
    async function verifySession() {
      const supabase = createSupabaseClient();
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        setAuthError("Invalid or expired password reset link.");
      }
      setIsVerifyingSession(false);
    }

    verifySession();
  }, []);

  function onSubmit(values: UpdatePasswordValues) {
    startTransition(async () => {
      form.clearErrors("root");

      const result = await updateTenantPasswordAction(values, tenantSlug);

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

  if (isVerifyingSession) {
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
