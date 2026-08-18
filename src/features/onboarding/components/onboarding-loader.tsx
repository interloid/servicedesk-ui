"use client";

import Image from "next/image";

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
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-3xl bg-white p-8 text-center animate-in fade-in duration-200">
      <div className="flex max-w-sm flex-col items-center gap-6">
        <Image
          src="/startup.svg"
          alt="Setting up tenant"
          width={208}
          height={208}
          priority
          className="h-44 w-44 object-contain drop-shadow-sm sm:h-52 sm:w-52 animate-pulse"
        />

        <div>
          <h4 className="text-xl font-bold text-slate-900">{title}</h4>
          <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
