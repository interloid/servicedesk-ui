import { notFound, redirect } from "next/navigation";
import SlaEditor from "@/features/sla-policies/components/sla-editor";
import {
  canManageSla,
  countTenantSlaPolicies,
  getSlaEditorData,
  getSlaPolicyQuota,
} from "@/features/sla-policies/service/sla.service";
import { hasPolicyRoom } from "@/features/sla-policies/types/types";

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

  // Same gates as the list's "New policy" button, for someone who types the
  // URL: agents can't create policies, and a full plan can't take another.
  const [canManage, quota, used] = await Promise.all([
    canManageSla(),
    getSlaPolicyQuota(tenantSlug),
    countTenantSlaPolicies(tenantSlug),
  ]);
  if (!canManage || !hasPolicyRoom(quota, used)) {
    redirect(`/${tenantSlug}/sla`);
  }

  const { value, businessHours, customers, otherPolicies } =
    await getSlaEditorData(tenantSlug);
  // Never null without a policy id; this only narrows the type.
  if (!value) notFound();

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
          readOnly={false}
        />
      </div>
    </div>
  );
}
