import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard";
import { getTimezones } from "@/features/onboarding/services/onboarding.service";
import { AuthShell } from "@/features/auth/components/auth-card";

export default async function SetupPage() {
  const timezones = await getTimezones();

  return (
    <AuthShell>
      <OnboardingWizard timezones={timezones} />
    </AuthShell>
  );
}
