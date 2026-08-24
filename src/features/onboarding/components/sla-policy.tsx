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
  {
    priority: "Urgent",
    firstReply: "15 minutes",
    resolve: "4 hours",
  },
  {
    priority: "High",
    firstReply: "1 hour",
    resolve: "8 business hours",
  },
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
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <div className="space-y-1 text-left">
        <h3 className="text-base sm:text-lg font-bold text-slate-900">
          Set your first SLA targets
        </h3>

        <p className="text-xs sm:text-sm text-slate-500">
          Targets run on business hours. You can add more policies later.
        </p>
      </div>

      <div className="w-full overflow-hidden rounded-xl sm:rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        {slaTargets.map((sla) => {
          const styles = getPriorityBadgeStyles(sla.priority);

          return (
            <div
              key={sla.priority}
              className={cn(
                "grid items-center",
                "grid-cols-1",
                "sm:grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)]",
                "gap-3 sm:gap-5",
                "px-3 sm:px-4",
                "py-4",
                "text-xs sm:text-sm",
                "border-b border-slate-100",
                "last:border-b-0",
                "hover:bg-slate-50/50",
                "transition-colors",
              )}
            >
              <div className="flex items-center">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5",
                    "px-3 py-1",
                    "rounded-full",
                    "text-xs font-bold",
                    "border",
                    "whitespace-nowrap",
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

              <div className="flex items-center gap-2 min-w-0">
                <span className="text-slate-500 shrink-0">First reply</span>

                <span className="font-bold text-slate-900 min-w-0">
                  {sla.firstReply}
                </span>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <span className="text-slate-500 shrink-0">Resolve</span>

                <span className="font-bold text-slate-900 min-w-0">
                  {sla.resolve}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "flex flex-col-reverse",
          "sm:flex-row sm:items-center sm:justify-between",
          "gap-3 sm:gap-4",
          "pt-2 sm:pt-4",
        )}
      >
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="w-full sm:w-auto h-11 px-5 text-sm font-semibold"
        >
          Back
        </Button>

        <div
          className={cn(
            "flex flex-col",
            "sm:flex-row sm:items-center",
            "gap-2.5 sm:gap-3",
            "w-full sm:w-auto",
          )}
        >
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
            onClick={onNext}
            className="w-full sm:w-auto h-11 px-6 text-sm font-semibold"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
