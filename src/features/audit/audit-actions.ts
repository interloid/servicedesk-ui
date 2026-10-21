"use server";

import {
  AuditError,
  exportAuditLog,
  getAuditAccess,
  getAuditTimeZone,
} from "@/features/audit/services/audit.service";
import {
  parseAuditFilters,
  type AuditExportResult,
} from "@/features/audit/types/audit";

/**
 * Builds the CSV for the filters in `query` (the page's own query string), so
 * the file holds exactly what the table shows, page aside. The filters are
 * parsed again here rather than trusted from the browser.
 */
export async function exportAuditLogAction(
  query: string,
): Promise<AuditExportResult> {
  try {
    const access = await getAuditAccess();

    if (access.status !== "ok") {
      return {
        ok: false,
        message:
          access.status === "locked"
            ? "The audit log is available on the Business plan."
            : "You don't have access to the audit log.",
      };
    }

    const timeZone = await getAuditTimeZone(access.tenantId);
    const params = Object.fromEntries(new URLSearchParams(query));
    const filters = parseAuditFilters(params, { timeZone, now: Date.now() });
    // The export writes an audit row of its own; the page refreshes after the
    // download to show it.
    return await exportAuditLog(filters);
  } catch (error) {
    if (!(error instanceof AuditError)) {
      console.error("[audit] export failed", error);
    }

    return {
      ok: false,
      message: "We couldn't export the audit log. Try again in a moment.",
    };
  }
}
