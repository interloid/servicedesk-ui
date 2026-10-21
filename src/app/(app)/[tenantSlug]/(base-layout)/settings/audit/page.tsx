import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";
import { serverNow } from "@/features/team/services/team.service";
import { AuditLocked } from "@/features/audit/components/audit-locked";
import { AuditLogView } from "@/features/audit/components/audit-log-view";
import {
  getAuditAccess,
  getAuditTimeZone,
  loadAuditPage,
} from "@/features/audit/services/audit.service";
import {
  AUDIT_RETENTION_DAYS,
  addDays,
  auditFiltersToQuery,
  parseAuditFilters,
  todayIn,
  type AuditPageData,
  type AuditSearchParams,
} from "@/features/audit/types/audit";

export const metadata: Metadata = {
  title: "Audit log",
  description: "Track administrative and security-related activity",
};

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<AuditSearchParams>;
}) {
  const [{ tenantSlug }, query] = await Promise.all([params, searchParams]);

  // Gate on the server before anything is read; the sidebar hiding the link
  // is not a guard.
  const access = await getAuditAccess();

  if (access.status === "forbidden") {
    notFound();
  }

  if (access.status === "locked") {
    return (
      <AuditLocked
        plansHref={tenantPath(tenantSlug, TENANT_ROUTES.ACCOUNT.PLANS)}
        canUpgrade={access.canUpgrade}
      />
    );
  }

  const [timeZone, now] = await Promise.all([
    getAuditTimeZone(access.tenantId),
    serverNow(),
  ]);
  const filters = parseAuditFilters(query, { timeZone, now });
  const today = todayIn(timeZone, now);

  let data: AuditPageData | null = null;

  try {
    data = await loadAuditPage(filters, timeZone);
  } catch (error) {
    console.error("[audit] page load failed", error);
  }

  if (!data) {
    return (
      <div className="h-full overflow-y-auto p-4 font-sans sm:p-6 lg:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
        <div className="mt-6 rounded-[14px] border border-border bg-card p-8 text-center">
          <p className="font-medium">We couldn&apos;t load the audit log.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Refresh the page to try again. If this keeps happening, the database
            may be missing migration 20261021120000_audit_log_page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AuditLogView
      // A new query string (filters, page, back button) starts the view
      // afresh, so the filter boxes always show what the table is showing.
      key={auditFiltersToQuery(filters)}
      data={data}
      filters={filters}
      timeZone={timeZone}
      now={now}
      today={today}
      earliest={addDays(today, -(AUDIT_RETENTION_DAYS - 1))}
    />
  );
}
