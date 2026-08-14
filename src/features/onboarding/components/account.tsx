"use client";

import React, { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { OnboardingState } from "../types/onboarding";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { checkEmailTenant } from "../register-actions";

// Zod validation schema
const accountFormSchema = z.object({
  fullName: z.string().min(2, "Full name is required."),
  workEmail: z.string().email("Please enter a valid work email address."),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters long."),
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

export function StepAccount({ data, onChange, onNext }: AccountStepProps) {
  const [isCheckingTenant, setIsCheckingTenant] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<AccountFormValues>({
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
      const { exists } = await checkEmailTenant(values.workEmail);

      if (exists) {
        setError("workEmail", {
          type: "manual",
          message:
            "This email is already associated with an existing tenant organization.",
        });
        return;
      }

      onChange(values);
      onNext();
    } catch (error) {
      setError("workEmail", {
        type: "manual",
        message: "Unable to verify email status. Please try again.",
      });
    } finally {
      setIsCheckingTenant(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Step Heading Header */}
      <div className="space-y-1">
        <span className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
          Step 1 of 4
        </span>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Create your account
        </h2>
        <p className="text-sm text-slate-500">
          You&apos;ll be the first admin. Invite the rest of your team in a
          minute.
        </p>
      </div>

      <form
        onSubmit={handleSubmit(handleAccountSubmit)}
        className="space-y-5 text-left"
      >
        {/* Full Name */}
        <div className="space-y-1.5">
          <Label
            htmlFor="fullName"
            className="text-sm font-semibold text-slate-800"
          >
            Full name
          </Label>
          <Input
            id="fullName"
            placeholder="Sam Okafor"
            className="h-11 rounded-lg border-slate-300 text-slate-800 placeholder:text-slate-400 focus-visible:ring-emerald-700"
            {...register("fullName")}
          />
          {errors.fullName && (
            <p className="text-xs font-medium text-destructive">
              {errors.fullName.message}
            </p>
          )}
        </div>

        {/* Work Email */}
        <div className="space-y-1.5">
          <Label
            htmlFor="workEmail"
            className="text-sm font-semibold text-slate-800"
          >
            Work email
          </Label>
          <Input
            id="workEmail"
            type="email"
            placeholder="sam@northwind.io"
            className="h-11 rounded-lg border-slate-300 text-slate-800 placeholder:text-slate-400 focus-visible:ring-emerald-700"
            {...register("workEmail")}
          />
          <p className="text-xs text-slate-500">
            Use your work address — it becomes the admin login.
          </p>
          {errors.workEmail && (
            <p className="text-xs font-medium text-destructive">
              {errors.workEmail.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <Label
            htmlFor="password"
            className="text-sm font-semibold text-slate-800"
          >
            Password
          </Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••••••"
            className="h-11 rounded-lg border-slate-300 text-slate-800 placeholder:text-slate-400 focus-visible:ring-emerald-700"
            {...register("password")}
          />
          <p className="text-xs text-slate-500">
            At least 10 characters, one number
          </p>
          {errors.password && (
            <p className="text-xs font-medium text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Terms Checkbox */}
        <div className="space-y-1 pt-1">
          <div className="flex items-center space-x-2.5">
            <Controller
              name="agreeToTerms"
              control={control}
              render={({ field }) => (
                <Checkbox
                  id="agreeToTerms"
                  checked={field.value}
                  onCheckedChange={(checked) =>
                    field.onChange(checked === true)
                  }
                  className="h-5 w-5 rounded border-slate-300 data-[state=checked]:bg-emerald-700 data-[state=checked]:text-white"
                />
              )}
            />
            <Label
              htmlFor="agreeToTerms"
              className="text-sm font-normal text-slate-700 cursor-pointer select-none"
            >
              I agree to the Terms of Service and Privacy Policy
            </Label>
          </div>
          {errors.agreeToTerms && (
            <p className="text-xs font-medium text-destructive">
              {errors.agreeToTerms.message}
            </p>
          )}
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={isCheckingTenant}
          className="w-full h-11 bg-emerald-800 hover:bg-emerald-900 text-white font-semibold rounded-lg transition-colors"
        >
          {isCheckingTenant ? "Checking..." : "Continue"}
        </Button>
      </form>

      {/* Divider */}
      <div className="relative flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-slate-200" />
        </div>
        <div className="relative bg-white px-3 text-xs text-slate-400">
          or
        </div>
      </div>

      {/* Social Sign In Option */}
      <Button
        type="button"
        variant="outline"
        className="w-full h-11 border-slate-200 text-emerald-800 hover:bg-slate-50 font-semibold rounded-lg"
      >
        Sign up with Google
      </Button>

      {/* Existing Account Footer Link */}
      <div className="text-center text-xs text-slate-500">
        Already have an account?{" "}
        <a
          href="/login"
          className="font-semibold text-emerald-800 hover:underline"
        >
          Sign in
        </a>
      </div>
    </div>
  );
}