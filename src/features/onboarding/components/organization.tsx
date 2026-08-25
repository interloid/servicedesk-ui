"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import slugify from "slugify";
import { OnboardingState } from "../types/onboarding";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { checkSlugAvailabilityAction } from "../actions/register-actions";

const organizationFormSchema = z.object({
  orgName: z
    .string()
    .min(2, "Organization name must be at least 2 characters."),

  portalAddress: z
    .string()
    .min(2, "Portal address must be at least 2 characters.")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens.",
    ),

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

  const form = useForm<OrganizationFormValues>({
    resolver: zodResolver(organizationFormSchema),
    defaultValues: {
      orgName: data.orgName || "",
      portalAddress: data.portalAddress || "",
      timezone_id: data.timezone_id || "",
    },
  });

  const { handleSubmit, setValue, control } = form;

  const portalAddressVal = useWatch({
    control,
    name: "portalAddress",
  });

  const selectedTzId = useWatch({
    control,
    name: "timezone_id",
  });

  const selectedTz = tzList.find((tz) => tz.id === selectedTzId);

  const checkSlugAvailability = async (slug: string): Promise<boolean> => {
    setIsCheckingSlug(true);
    setSlugError(null);
    form.clearErrors("portalAddress");

    try {
      const { available } = await checkSlugAvailabilityAction(slug);

      if (!available) {
        const message =
          "This portal address is already taken. Please choose another.";

        setSlugError(message);

        form.setError("portalAddress", {
          type: "manual",
          message,
        });

        return false;
      }

      form.clearErrors("portalAddress");
      setSlugError(null);

      return true;
    } catch (err) {
      console.error("Slug availability check failed:", err);

      const message =
        "Unable to verify portal address availability. Please try again.";

      setSlugError(message);

      form.setError("portalAddress", {
        type: "manual",
        message,
      });

      return false;
    } finally {
      setIsCheckingSlug(false);
    }
  };

  const handleOrganizationSubmit = async (values: OrganizationFormValues) => {
    const isAvailable = await checkSlugAvailability(values.portalAddress);

    if (!isAvailable) {
      return;
    }

    onChange(values);
    onNext();
  };

  return (
    <div className="w-full space-y-6">
      <Form {...form}>
        <form
          onSubmit={handleSubmit(handleOrganizationSubmit)}
          className="space-y-5 text-left"
        >
          {slugError && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertDescription>{slugError}</AlertDescription>
            </Alert>
          )}

          <FormField
            control={control}
            name="orgName"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel
                  htmlFor="orgName"
                  className="text-sm font-semibold text-slate-800"
                >
                  Organization name
                </FormLabel>

                <FormControl>
                  <Input
                    {...field}
                    id="orgName"
                    placeholder="Northwind Support"
                    className="h-11 text-slate-800 placeholder:text-slate-400"
                    onChange={(e) => {
                      field.onChange(e);

                      const value = e.target.value;

                      setValue("orgName", value, {
                        shouldValidate: true,
                      });

                      const generatedSlug = slugify(value, {
                        lower: true,
                        strict: true,
                      });

                      setValue("portalAddress", generatedSlug, {
                        shouldValidate: true,
                      });

                      setSlugError(null);
                      form.clearErrors("portalAddress");
                    }}
                  />
                </FormControl>

                <FormMessage className="text-xs font-medium text-destructive" />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="portalAddress"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel
                  htmlFor="portalAddress"
                  className="text-sm font-semibold text-slate-800"
                >
                  Portal address
                </FormLabel>

                <FormControl>
                  <Input
                    {...field}
                    id="portalAddress"
                    placeholder="northwind"
                    className="h-11 text-slate-800 placeholder:text-slate-400"
                    onChange={(e) => {
                      const formattedSlug = e.target.value
                        .toLowerCase()
                        .replace(/\s+/g, "-");

                      field.onChange(formattedSlug);

                      setValue("portalAddress", formattedSlug, {
                        shouldValidate: true,
                      });

                      setSlugError(null);
                      form.clearErrors("portalAddress");
                    }}
                  />
                </FormControl>

                <FormDescription className="break-all text-xs text-slate-500">
                  {`https://servicedesk-ui.vercel.app/tenant/${
                    portalAddressVal
                  }`}
                </FormDescription>

                <FormMessage className="text-xs font-medium text-destructive" />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="timezone_id"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-sm font-semibold text-slate-800">
                  Time zone
                </FormLabel>

                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                  }}
                >
                  <FormControl>
                    <SelectTrigger className="w-full min-h-11 text-slate-800">
                      <SelectValue placeholder="Select a timezone" />
                    </SelectTrigger>
                  </FormControl>

                  <SelectContent side="bottom" align="start" position="popper">
                    {tzList.map((tz) => (
                      <SelectItem key={tz.id} value={tz.id}>
                        {tz.display_name || tz.name || tz.label || tz.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedTz && (
                  <FormDescription className="text-xs text-slate-500">
                    {selectedTz.utc_offset && `${selectedTz.utc_offset} · `}
                    {selectedTz.cities || selectedTz.display_name}
                  </FormDescription>
                )}

                <FormMessage className="text-xs font-medium text-destructive" />
              </FormItem>
            )}
          />

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              className="h-11 w-full px-5 text-sm font-semibold sm:w-auto"
            >
              Back
            </Button>

            <Button
              type="submit"
              disabled={isCheckingSlug}
              className="h-11 w-full px-6 font-semibold sm:w-auto"
            >
              {isCheckingSlug ? (
                <>
                  <LoadingSpinner />
                  Checking availability...
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
