"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  defaultTenantLanding,
  isTenantRouteAllowed,
  stripTenantPrefix,
  tenantPath,
} from "@/lib/tenancy";

export function RoleRouteGuard({ role }: { role: string }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (role !== "billing_admin") {
      return;
    }

    const parsed = stripTenantPrefix(pathname);

    if (!parsed) {
      return;
    }

    if (isTenantRouteAllowed(role, parsed.rest)) {
      return;
    }

    router.replace(tenantPath(parsed.slug, defaultTenantLanding(role)));
  }, [pathname, role, router]);

  return null;
}
