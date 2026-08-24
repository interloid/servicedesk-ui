import { cn } from "@/lib/utils";

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
  const isMainPhase = currentStep <= 2;
  const stepsToRender = isMainPhase ? mainSteps : subSteps;

  return (
    <div className="w-full rounded-2xl bg-slate-50/70 border border-slate-200/80 p-3 sm:p-4 mb-6">
      <div className="flex sm:hidden flex-col gap-3">
        {stepsToRender.map((step, idx) => {
          const isActive = step.id === currentStep;
          const isCompleted = step.id < currentStep;
          const displayId = isMainPhase ? step.id : idx + 1;

          return (
            <div key={step.id} className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  isActive
                    ? "bg-teal-700 text-primary-foreground "
                    : isCompleted
                      ? "bg-teal-700/15 text-teal-800"
                      : "bg-slate-200/80 text-slate-500",
                )}
              >
                {displayId}
              </div>
              <span
                className={cn(
                  "text-xs sm:text-sm font-semibold transition-colors truncate",
                  isActive
                    ? "text-slate-900 font-bold"
                    : isCompleted
                      ? "text-slate-700"
                      : "text-slate-400",
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="hidden sm:flex items-center justify-between gap-4">
        {stepsToRender.map((step, idx) => {
          const isActive = step.id === currentStep;
          const isCompleted = step.id < currentStep;
          const displayId = isMainPhase ? step.id : idx + 1;

          return (
            <div key={step.id} className="flex items-center space-x-2 shrink-0">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  isActive
                    ? "bg-teal-700 text-primary-foreground "
                    : isCompleted
                      ? "bg-teal-700/15 text-teal-800"
                      : "bg-slate-200/80 text-slate-500",
                )}
              >
                {displayId}
              </div>
              <span
                className={cn(
                  "text-xs font-semibold whitespace-nowrap transition-colors",
                  isActive
                    ? "text-slate-900"
                    : isCompleted
                      ? "text-slate-700"
                      : "text-slate-400",
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
