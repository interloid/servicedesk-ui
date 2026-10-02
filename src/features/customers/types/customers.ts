import { z } from "zod";

import type { Database } from "@/lib/supabase/database.types";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";

/**
 * Client-safe types and helpers for the Customers pages. The service imports
 * "server-only", so anything a client component needs lives here instead.
 */

export type TicketStatus = Database["public"]["Enums"]["ticket_status"];

/**
 * Where a customer stands with the support portal, from their `memberships`
 * row: invited and not signed in yet, signed in, or switched off by a Tenant
 * Admin. "Not invited" is a customer with no membership at all -- typically
 * someone who raised a ticket as a guest and never signed in.
 */
export type CustomerPortalStatus =
  "Active" | "Invited" | "Disabled" | "Not invited";

export const CUSTOMER_PORTAL_STATUS_FROM_DB: Record<
  string,
  CustomerPortalStatus
> = {
  active: "Active",
  invited: "Invited",
  disabled: "Disabled",
};

/** Same colours as the team table's status badges. */
export const CUSTOMER_STATUS_BADGE: Record<CustomerPortalStatus, string> = {
  Active:
    "border-none bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  Invited:
    "border-none bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  Disabled: "border-none bg-muted text-muted-foreground",
  "Not invited": "border border-border bg-transparent text-muted-foreground",
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
  portalStatus: CustomerPortalStatus;
};

export type CustomerContact = {
  id: string;
  name: string;
  email: string;
  portalActive: boolean;
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
 * A `?page=` value, or 1.
 *
 * Anything that is not a whole number at or above one -- a hand-edited URL, a
 * stale bookmark, `?page=-4` -- falls back to the first page. Validating here
 * rather than at the query keeps a junk address from becoming a negative range
 * offset.
 */
export function parsePageParam(value: string | undefined): number {
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
  avatarUrl: string | null;
  openTicketsCount: number;
  /** Mean CSAT, or null when nobody has rated this customer. */
  csatScore: number | null;
  /** Ratings the mean is over; 0 whenever `csatScore` is null. */
  csatCount: number;
  /** Other customers recorded against the same company. */
  contacts: CustomerContact[];
  portalStatus: CustomerPortalStatus;
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
  return score === null ? "-" : score.toFixed(1);
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

export function customerPath(tenantSlug: string, customerId: string): string {
  return tenantPath(
    tenantSlug,
    `${TENANT_ROUTES.CUSTOMERS}/${encodeURIComponent(customerId)}`,
  );
}

/** Customers per page on the Customers list. */
export const CUSTOMER_LIST_PAGE_SIZE = 10;

/**
 * The columns the list can sort by. Name, company and date added sort in SQL;
 * ticket count, last activity and CSAT are computed per customer, so the
 * service sorts those after reading every matching customer.
 */
export const CUSTOMER_SORT_KEYS = [
  "fullName",
  "company",
  "ticketCount",
  "lastActivityAt",
  "createdAt",
  "csatScore",
] as const;

export type CustomerSortKey = (typeof CUSTOMER_SORT_KEYS)[number];

export type CustomerSort = {
  key: CustomerSortKey;
  direction: "asc" | "desc";
};

export const DEFAULT_CUSTOMER_SORT: CustomerSort = {
  key: "fullName",
  direction: "asc",
};

/** Which way a column sorts the first time it is clicked. */
export function defaultSortDirection(key: CustomerSortKey): "asc" | "desc" {
  // Numbers and dates start with the largest or newest first.
  return key === "fullName" || key === "company" ? "asc" : "desc";
}

/** `?sort=&dir=` from the URL, falling back to name A-Z for anything else. */
export function parseCustomerSort(
  sort: string | undefined,
  dir: string | undefined,
): CustomerSort {
  if (!(CUSTOMER_SORT_KEYS as readonly string[]).includes(sort ?? "")) {
    return DEFAULT_CUSTOMER_SORT;
  }

  const key = sort as CustomerSortKey;
  const direction =
    dir === "asc" || dir === "desc" ? dir : defaultSortDirection(key);

  return { key, direction };
}

/** One page of the Customers list, with what the pager needs. */
export type CustomerListPage = {
  customers: CustomerListItem[];
  /** Customers matching the search, across all pages. */
  total: number;
  /** Customers in the tenant, whatever the search; drives the empty state. */
  tenantTotal: number;
  /** 1-based, and never past `pageCount`. */
  page: number;
  pageCount: number;
};

/**
 * A well-formed customer id. Postgres rejects anything else with 22P02, so a
 * malformed URL is answered with a 404 before it reaches the database.
 * `z.guid()` rather than `z.uuid()`: Postgres accepts any 8-4-4-4-12 hex id,
 * whatever its version bits, and so must this.
 */
export function isCustomerId(value: string): boolean {
  return z.guid().safeParse(value).success;
}
