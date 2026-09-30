import type { Database } from "@/lib/supabase/database.types";
import type { TeamRole } from "@/features/team/types/team";

/**
 * Client-safe types and helpers for the Customers pages. The service imports
 * "server-only", so anything a client component needs lives here instead.
 */

export type TicketStatus = Database["public"]["Enums"]["ticket_status"];

/**
 * Where a customer stands with the portal.
 *
 * "none" is the honest default: no membership row, or one that has been
 * switched off. A customer who signed in without ever being invited reads
 * "none" too until `customers.portal_user_id` says otherwise, which is why
 * PortalInviteStatus alone must never stand in for `portalActive`.
 */
export type PortalInviteStatus = "none" | "invited" | "active";

export type PortalInvite = {
  status: PortalInviteStatus;
  /** When the last invite went out; null when none is outstanding. */
  invitedAt: string | null;
  /** Who sent it, when that user still has a name on file. */
  invitedBy: string | null;
};

/**
 * The invite is a `memberships` row with role = 'customer' and status =
 * 'invited' -- the same columns a team invite uses, so "invited" needs no
 * column of its own. custom_access_token_hook flips the row to 'active' and
 * stamps joined_at on the customer's first sign-in, which is what makes the
 * first click the acceptance.
 */
export const PORTAL_INVITE_ROLES: readonly TeamRole[] = ["Tenant Admin"];

/**
 * Only a Tenant Admin may hand a customer a portal invite. Not a Manager:
 * a portal account is an outside identity in the workspace, so unlike a team
 * seat it is not something a day-to-day supervisor hands out. The service
 * re-checks the same rule, because this only decides what the page offers.
 */
export function canInviteToPortal(role: TeamRole | null): boolean {
  return role !== null && PORTAL_INVITE_ROLES.includes(role);
}

export const PORTAL_STATUS_LABEL: Record<PortalInviteStatus, string> = {
  none: "Not signed in yet",
  invited: "Invited",
  active: "Portal active",
};

export const PORTAL_STATUS_BADGE: Record<PortalInviteStatus, string> = {
  active:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  invited: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  none: "bg-muted text-muted-foreground",
};

export type CustomerInviteFailureCode =
  | "customer-not-found"
  | "action-not-allowed"
  | "already-active"
  | "validation"
  | "unknown";

export type CustomerInviteResult = {
  ok: boolean;
  failureCode?: CustomerInviteFailureCode;
  message?: string;
};

export type CustomerListItem = {
  id: string;
  fullName: string;
  email: string;
  company: string | null;
  createdAt: string;
  /** Has signed in to the portal at least once. */
  portalActive: boolean;
  /** Photo set in the portal's Profile settings; null shows initials. */
  avatarUrl: string | null;
  ticketCount: number;
  /** When their most recently touched ticket last changed; null with none. */
  lastActivityAt: string | null;
  /** Mean of the 1-5 scores this customer has given; null with none. */
  csatScore: number | null;
  /** Ratings behind that mean, so one 5 never reads like fifty. */
  csatCount: number;
};

export type CustomerContact = {
  id: string;
  name: string;
  email: string;
  portalActive: boolean;
  /** Pending or accepted portal invitation, if there is one. */
  invite: PortalInvite;
  avatarUrl: string | null;
};

