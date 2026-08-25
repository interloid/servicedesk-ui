"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { OnboardingState } from "../types/onboarding";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { APP_ROUTES } from "@/lib/routes";
import Link from "next/link";
import { PasswordInput } from "@/components/ui/password-input";
import { checkEmailTenantAction } from "../actions/register-actions";

const accountFormSchema = z.object({
  fullName: z.string().min(2, "Full name is required."),
  workEmail: z.string().email("Please enter a valid work email address."),
  password: z.string().min(8, "Password must be at least 8 characters long."),
  agreeToTerms: z.boolean().refine((val) => val === true, {
    message: "You must accept the terms to proceed.",
  }),
});

type AccountFormValues = z.infer<typeof accountFormSchema>;

interface AccountStepProps {
  data: OnboardingState;
  onChange: (data: Partial<OnboardingState>) => void;
  onNext: () => void;
}

const FIELD_CLASS = "h-11 text-slate-800 placeholder:text-slate-400";

export function StepAccount({ data, onChange, onNext }: AccountStepProps) {
  const [isCheckingTenant, setIsCheckingTenant] = useState<boolean>(false);

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      fullName: data.fullName || "",
      workEmail: data.workEmail || "",
      password: data.password || "",
      agreeToTerms: data.agreeToTerms || false,
    },
  });

  const handleAccountSubmit = async (values: AccountFormValues) => {
    setIsCheckingTenant(true);

    try {
      const { exists } = await checkEmailTenantAction(values.workEmail);

      if (exists) {
        form.setError("workEmail", {
          type: "manual",
          message:
            "This email is already associated with an existing tenant organization.",
        });
        return;
      }

      onChange(values);
      onNext();
    } catch {
      form.setError("workEmail", {
        type: "manual",
        message: "Unable to verify email status. Please try again.",
      });
    } finally {
      setIsCheckingTenant(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleAccountSubmit)}
          className="space-y-5 text-left"
        >
          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-sm font-semibold text-slate-800">
                  Full name
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="Sam Okafor"
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
            name="workEmail"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-sm font-semibold text-slate-800">
                  Work email
                </FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="sam@northwind.io"
                    className={FIELD_CLASS}
                    {...field}
                  />
                </FormControl>
                <FormDescription className="text-xs text-slate-500">
                  Use your work address — it becomes the admin login.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-sm font-semibold text-slate-800">
                  Password
                </FormLabel>
                <FormControl>
                  <PasswordInput
                    placeholder="••••••••••••"
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
            name="agreeToTerms"
            render={({ field }) => (
              <FormItem className="space-y-1 pt-1">
                <div className="flex items-center space-x-2.5">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      className="h-5 w-5 rounded border-slate-300 data-[state=checked]:bg-brand-accent data-[state=checked]:text-primary-foreground "
                    />
                  </FormControl>
                  <FormLabel className="text-sm font-normal text-slate-700 cursor-pointer select-none">
                    I agree to the Terms of Service and Privacy Policy
                  </FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            disabled={isCheckingTenant}
            className="h-11 w-full font-semibold"
          >
            {isCheckingTenant ? "Checking..." : "Continue"}
          </Button>
        </form>
      </Form>

      <div className="relative flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-slate-200" />
        </div>
        <div className="relative bg-white px-3 text-xs text-slate-400">or</div>
      </div>

      <div className="text-center text-sm text-slate-500">
        Already have an account?
        <Link
          href={APP_ROUTES.LOGIN}
          className="ml-1 font-semibold text-brand-accent hover:underline"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
