"use client";
interface OnboardingLoaderProps {
  isLoading: boolean;
  title?: string;
  subtitle?: string;
}

export function OnboardingLoader({
  isLoading,
  title = "Setting up your workspace...",
  subtitle = "This will take just a moment.",
}: OnboardingLoaderProps) {
  if (!isLoading) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white rounded-3xl p-8 text-center animate-in fade-in duration-200">
      <div className="flex flex-col items-center gap-6 max-w-sm">
        {/* Scaled up SVG illustration */}
        <img
          src="/startup.svg"
          alt="Setting up tenant"
          className="h-44 w-44 sm:h-52 sm:w-52 animate-pulse object-contain drop-shadow-sm"
        />
        <div>
          <h4 className="text-xl font-bold text-slate-900">{title}</h4>
          <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
