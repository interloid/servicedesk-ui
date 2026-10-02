import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PortalShell } from "@/features/portal/components/portal-shell";
import {
  getPortalIdentity,
  getPortalSupportHours,
  getPortalTenant,
} from "@/features/portal/services/portal.service";

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug } = await params;
  const tenant = await getPortalTenant(tenantSlug);

  return {
    title: {
      default: tenant ? `${tenant.name} Support` : "Support",
      template: tenant ? `%s · ${tenant.name} Support` : "%s · Support",
    },
    robots: { index: false, follow: false },
  };
}

export default async function PortalLayout({ children, params }: LayoutProps) {
  const { tenantSlug } = await params;

  const tenant = await getPortalTenant(tenantSlug);

  if (!tenant) {
    notFound();
  }

  // The identity is resolved here rather than passed down from each page so the
  // header shows who is signed in on every screen, including the ones that do
  // not otherwise need it.
  const [identity, supportHours] = await Promise.all([
    getPortalIdentity(tenantSlug),
    getPortalSupportHours(tenant.id),
  ]);

  return (
    <PortalShell
      tenant={tenant}
      customer={identity?.customer}
      supportHours={supportHours}
    >
      {children}
    </PortalShell>
  );
}
