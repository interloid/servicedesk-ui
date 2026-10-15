import type { Metadata } from "next";

import { requestOrigin } from "@/features/auth/services/auth.service";
import { BrandingEditor } from "@/features/branding/components/branding-editor";
import {
  canEditBranding,
  getBranding,
} from "@/features/branding/services/branding.service";

export const metadata: Metadata = {
  title: "Branding",
  alternates: {
    canonical: "/settings/branding",
  },
};

export default async function BrandingPage() {
  const [branding, canEdit, origin] = await Promise.all([
    getBranding(),
    canEditBranding(),
    requestOrigin(),
  ]);

  if (!branding) {
    return null;
  }

  return (
    <BrandingEditor
      branding={branding}
      canEdit={canEdit}
      portalOrigin={origin}
    />
  );
}
