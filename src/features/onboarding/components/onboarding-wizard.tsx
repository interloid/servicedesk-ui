"use client";

import { useState } from "react";
import { StepperHeader } from "./stepper-header";

import { OnboardingState } from "../types/onboarding";
import { StepAccount } from "./account";
import { StepOrganization } from "./organization";
import { StepBusinessHours } from "./business-hours";
import { StepSlaPolicy } from "./sla-policy";
import { StepInviteTeam } from "./invite-team";
import { registerOnboardingAction } from "../register-actions";
import { Timezone } from "../services/onboarding.service";
import { OnboardingLoader } from "./onboarding-loader";
import { landingUrlForSlug } from "@/lib/tenancy";
import { toast } from "sonner";

interface OnboardingWizardProps {
  timezones: Timezone[];
}

function parseSlaMinutes(timeStr: string): number {
  if (timeStr.includes("15 minutes")) return 15;
  if (timeStr.includes("1 hour")) return 60;
  if (timeStr.includes("4 hours") || timeStr.includes("4 business hours"))
    return 240;
  if (timeStr.includes("8 business hours")) return 480;
  if (timeStr.includes("1 business day")) return 1440;
  if (timeStr.includes("2 business days")) return 2880;
  if (timeStr.includes("5 business days")) return 7200;
  return 60;
}

export function OnboardingWizard({ timezones = [] }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [formData, setFormData] = useState<OnboardingState>({
    fullName: "",
    workEmail: "",
    password: "",
    agreeToTerms: false,
    orgName: "",
    portalAddress: "",
    timezone_id: timezones[0]?.id || "",
    workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    dayStarts: "09:00",
    dayEnds: "18:30",
    slaTargets: [
      { priority: "Urgent", firstReply: "15 minutes", resolve: "4 hours" },
      { priority: "High", firstReply: "1 hour", resolve: "8 business hours" },
      {
        priority: "Normal",
        firstReply: "4 business hours",
        resolve: "2 business days",
      },
      {
        priority: "Low",
        firstReply: "1 business day",
        resolve: "5 business days",
      },
    ],
    invites: [{ email: "", role: "Agent" }],
  });

  const updateFormData = (partial: Partial<OnboardingState>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
  };

  const handleNext = () => {
    setErrorMessage(null);
    setCurrentStep((prev) => Math.min(prev + 1, 5));
  };

  const handleBack = () => {
    setErrorMessage(null);
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSkip = () => {
    if (currentStep === 5) {
      handleFinish();
    } else {
      handleNext();
    }
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    const payload = {
      email: formData.workEmail,
      password: formData.password,
      full_name: formData.fullName,
      organization_name: formData.orgName,
      portal_slug: formData.portalAddress,
      timezone_id: formData.timezone_id || timezones[0]?.id || "",
      working_days: formData.workingDays,
      day_start: formData.dayStarts,
      day_end: formData.dayEnds,
      sla: formData.slaTargets.map((target) => ({
        priority: target.priority,
        first_response_mins: parseSlaMinutes(target.firstReply),
        resolution_mins: parseSlaMinutes(target.resolve),
      })),
      invite_users: formData.invites
        .filter((inv) => inv.email.trim() !== "")
        .map((inv) => ({
          email: inv.email,
          role: inv.role.toLowerCase() as "agent" | "manager" | "billing_admin",
        })),
    };

    const response = await registerOnboardingAction(payload);

    if (response.success) {
      toast.success("Organization created successfully");
      window.location.assign(
        landingUrlForSlug(response.data!.tenant.slug, "/tickets"),
      );
    } else {
      setIsSubmitting(false);
      setErrorMessage(response.error || "Failed to complete setup.");
      toast.error(response.error || "Failed to complete setup.");
    }
  };

  return (
    <div className="relative overflow-hidden w-full max-w-2xl mx-auto rounded-3xl bg-white p-8 sm:p-10 shadow-xl border border-slate-100 text-left">
      {currentStep <= 2 ? (
        <div className="mb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
            STEP {currentStep} OF 4
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            {currentStep === 1
              ? "Create your account"
              : "Create your organization"}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {currentStep === 1
              ? "You'll be the first admin. Invite the rest of your team in a minute."
              : "This is what your customers see on the portal and in every reply."}
          </p>
        </div>
      ) : (
        <div className="mb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
            SET UP{" "}
            {formData.orgName ? formData.orgName.toUpperCase() : "NORTHWIND"}{" "}
            SUPPORT
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Three steps and your queue is live.
          </h1>
        </div>
      )}

      <StepperHeader currentStep={currentStep} />

      {errorMessage && (
        <div className="my-4 rounded-xl bg-red-50 p-4 text-xs text-red-600 border border-red-100">
          {errorMessage}
        </div>
      )}

      <div className="mt-6">
        {currentStep === 1 && (
          <StepAccount
            data={formData}
            onChange={updateFormData}
            onNext={handleNext}
          />
        )}
        {currentStep === 2 && (
          <StepOrganization
            timezones={timezones}
            data={formData}
            onChange={updateFormData}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}
        {currentStep === 3 && (
          <StepBusinessHours
            timezones={timezones}
            data={formData}
            onChange={updateFormData}
            onNext={handleNext}
            onSkip={handleSkip}
            onBack={handleBack}
          />
        )}
        {currentStep === 4 && (
          <StepSlaPolicy
            data={formData}
            onNext={handleNext}
            onSkip={handleSkip}
            onBack={handleBack}
          />
        )}
        {currentStep === 5 && (
          <StepInviteTeam
            data={formData}
            onChange={updateFormData}
            onFinish={handleFinish}
            onSkip={handleSkip}
            onBack={handleBack}
          />
        )}
      </div>

      <OnboardingLoader isLoading={isSubmitting} />
    </div>
  );
}
