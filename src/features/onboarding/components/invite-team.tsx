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
          Your Free plan covers 2 seats. Add more any time from Billing.
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
            className={`h-11 rounded-xl border-slate-200 focus-visible:ring-emerald-700 text-xs sm:text-sm shadow-xs ${
              emailError
                ? "border-destructive focus-visible:ring-destructive"
                : ""
            }`}
          />
          {emailError ? (
            <p className="text-xs font-medium text-destructive pt-0.5">
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
            <SelectTrigger className="min-h-11 w-full rounded-xl border-slate-200 bg-white text-xs sm:text-sm focus:ring-emerald-700 shadow-xs">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent side="bottom" align="start" position="popper">
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="billing_admin">Billing Admin</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="h-10 rounded-xl  px-5 text-sm font-semibold text-emerald-800 bg-emerald-50/50"
        >
          Back
        </Button>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
            className="h-11 px-5 border-slate-300 text-emerald-800 font-semibold rounded-lg hover:bg-slate-50 text-sm"
          >
            Skip for now
          </Button>

          <Button
            type="button"
            onClick={handleFinish}
            disabled={!!emailError}
            className="h-11 px-6 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm shadow-xs"
          >
            Finish setup
          </Button>
        </div>
      </div>
    </div>
  );
}
