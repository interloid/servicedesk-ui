"use client";

import React, { useState } from "react";
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

export function StepInviteTeam({
  data,
  onChange,
  onFinish,
  onSkip,
  onBack,
}: StepProps) {
  const [emailsInput, setEmailsInput] = useState(() =>
    data.invites
      .map((inv) => inv.email)
      .filter(Boolean)
      .join(", "),
  );

  const [selectedRole, setSelectedRole] = useState<TeamInvite["role"]>(
    () => data.invites[0]?.role || "Agent",
  );

  const handleEmailChange = (val: string) => {
    setEmailsInput(val);

    const parsedInvites: TeamInvite[] = val
      .split(",")
      .map((e) => e.trim())
      .map((email) => ({
        email,
        role: selectedRole,
      }));

    onChange({ invites: parsedInvites });
  };

  const handleRoleChange = (role: TeamInvite["role"]) => {
    setSelectedRole(role);

    const updatedInvites: TeamInvite[] = data.invites.map((inv) => ({
      ...inv,
      role,
    }));

    onChange({ invites: updatedInvites });
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
            className="h-11 rounded-xl border-slate-200 focus-visible:ring-emerald-700 text-xs sm:text-sm shadow-xs"
          />
          <p className="text-xs text-slate-400 pt-0.5">Separate with commas</p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs sm:text-sm font-semibold text-slate-900">
            Invite as
          </label>
          <Select
            value={selectedRole}
            onValueChange={(val) => handleRoleChange(val as TeamInvite["role"])}
          >
            <SelectTrigger className="h-11 w-full rounded-xl border-slate-200 bg-white text-xs sm:text-sm focus:ring-emerald-700 shadow-xs">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Agent">Agent</SelectItem>
              <SelectItem value="Admin">Admin</SelectItem>
              <SelectItem value="Manager">Manager</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4">
        <Button
          type="button"
          variant="link"
          onClick={onBack}
          className="text-sm font-semibold text-emerald-800 hover:underline p-0 h-auto"
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
            onClick={onFinish}
            className="h-11 px-6 bg-emerald-800 hover:bg-emerald-900 text-white font-semibold rounded-lg transition-colors text-sm shadow-xs"
          >
            Finish setup
          </Button>
        </div>
      </div>
    </div>
  );
}
