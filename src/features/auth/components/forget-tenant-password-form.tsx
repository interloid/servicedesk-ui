"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
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
import { resetTenantPasswordAction } from "../actions";
import { useState, useTransition } from "react";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { toast } from "sonner";

interface ForgotPasswordFormProps {
  slug?: string;
}

export function ForgotTenantPasswordForm({
  slug: slugProp,
}: ForgotPasswordFormProps) {
  const params = useParams();
  const slug = slugProp || (params.tenantSlug as string) || "";

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const [sent, setSent] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(values: ForgotPasswordValues) {
    startTransition(async () => {
      form.clearErrors("root");

      const response = await resetTenantPasswordAction(values, slug);

      if (!response.success) {
        if (response.isRateLimited) {
          form.setError("root", {
            message:
              response.error ||
              "Too many attempts from this address — try again in 60 seconds, or contact your admin.",
          });
          form.setError("email", { message: "Rate limited" });
          toast.error(response.error || "Too many attempts. Try again later.");
        } else {
          form.setError("root", {
            message:
              response.error || "An error occurred while sending the email.",
          });
          toast.error(response.error || "Failed to send reset email.");
        }
        setSent(false);
        return;
      }

      toast.success("Reset link sent. Check your inbox.");
      setSent(true);
    });
  }

  function handleResend() {
    onSubmit(form.getValues());
  }

  const rateLimited = Boolean(form.formState.errors.root);
  const errorMessage = form.formState.errors.root?.message;

  return (
    <Form {...form}>
      <AuthCard onSubmit={form.handleSubmit(onSubmit)}>
        {sent ? (
          <div className="flex flex-col items-start gap-3">
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-xl bg-success-soft text-success-strong"
            >
              <Check className="size-5.5" strokeWidth={2} />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-balance text-foreground">
              Check your inbox
            </h1>
            <p className="text-sm leading-[1.6] text-muted-foreground">
              If that email has an account, a reset link is on its way. It
              expires in 30 minutes — check spam before asking for another.
            </p>

            <Button
              type="button"
              variant="outline"
              onClick={handleResend}
              disabled={isPending}
              className="h-10.5 border-input text-brand-accent"
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <LoadingSpinner /> Sending...
                </span>
              ) : (
                "Resend link"
              )}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-bold tracking-tight text-balance text-foreground">
                Reset your password
              </h1>
              <p className="text-sm leading-[1.6] text-muted-foreground">
                Enter the email you sign in with. We&apos;ll send a link
                that&apos;s valid for 30 minutes.
              </p>
            </div>

            {rateLimited && (
              <Alert
                variant="destructive"
                className="rounded-[10px] px-3.5 py-3"
              >
                <CircleAlert className="size-4.5" aria-hidden />
                <AlertDescription className="text-sm leading-[1.55]">
                  <span className="font-bold">
                    We couldn&apos;t send that link.
                  </span>{" "}
                  {errorMessage}
                </AlertDescription>
              </Alert>
            )}

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
                      disabled={isPending}
                      className="h-11 rounded-lg text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2.5">
              <Button
                type="submit"
                disabled={isPending}
                className="h-11 px-5 text-base font-semibold"
              >
                {isPending ? (
                  <span className="flex items-center gap-2">
                    <LoadingSpinner /> Sending...
                  </span>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </div>
          </>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link
            href={`/tenant/${slug}/login`}
            className="font-semibold text-brand-accent hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </AuthCard>
    </Form>
  );
}
