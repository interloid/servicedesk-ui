"use client";

import React from "react";

interface StepperHeaderProps {
  currentStep: number;
}

const mainSteps = [
  { id: 1, label: "Your account" },
  { id: 2, label: "Organization" },
  { id: 3, label: "Set up" },
];

const subSteps = [
  { id: 3, label: "Business hours" },
  { id: 4, label: "First SLA policy" },
  { id: 5, label: "Invite your team" },
];

export function StepperHeader({ currentStep }: StepperHeaderProps) {
  // Phase 1: Main account setup (Steps 1 & 2)
  if (currentStep <= 2) {
    return (
      <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 border border-slate-100 mb-6">
        {mainSteps.map((step) => {
          const isActive = step.id === currentStep;
          const isCompleted = step.id < currentStep;

          return (
            <div key={step.id} className="flex items-center space-x-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  isActive || isCompleted
                    ? "bg-teal-700 text-white"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {step.id}
              </div>
              <span
                className={`text-xs font-semibold ${
                  isActive ? "text-slate-900" : "text-slate-500"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // Phase 2: Detailed desk configuration (Steps 3, 4 & 5)
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 border border-slate-100 mb-6">
      {subSteps.map((step) => {
        const isActive = step.id === currentStep;
        const isCompleted = step.id < currentStep;

        return (
          <div key={step.id} className="flex items-center space-x-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                isActive || isCompleted
                  ? "bg-teal-700 text-white"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {step.id - 2}
            </div>
            <span
              className={`text-xs font-semibold ${
                isActive ? "text-slate-900" : "text-slate-500"
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}