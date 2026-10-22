import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PortalShell } from "@/features/portal/components/portal-shell";
import { portalFaviconDataUrl } from "@/features/portal/portal";
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

  const logoUrl = tenant?.logoUrl?.trim();

  return {
    title: {
      default: tenant ? `${tenant.name} Support` : "Support",
      template: tenant ? `%s · ${tenant.name} Support` : "%s · Support",
    },
    // The workspace's logo, else a generated initial tile; ServiceDesk Pro's
    // own icon only when the workspace can't be found.
    icons: logoUrl
      ? {
          icon: [{ url: logoUrl }],
          shortcut: [{ url: logoUrl }],
        }
      : tenant
        ? {
            icon: [
              { url: portalFaviconDataUrl(tenant), type: "image/svg+xml" },
            ],
          }
        : {
            icon: [{ url: "/icon.svg" }],
            shortcut: [{ url: "/icon.svg" }],
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
  // not otherwise need it. The footer's hours follow it: a signed-in customer
  // with their own SLA policy is quoted that policy's hours.
  const identity = await getPortalIdentity(tenantSlug);
  const supportHours = await getPortalSupportHours(
    tenant.id,
    identity?.customer.id ?? null,
  );

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
