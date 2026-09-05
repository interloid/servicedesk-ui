"use client";

import { useState } from "react";
import { OnboardingState, TeamInvite } from "../types/onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StepProps {
  data: OnboardingState;
  onChange: (data: Partial<OnboardingState>) => void;
  onFinish: () => void;
  onSkip: () => void;
  onBack: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function StepInviteTeam({
  data,
  onChange,
  onFinish,
  onSkip,
  onBack,
}: StepProps) {
  const [emailsInput, setEmailsInput] = useState<string>(() =>
    data.invites
      .map((inv) => inv.email)
      .filter(Boolean)
      .join(", "),
  );

  const [selectedRole, setSelectedRole] = useState<TeamInvite["role"]>(
    () => data.invites[0]?.role || "agent",
  );
  const normalizedRole = (
    selectedRole || "agent"
  ).toLowerCase() as TeamInvite["role"];

  const [emailError, setEmailError] = useState<string>("");

  const validateAndSyncEmails = (
    rawInput: string,
    role: TeamInvite["role"],
  ) => {
    if (!rawInput.trim()) {
      setEmailError("");
      onChange({ invites: [] });
      return true;
    }

    const emailList = rawInput
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    const invalidEmails = emailList.filter((e) => !EMAIL_REGEX.test(e));

    if (invalidEmails.length > 0) {
      setEmailError(`Invalid email format: ${invalidEmails.join(", ")}`);
      return false;
    }

    setEmailError("");
    const parsedInvites: TeamInvite[] = emailList.map((email) => ({
      email,
      role,
    }));
    onChange({ invites: parsedInvites });
    return true;
  };

  const handleEmailChange = (val: string) => {
    setEmailsInput(val);
    validateAndSyncEmails(val, selectedRole);
  };

  const handleRoleChange = (role: TeamInvite["role"]) => {
    setSelectedRole(role);
    validateAndSyncEmails(emailsInput, role);
  };

  const handleFinish = () => {
    const isValid = validateAndSyncEmails(emailsInput, selectedRole);
    if (isValid) {
      onFinish();
    }
  };

  return (
    <div className="w-full space-y-6 text-left">
      <div className="space-y-1">
        <h3 className="text-base font-bold text-slate-900">
          Invite your agents
        </h3>
        <p className="text-xs sm:text-sm text-slate-500">
          Invite agents up to your plan&apos;s agent seat allowance. Add more any
          time from Billing.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-semibold text-slate-900">
            Email addresses
          </label>
          <Input
            type="text"
            placeholder="priya@northwind.io, sam@northwind.io"
            value={emailsInput}
            onChange={(e) => handleEmailChange(e.target.value)}
            className={`h-11 text-xs sm:text-sm shadow-xs ${
              emailError
                ? "border-destructive focus-visible:ring-destructive"
                : ""
            }`}
          />
          {emailError ? (
            <p className="text-xs font-medium text-destructive pt-0.5 wrap-break-word">
              {emailError}
            </p>
          ) : (
            <p className="text-xs text-slate-400 pt-0.5">
              Separate with commas
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-semibold text-slate-900">
            Invite as
          </label>
          <Select
            value={normalizedRole}
            onValueChange={(val) => handleRoleChange(val as TeamInvite["role"])}
          >
            <SelectTrigger className="min-h-11 w-full text-xs sm:text-sm shadow-xs">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent
              side="bottom"
              align="start"
              position="popper"
              className="w-(--radix-select-trigger-width)"
            >
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="billing_admin">Billing Admin</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pt-2 sm:pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="w-full sm:w-auto h-11 px-5 text-sm font-semibold"
        >
          Back
        </Button>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
            className="w-full sm:w-auto h-11 px-5 text-sm font-semibold text-brand-accent"
          >
            Skip for now
          </Button>

          <Button
            type="button"
            onClick={handleFinish}
            disabled={!!emailError}
            className="w-full sm:w-auto h-11 px-6 text-sm font-semibold shadow-xs"
          >
            Finish setup
          </Button>
        </div>
      </div>
    </div>
  );
}
