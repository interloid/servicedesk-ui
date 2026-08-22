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
  const activeSteps = isMainPhase ? mainSteps : subSteps;

  const currentStepObj =
    activeSteps.find((s) => s.id === currentStep) || activeSteps[0];
  const activeDisplayIndex = isMainPhase ? currentStep : currentStep - 2;

  return (
    <div className="rounded-xl bg-slate-50 p-3 sm:p-4 border border-slate-100 mb-6 w-full">
      <div className="flex sm:hidden flex-col gap-2">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="text-slate-900">{currentStepObj.label}</span>
          <span className="text-slate-500">
            Step {activeDisplayIndex} of {activeSteps.length}
          </span>
        </div>
        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-teal-700 h-full transition-all duration-300"
            style={{
              width: `${(activeDisplayIndex / activeSteps.length) * 100}%`,
            }}
          />
        </div>
      </div>

      <div className="hidden sm:flex items-center justify-between gap-2">
        {activeSteps.map((step, index) => {
          const isActive = step.id === currentStep;
          const isCompleted = step.id < currentStep;
          const displayId = isMainPhase ? step.id : step.id - 2;

          return (
            <div
              key={step.id}
              className="flex items-center flex-1 last:flex-initial min-w-0"
            >
              <div className="flex items-center space-x-2 shrink-0">
                <div
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                    isActive || isCompleted
                      ? "bg-teal-700 text-white"
                      : "bg-slate-200 text-slate-600",
                  )}
                >
                  {displayId}
                </div>
                <span
                  className={cn(
                    "text-xs font-semibold truncate max-w-25 md:max-w-none",
                    isActive ? "text-slate-900" : "text-slate-500",
                  )}
                >
                  {step.label}
                </span>
              </div>

              {index < activeSteps.length - 1 && (
                <div
                  className={cn(
                    "h-0.5 flex-1 mx-2 transition-colors hidden md:block",
                    isCompleted ? "bg-teal-700" : "bg-slate-200",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
