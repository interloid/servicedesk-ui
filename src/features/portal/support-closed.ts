import { formatOpeningLong } from "@/features/tickets/lib/sla";
import type { ClosedReason } from "@/features/tickets/lib/sla-calendar";

/**
 * Support is closed under the business hours a portal ticket is (or would
 * be) measured on. Worked out on the server from the tenant's timezone,
 * working days and holidays -- the same calendar the SLA deadlines count --
 * so only the outcome reaches the browser, never the calendar itself.
 */
export interface PortalSupportClosed {
  reason: ClosedReason;
  /** The next business opening (ISO); null if the calendar has none. */
  opensAt: string | null;
}

function closedLead(reason: ClosedReason): string {
  return reason === "holiday"
    ? "Support is currently closed for a holiday."
    : reason === "non_working_day"
      ? "Support is closed today."
      : "Support is currently closed.";
}

function resumes(closed: PortalSupportClosed): string {
  return closed.opensAt
    ? `our team will resume support ${formatOpeningLong(Date.parse(closed.opensAt), Date.now())}`
    : "our team will get back to you when support reopens";
}

/** After the ticket is saved: "…created successfully, and our team will…". */
export function supportClosedCreatedMessage(
  closed: PortalSupportClosed,
): string {
  return `${closedLead(closed.reason)} Your ticket has been created successfully, and ${resumes(closed)}.`;
}

/** On the form, before they submit. */
export function supportClosedFormMessage(closed: PortalSupportClosed): string {
  return `${closedLead(closed.reason)} You can still create a ticket — ${resumes(closed)}.`;
}
