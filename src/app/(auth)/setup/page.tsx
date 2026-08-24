import Link from "next/link";
import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard";
import { getTimezones } from "@/features/onboarding/services/onboarding.service";

export default async function SetupPage() {
  const timezones = await getTimezones();

  return (
    <main className="min-h-dvh w-full bg-slate-50/50 flex flex-col items-center justify-center p-4 sm:p-6 antialiased overflow-hidden">
      <Link
        href="/"
        className="flex items-center space-x-2 mb-4 sm:mb-6 group cursor-pointer select-none shrink-0"
      >
        <span className="h-8 w-8 bg-brand-accent rounded-lg flex items-center justify-center text-primary-foreground  font-bold transition-transform group-hover:scale-105 shadow-sm">
          N
        </span>
        <span className="text-lg font-bold text-slate-900  transition-colors">
          ServiceDesk Pro
        </span>
      </Link>

      <OnboardingWizard timezones={timezones} />
    </main>
  );
}
