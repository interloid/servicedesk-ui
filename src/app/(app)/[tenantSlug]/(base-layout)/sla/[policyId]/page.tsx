import { notFound } from "next/navigation";
import SlaEditor from "@/features/sla-policies/components/sla-editor";
import { getSlaEditorData } from "@/features/sla-policies/service/sla.service";

export const metadata = {
  title: "Edit SLA policy",
};

interface EditSlaPolicyPageProps {
  params: Promise<{ tenantSlug: string; policyId: string }>;
}

export default async function EditSlaPolicyPage({
  params,
}: EditSlaPolicyPageProps) {
  const { tenantSlug, policyId } = await params;
  const { value, businessHours, customers, otherPolicies, canManage } =
    await getSlaEditorData(tenantSlug, policyId);

  if (!value) {
    notFound();
  }

  return (
    // min-h-full, not h-full: the editor is taller than the viewport on most
    // screens, and h-full pinned this wrapper to exactly the scroll area's
    // height -- the card then overflowed past its own padding-bottom and sat
    // flush against the app footer.
    <div className="min-h-full bg-slate-50/50 p-4 pb-10 font-sans antialiased sm:p-6 lg:p-8">
      <div className="mx-auto max-w-8xl">
        <SlaEditor
          tenant={tenantSlug}
          mode="edit"
          initial={value}
          businessHours={businessHours}
          customers={customers}
          otherPolicies={otherPolicies}
          readOnly={!canManage}
        />
      </div>
    </div>
  );
}
