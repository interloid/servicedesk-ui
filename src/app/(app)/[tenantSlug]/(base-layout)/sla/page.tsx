import SlaPoliciesPage from "@/features/sla-policies/components/sla-policies-page";
import {
  fetchTenantSlaPolicies,
  getSlaPolicyQuota,
} from "@/features/sla-policies/service/sla.service";

export const metadata = {
  title: "SLA policies",
  description: "Manage SLA policies and ticket target escalations",
};

interface SlaPageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function SlaPage({ params }: SlaPageProps) {
  const { tenantSlug } = await params;
  const [initialPolicies, policyQuota] = await Promise.all([
    fetchTenantSlaPolicies(tenantSlug),
    getSlaPolicyQuota(tenantSlug),
  ]);

  return (
    <SlaPoliciesPage
      tenant={tenantSlug}
      initialPolicies={initialPolicies}
      policyQuota={policyQuota}
    />
  );
}
