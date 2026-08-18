import Link from "next/link";
import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard";
import { getTimezones } from "@/features/onboarding/services/onboarding.service";

export default async function SetupPage() {
  const timezones = await getTimezones();

  return (
    <main className="h-full bg-slate-50/50 flex flex-col items-center justify-center p-4 antialiased">
      <Link
        href="/"
        className="flex items-center space-x-2 mb-6 group cursor-pointer select-none"
      >
        <div className="h-8 w-8 bg-teal-700 rounded-lg flex items-center justify-center text-white font-bold transition-transform group-hover:scale-105 shadow-sm">
          N
        </div>
        <span className="text-lg font-bold text-slate-900 group-hover:text-teal-700 transition-colors">
          ServiceDesk Pro
        </span>
      </Link>

      <OnboardingWizard timezones={timezones} />
    </main>
  );
}
