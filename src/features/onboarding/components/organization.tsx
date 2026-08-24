"use client";
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import slugify from "slugify";
import { OnboardingState } from "../types/onboarding";
import { useWatch } from "react-hook-form";
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
import { checkSlugAvailabilityAction } from "../register-actions";
import { LoadingSpinner } from "@/components/shared/loading-spinner";

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
  const [isCheckingSlug, setIsCheckingSlug] = useState<boolean>(false);
  const [slugError, setSlugError] = useState<string | null>(null);

  const tzList = Array.isArray(timezones) ? timezones : [];

  const {
    register,
    handleSubmit,
    setValue,
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
    try {
      const { available } = await checkSlugAvailabilityAction(slug);

      if (!available) {
        setSlugError(
          "This portal address is already taken. Please choose another.",
        );
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
      <form
        onSubmit={handleSubmit(handleOrganizationSubmit)}
        className="space-y-5 text-left"
      >
        {slugError && (
          <Alert variant="destructive" className="py-2 text-xs">
            <AlertDescription>{slugError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label
            htmlFor="orgName"
            className="text-sm font-semibold text-slate-800"
          >
            Organization name
          </Label>
          <Input
            id="orgName"
            placeholder="Northwind Support"
            className="h-11 text-slate-800 placeholder:text-slate-400"
            {...register("orgName")}
            onChange={(e) => {
              const val = e.target.value;
              setValue("orgName", val, { shouldValidate: true });
              const generatedSlug = slugify(val, { lower: true, strict: true });
              setValue("portalAddress", generatedSlug, {
                shouldValidate: true,
              });
              setSlugError(null);
            }}
          />
          {errors.orgName && (
            <p className="text-xs font-medium text-destructive">
              {errors.orgName.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="portalAddress"
            className="text-sm font-semibold text-slate-800"
          >
            Portal address
          </Label>
          <Input
            id="portalAddress"
            placeholder="northwind"
            className="h-11 text-slate-800 placeholder:text-slate-400"
            {...register("portalAddress")}
            onChange={(e) => {
              const formattedSlug = e.target.value
                .toLowerCase()
                .replace(/\s+/g, "-");
              setValue("portalAddress", formattedSlug, {
                shouldValidate: true,
              });
              setSlugError(null);
            }}
          />
          <p className="text-xs text-slate-500">
            {portalAddressVal ? portalAddressVal : "your-domain"}
            .servicedesk.pro
          </p>
          {errors.portalAddress && (
            <p className="text-xs font-medium text-destructive">
              {errors.portalAddress.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-slate-800">
            Time zone
          </Label>
          <Controller
            name="timezone_id"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full min-h-11 text-slate-800">
                  <SelectValue placeholder="Select a timezone" />
                </SelectTrigger>
                <SelectContent side="bottom" align="start" position="popper">
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

        <Button
          type="submit"
          disabled={isCheckingSlug}
          className="h-11 w-full font-semibold"
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

        <div className="text-center pt-2">
          <Button
            type="button"
            variant="link"
            onClick={onBack}
            className="p-0 h-auto text-sm font-semibold"
          >
            Back
          </Button>
        </div>
      </form>
    </div>
  );
}
