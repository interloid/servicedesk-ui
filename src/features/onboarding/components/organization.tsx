"use client";

import React, { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import slugify from "slugify";

import { OnboardingState } from "../types/onboarding";
import { checkSlugAvailabilityAction } from "../register-actions";

// shadcn UI Primitives
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";

// Step 2 Zod Schema
const organizationFormSchema = z.object({
  orgName: z.string().min(2, "Organization name must be at least 2 characters."),
  portalAddress: z
    .string()
    .min(2, "Portal address must be at least 2 characters.")
    .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens."),
  timezone_id: z.string().min(1, "Please select a valid timezone."),
});

type OrganizationFormValues = z.infer<typeof organizationFormSchema>;

export interface Timezone {
  id: string;
  display_name?: string;
  name?: string;
  label?: string;
  cities?: string;
  utc_offset?: string;
}

interface StepOrganizationProps {
  data: OnboardingState;
  timezones?: Timezone[];
  onChange: (data: Partial<OnboardingState>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepOrganization({
  data,
  timezones = [],
  onChange,
  onNext,
  onBack,
}: StepOrganizationProps) {
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);

  const tzList = Array.isArray(timezones) ? timezones : [];

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    formState: { errors },
  } = useForm<OrganizationFormValues>({
    resolver: zodResolver(organizationFormSchema),
    defaultValues: {
      orgName: data.orgName || "",
      portalAddress: data.portalAddress || "",
      timezone_id: data.timezone_id || "",
    },
  });

  const portalAddressVal = watch("portalAddress");
  const selectedTzId = watch("timezone_id");
  const selectedTz = tzList.find((tz) => tz.id === selectedTzId);

  // Check DB for existing portal slug via Server Action
  const checkSlugAvailability = async (slug: string): Promise<boolean> => {
    setIsCheckingSlug(true);
    setSlugError(null);
    try {
      const { available } = await checkSlugAvailabilityAction(slug);

      if (!available) {
        setSlugError("This portal address is already taken. Please choose another.");
        return false;
      }
      return true;
    } catch (err) {
      console.error("Slug check failed:", err);
      return true;
    } finally {
      setIsCheckingSlug(false);
    }
  };

  const handleOrganizationSubmit = async (values: OrganizationFormValues) => {
    const isAvailable = await checkSlugAvailability(values.portalAddress);
    if (!isAvailable) return;

    onChange(values);
    onNext();
  };

  return (
    <div className="w-full space-y-6">
      {/* Header Section */}
      <div className="space-y-1">
        <span className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
          Step 2 of 4
        </span>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Create your organization
        </h2>
        <p className="text-sm text-slate-500">
          This is what your customers see on the portal and in every reply.
        </p>
      </div>

      <form onSubmit={handleSubmit(handleOrganizationSubmit)} className="space-y-5 text-left">
        {/* Error Alert */}
        {slugError && (
          <Alert variant="destructive" className="py-2 text-xs">
            <AlertDescription>{slugError}</AlertDescription>
          </Alert>
        )}

        {/* Organization Name Field */}
        <div className="space-y-1.5">
          <Label htmlFor="orgName" className="text-sm font-semibold text-slate-800">
            Organization name
          </Label>
          <Input
            id="orgName"
            placeholder="Northwind Support"
            className="h-11 rounded-lg border-slate-300 text-slate-800 placeholder:text-slate-400 focus-visible:ring-emerald-700"
            {...register("orgName")}
            onChange={(e) => {
              const val = e.target.value;
              setValue("orgName", val, { shouldValidate: true });
              // Auto-generate portal slug while user types
              const generatedSlug = slugify(val, { lower: true, strict: true });
              setValue("portalAddress", generatedSlug, { shouldValidate: true });
              setSlugError(null);
            }}
          />
          {errors.orgName && (
            <p className="text-xs font-medium text-destructive">
              {errors.orgName.message}
            </p>
          )}
        </div>

        {/* Portal Address Slug Field */}
        <div className="space-y-1.5">
          <Label htmlFor="portalAddress" className="text-sm font-semibold text-slate-800">
            Portal address
          </Label>
          <Input
            id="portalAddress"
            placeholder="northwind"
            className="h-11 rounded-lg border-slate-300 text-slate-800 placeholder:text-slate-400 focus-visible:ring-emerald-700"
            {...register("portalAddress")}
            onChange={(e) => {
              const formattedSlug = e.target.value.toLowerCase().replace(/\s+/g, "-");
              setValue("portalAddress", formattedSlug, { shouldValidate: true });
              setSlugError(null);
            }}
          />
          <p className="text-xs text-slate-500">
            {portalAddressVal ? portalAddressVal : "your-domain"}.servicedesk.pro
          </p>
          {errors.portalAddress && (
            <p className="text-xs font-medium text-destructive">
              {errors.portalAddress.message}
            </p>
          )}
        </div>

        {/* Timezone Selection Field */}
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-slate-800">Time zone</Label>
          <Controller
            name="timezone_id"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full h-11 rounded-lg border-slate-300 text-slate-800 focus:ring-emerald-700">
                  <SelectValue placeholder="Select a timezone" />
                </SelectTrigger>
                <SelectContent>
                  {tzList.map((tz) => (
                    <SelectItem key={tz.id} value={tz.id}>
                      {tz.display_name || tz.name || tz.label || tz.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {selectedTz && (
            <p className="text-xs text-slate-500">
              {selectedTz.utc_offset && `${selectedTz.utc_offset} · `}
              {selectedTz.cities || selectedTz.display_name}
            </p>
          )}
          {errors.timezone_id && (
            <p className="text-xs font-medium text-destructive">
              {errors.timezone_id.message}
            </p>
          )}
        </div>

        {/* Submit / Continue Button */}
        <Button
          type="submit"
          disabled={isCheckingSlug}
          className="w-full h-11 bg-emerald-800 hover:bg-emerald-900 text-white font-semibold rounded-lg transition-colors"
        >
          {isCheckingSlug ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking availability...
            </>
          ) : (
            "Continue"
          )}
        </Button>

        {/* Back Button */}
        <div className="text-center pt-2">
          <Button
            type="button"
            variant="link"
            onClick={onBack}
            className="text-sm font-semibold text-emerald-800 hover:underline p-0 h-auto"
          >
            Back
          </Button>
        </div>
      </form>
    </div>
  );
}