export type CustomerTicket = {
  id: string;
  number: number | null;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

/** Tickets per page on a customer's Tickets tab. */
export const CUSTOMER_TICKET_PAGE_SIZE = 10;

/**
 * One page of a customer's tickets, and everything the pager needs to draw
 * itself around them.
 *
 * `page` is the page actually read, not the one that was asked for: a link to
 * page 40 of a customer with twelve tickets lands on page 2 rather than on an
 * empty list, and the numbers below are the ones that were rendered.
 */
export type CustomerTicketPage = {
  /** Newest first. */
  tickets: CustomerTicket[];
  /** Every ticket this customer has raised, across all pages. */
  total: number;
  /** 1-based, and never past `pageCount`. */
  page: number;
  /** At least 1, so the pager has something to draw with no tickets at all. */
  pageCount: number;
};

/**
 * The `?page=` value, or 1.
 *
 * Anything that is not a whole number at or above one -- a hand-edited URL, a
 * stale bookmark, `?page=-4` -- falls back to the first page. Validating here
 * rather than at the query keeps a junk address from becoming a negative range
 * offset.
 */
export function parseCustomerTicketPage(value: string | undefined): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export type CustomerDetail = {
  id: string;
  fullName: string;
  email: string;
  company: string | null;
  phone: string | null;
  createdAt: string;
  portalActive: boolean;
  /** Pending or accepted portal invitation, if there is one. */
  invite: PortalInvite;
  avatarUrl: string | null;
  openTicketsCount: number;
  /** Mean CSAT, or null when nobody has rated this customer. */
  csatScore: number | null;
  /** Ratings the mean is over; 0 whenever `csatScore` is null. */
  csatCount: number;
  /** Other customers recorded against the same company. */
  contacts: CustomerContact[];
};

export const CUSTOMER_TABS = ["overview", "tickets"] as const;

export type CustomerTab = (typeof CUSTOMER_TABS)[number];

export function isCustomerTab(value: string | undefined): value is CustomerTab {
  return (CUSTOMER_TABS as readonly string[]).includes(value ?? "");
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  new: "New",
  open: "Open",
  pending: "Pending",
  on_hold: "On hold",
  resolved: "Resolved",
  closed: "Closed",
};

export const TICKET_STATUS_BADGE: Record<TicketStatus, string> = {
  new: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  open: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  pending:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  on_hold:
    "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  resolved:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  closed: "bg-muted text-muted-foreground",
};

/**
 * Scores are 1-5, so one decimal is as much precision as a mean deserves.
 * Unrated customers are "—", not 0.0: nobody gave them a bad score.
 */
export function formatCsatScore(score: number | null): string {
  return score === null ? "—" : score.toFixed(1);
}

/** "4.5 out of 5, from 12 ratings" -- the number and what it averages over. */
export function csatScoreTitle(score: number | null, count: number): string {
  if (score === null || count === 0) {
    return "No ratings yet";
  }

  return `${formatCsatScore(score)} out of 5, from ${count} ${
    count === 1 ? "rating" : "ratings"
  }`;
}

/**
 * Text colour only, no background.
 *
 * This was a badge -- a filled pill per score -- and a table column is the
 * wrong place for one: at 11% of the width the pill was clipped by its own
 * cell, and a row of six of them read louder than the names beside them. The
 * score still carries its band, just as ink rather than as a chip.
 *
 * Loose bands, not a target: green reads well, a bad month still reads.
 */
export const CSAT_TEXT: Record<"good" | "fair" | "poor", string> = {
  good: "text-emerald-700 dark:text-emerald-300",
  fair: "text-amber-700 dark:text-amber-300",
  poor: "text-rose-700 dark:text-rose-300",
};

export function csatTone(score: number | null): string {
  if (score === null) return "";
  if (score >= 4) return CSAT_TEXT.good;
  if (score >= 3) return CSAT_TEXT.fair;
  return CSAT_TEXT.poor;
}

export function customerInitials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length > 0) {
    return parts
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  return email.charAt(0).toUpperCase() || "?";
}

/**
 * "Sep 28, 2026". Formatted in UTC, like the team table, so the server render
 * and the browser agree on the day whatever timezone either is in.
 */
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatCustomerDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }

  const parsed = Date.parse(iso);

  return Number.isNaN(parsed) ? "—" : DATE_FORMAT.format(parsed);
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** "52 minutes ago", against the server's `now` so both renders agree. */
export function formatCustomerRelative(
  iso: string | null,
  now: number,
): string {
  if (!iso) {
    return "—";
  }

  const elapsed = now - Date.parse(iso);

  if (Number.isNaN(elapsed)) {
    return "—";
  }

  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) {
      return RELATIVE.format(-Math.round(elapsed / size), unit);
    }
  }

  return "just now";
}
