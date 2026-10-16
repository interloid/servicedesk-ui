import { notFound } from "next/navigation";
import ReportsDashboard from "@/features/reports/components/reports-dashboard";
import { fetchReportsData } from "@/features/reports/service/reports.service";
import { parseReportRange } from "@/features/reports/types/types";
import { getCallerRole } from "@/features/team/services/team.service";

export const metadata = {
  title: "Reports | ServiceDesk Pro",
  description: "Performance metrics, SLA attainment, and agent workload.",
};

interface ReportsPageProps {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsPage({
  params,
  searchParams,
}: ReportsPageProps) {
  // Gate on the server, before anything is read. The sidebar only hides the
  // link, and the proxy and RoleRouteGuard let agents through, so without this
  // an agent with the URL sees every colleague's figures.
  const callerRole = await getCallerRole();

  if (callerRole !== "Tenant Admin" && callerRole !== "Manager") {
    notFound();
  }

  const [{ tenantSlug }, query] = await Promise.all([params, searchParams]);

  // The range lives in the URL so a chosen period survives a reload and a
  // shared link.
  const rangeParam = Array.isArray(query.range) ? query.range[0] : query.range;
  const data = await fetchReportsData(tenantSlug, parseReportRange(rangeParam));

  return (
    <main className="w-full">
      <ReportsDashboard data={data} />
    </main>
  );
}
