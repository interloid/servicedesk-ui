import SlaEditor from "@/features/sla-policies/components/sla-editor";
import { getSlaEditorData } from "@/features/sla-policies/service/sla.service";

export const metadata = {
  title: "Create SLA policy",
};

interface NewSlaPolicyPageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function NewSlaPolicyPage({
  params,
}: NewSlaPolicyPageProps) {
  const { tenantSlug } = await params;
  const { value, businessHours, customers, otherPolicies } =
    await getSlaEditorData(tenantSlug);

  return (
    <div className="min-h-full bg-slate-50/50 p-4 pb-10 font-sans antialiased sm:p-6 lg:p-8">
      <div className="mx-auto max-w-8xl">
        <SlaEditor
          tenant={tenantSlug}
          mode="new"
          initial={value}
          businessHours={businessHours}
          customers={customers}
          otherPolicies={otherPolicies}
        />
      </div>
    </div>
  );
}
