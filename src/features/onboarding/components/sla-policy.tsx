"use client";

import React from "react";
import { OnboardingState, SlaTarget } from "../types/onboarding";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StepSlaPolicyProps {
  data: OnboardingState;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}

const DEFAULT_SLA_TARGETS: SlaTarget[] = [
  { priority: "Urgent", firstReply: "15 minutes", resolve: "4 hours" },
  { priority: "High", firstReply: "1 hour", resolve: "8 business hours" },
  {
    priority: "Normal",
    firstReply: "4 business hours",
    resolve: "2 business days",
  },
  { priority: "Low", firstReply: "1 business day", resolve: "5 business days" },
];

export function StepSlaPolicy({
  data,
  onNext,
  onSkip,
  onBack,
}: StepSlaPolicyProps) {
  const slaTargets = data?.slaTargets?.length
    ? data.slaTargets
    : DEFAULT_SLA_TARGETS;

  const getPriorityBadgeStyles = (priority: string) => {
    switch (priority.toLowerCase()) {
      case "urgent":
        return {
          bg: "bg-red-50 text-red-700 border-red-100",
          dot: "bg-red-500",
        };
      case "high":
        return {
          bg: "bg-amber-50 text-amber-800 border-amber-100",
          dot: "bg-amber-500",
        };
      case "normal":
        return {
          bg: "bg-sky-50 text-sky-800 border-sky-100",
          dot: "bg-sky-500",
        };
      case "low":
        return {
          bg: "bg-slate-100 text-slate-700 border-slate-200",
          dot: "bg-slate-500",
        };
      default:
        return {
          bg: "bg-slate-100 text-slate-700 border-slate-200",
          dot: "bg-slate-400",
        };
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="space-y-1 text-left">
        <h3 className="text-base font-bold text-slate-900">
          Set your first SLA targets
        </h3>
        <p className="text-xs sm:text-sm text-slate-500">
          Targets run on business hours. You can add more policies later.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white divide-y divide-slate-100 overflow-hidden shadow-xs text-left">
        {slaTargets.map((sla) => {
          const styles = getPriorityBadgeStyles(sla.priority);

          return (
            <div
              key={sla.priority}
              className="flex flex-col sm:grid sm:grid-cols-12 sm:items-center px-4 sm:px-6 py-3.5 sm:py-4 text-xs sm:text-sm hover:bg-slate-50/50 transition-colors gap-2 sm:gap-4"
            >
              <div className="sm:col-span-3 flex items-center">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border",
                    styles.bg,
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      styles.dot,
                    )}
                  />
                  {sla.priority}
                </span>
              </div>

              <div className="sm:col-span-9 flex flex-col xs:flex-row xs:items-center sm:grid sm:grid-cols-9 gap-1.5 xs:gap-4 sm:gap-2 text-slate-500">
                <div className="sm:col-span-5 whitespace-nowrap">
                  First reply{" "}
                  <span className="font-bold text-slate-900">
                    {sla.firstReply}
                  </span>
                </div>

                <div className="sm:col-span-4 whitespace-nowrap">
                  Resolve{" "}
                  <span className="font-bold text-slate-900">
                    {sla.resolve}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pt-2 sm:pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="w-full sm:w-auto h-10 rounded-xl px-5 text-sm font-semibold text-emerald-800 bg-emerald-50/50"
        >
          Back
        </Button>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
            className="w-full sm:w-auto h-11 px-5 border-slate-300 text-emerald-800 font-semibold rounded-lg hover:bg-slate-50 text-sm"
          >
            Skip for now
          </Button>

          <Button
            type="button"
            onClick={onNext}
            className="w-full sm:w-auto h-11 px-6 bg-emerald-800 hover:bg-emerald-900 text-white font-semibold rounded-lg transition-colors text-sm"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
