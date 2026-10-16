import { ReportsSkeleton } from "@/features/reports/components/reports-skeleton";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 */
export default function Loading() {
  return (
    <main className="w-full">
      <ReportsSkeleton />
    </main>
  );
}
