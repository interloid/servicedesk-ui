import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requestOrigin } from "@/features/auth/services/auth.service";
import { BrandingEditor } from "@/features/branding/components/branding-editor";
import { BrandingLocked } from "@/features/branding/components/branding-locked";
import {
  canEditBranding,
  getBranding,
  hasBrandingAccess,
} from "@/features/branding/services/branding.service";
import { getActorOrNull } from "@/features/team/services/team.service";

export const metadata: Metadata = {
  title: "Branding",
};

export default async function BrandingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const [{ tenantSlug }, actor, branding, canEdit, origin] = await Promise.all([
    params,
    getActorOrNull(),
    getBranding(),
    canEditBranding(),
    requestOrigin(),
  ]);

  if (!branding || !actor) {
    notFound();
  }

  // Free plan: the editor is shown blurred and read-only under a lock. The
  // save and upload actions refuse on their own as well.
  if (!(await hasBrandingAccess(actor.tenantId))) {
    return (
      <BrandingLocked
        tenantSlug={tenantSlug}
        branding={branding}
        portalOrigin={origin}
        canUpgrade={actor.role === "Tenant Admin"}
      />
    );
  }

  return (
    <BrandingEditor
      branding={branding}
      canEdit={canEdit}
      portalOrigin={origin}
    />
  );
}
