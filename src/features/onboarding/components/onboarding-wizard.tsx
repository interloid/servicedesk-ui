"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { StepperHeader } from "./stepper-header";

import { OnboardingState } from "../types/onboarding";
import { StepAccount } from "./account";
import { StepOrganization } from "./organization";
import { StepBusinessHours } from "./business-hours";
import { DEFAULT_SLA_TARGETS, StepSlaPolicy } from "./sla-policy";
import { StepInviteTeam } from "./invite-team";
import { Button } from "@/components/ui/button";
import { Timezone } from "../services/onboarding.service";
import { OnboardingLoader } from "./onboarding-loader";
import { landingUrlForSlug } from "@/lib/tenancy";
import { APP_ROUTES } from "@/lib/routes";
import { toast } from "sonner";
import { registerOnboardingAction } from "../actions/register-actions";

interface OnboardingWizardProps {
  timezones: Timezone[];
}

const TOTAL_STEPS = 5;

export function OnboardingWizard({ timezones = [] }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

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
    slaTargets: DEFAULT_SLA_TARGETS,
    invites: [{ email: "", role: "Agent" }],
  });

  const updateFormData = (partial: Partial<OnboardingState>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
  };

  const handleNext = () => {
    setErrorMessage(null);
    setCurrentStep((prev) => Math.min(prev + 1, TOTAL_STEPS));
  };

  const handleBack = () => {
    setErrorMessage(null);
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSkip = () => {
    if (currentStep === TOTAL_STEPS) {
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
        first_response_mins: target.firstReplyMins,
        resolution_mins: target.resolveMins,
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
      if (response.requiresEmailConfirmation) {
        setPendingEmail(formData.workEmail);
        setIsSubmitting(false);
        toast.success(
          "Almost there — verify your email to activate your workspace",
        );
        return;
      }

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

  if (pendingEmail) {
    return (
      <div className="w-full max-w-xl mx-auto rounded-3xl bg-white p-6 sm:p-8 shadow-xl border border-slate-100 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-accent/10">
          <MailCheck className="h-7 w-7 text-brand-accent" aria-hidden />
        </div>
        <h1 className="mt-5 text-xl sm:text-2xl font-bold text-slate-900">
          Check your email
        </h1>
        <p className="mt-2 text-sm leading-[1.6] text-slate-500">
          We sent a confirmation link to{" "}
          <span className="font-semibold text-slate-800">{pendingEmail}</span>.
          Click it to verify your email — you&apos;ll be signed in and taken
          straight to your workspace.
        </p>
        <p className="mt-4 text-xs text-slate-400">
          Haven&apos;t received it? Check your spam folder, or start the signup
          again.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => window.location.assign(APP_ROUTES.LOGIN)}
          className="mt-6 h-11 w-full font-semibold"
        >
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mx-auto rounded-3xl bg-white p-6 sm:p-8 shadow-xl border border-slate-100 flex flex-col max-h-[calc(100dvh-9rem)] overflow-hidden text-left">
      <div className="shrink-0 pb-4 border-b border-slate-100">
        {currentStep <= 2 ? (
          <div>
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-brand-accent">
              STEP {currentStep} OF {TOTAL_STEPS}
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
              {currentStep === 1
                ? "Create your account"
                : "Create your organization"}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              {currentStep === 1
                ? "You'll be the first admin. Invite the rest of your team in a minute."
                : "This is what your customers see on the portal and in every reply."}
            </p>
          </div>
        ) : (
          <div>
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-brand-accent">
              SET UP{" "}
              {formData.orgName
                ? `${formData.orgName.toUpperCase()} SUPPORT`
                : "YOUR WORKSPACE"}
            </span>

            <h1 className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">
              Three steps and your queue is live.
            </h1>
          </div>
        )}

        <div className="mt-4">
          <StepperHeader currentStep={currentStep} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pt-6 px-1 pr-4">
        {errorMessage && (
          <div className="mb-4 rounded-xl bg-red-50 p-3 sm:p-4 text-xs text-red-600 border border-red-100">
            {errorMessage}
          </div>
        )}

        <div className="pb-4">
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
          <OnboardingLoader isLoading={isSubmitting} />
        </div>
      </div>
    </div>
  );
}
