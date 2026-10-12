import type {
  TicketPriority,
  TicketStatus,
} from "@/features/tickets/types/tickets.types";

export const TICKET_STATUSES: readonly TicketStatus[] = [
  "new",
  "open",
  "pending",
  "on_hold",
  "resolved",
  "closed",
] as const;

export const TICKET_PRIORITIES: readonly TicketPriority[] = [
  "urgent",
  "high",
  "normal",
  "low",
] as const;

export const STATUS_LABEL: Record<TicketStatus, string> = {
  new: "New",
  open: "Open",
  pending: "Pending",
  on_hold: "On hold",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * Deliberately not a user id.
 *
 * "me" is resolved against whoever is *looking*, not whoever saved the view, so
 * one shared "My open tickets" works for the whole team instead of pinning
 * everyone to its author's queue. Pinning a view to a specific person is a
 * different feature and wants an agent picker.
 */
export const ASSIGNEE_FILTERS = ["any", "unassigned", "me"] as const;

export type AssigneeFilter = (typeof ASSIGNEE_FILTERS)[number];

export const ASSIGNEE_LABEL: Record<AssigneeFilter, string> = {
  any: "Anyone",
  unassigned: "Unassigned",
  me: "Assigned to me",
};

/** The normalised filter every consumer works with. */
export type ViewFilter = {
  statuses: TicketStatus[];
  priorities: TicketPriority[];
  assignee: AssigneeFilter;
  search: string;
};

/**
 * What is actually stored in `saved_views.filter_json`.
 *
 * The singular `status` / `priority` strings are the legacy shape written
 * before this feature had a real filter model — a comma-joined list that the
 * ticket query then compared with `.eq()`, so `"open,pending"` matched nothing.
 * They are still read so existing rows keep working; nothing writes them.
 */
export type TicketFilterJson = {
  statuses?: string[];
  priorities?: string[];
  assignee?: string;
  search?: string;

  /** @deprecated legacy comma-joined form, read-only */
  status?: string;
  /** @deprecated legacy comma-joined form, read-only */
  priority?: string;
};

export const EMPTY_FILTER: ViewFilter = {
  statuses: [],
  priorities: [],
  assignee: "any",
  search: "",
};

function splitLegacy(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function keepKnown<T extends string>(
  values: string[] | undefined,
  allowed: readonly T[],
): T[] {
  const set = new Set<string>(allowed);

  return [...new Set(values ?? [])]
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is T => set.has(value));
}

/**
 * Read whatever is in the column into the current shape. Unknown values are
 * dropped rather than passed through: a stale status name in an old row must
 * not become an `.in()` term that silently matches nothing.
 */
export function normalizeFilter(raw: TicketFilterJson | null): ViewFilter {
  if (!raw) {
    return EMPTY_FILTER;
  }

  const statuses = keepKnown(
    raw.statuses ?? splitLegacy(raw.status),
    TICKET_STATUSES,
  );

  const priorities = keepKnown(
    raw.priorities ?? splitLegacy(raw.priority),
    TICKET_PRIORITIES,
  );

  const assignee = (ASSIGNEE_FILTERS as readonly string[]).includes(
    raw.assignee ?? "",
  )
    ? (raw.assignee as AssigneeFilter)
    : "any";

  return {
    statuses,
    priorities,
    assignee,
    search: (raw.search ?? "").trim(),
  };
}

/** The shape written back to the column. Empty parts are omitted, not stored as []. */
export function toFilterJson(filter: ViewFilter): TicketFilterJson {
  return {
    ...(filter.statuses.length ? { statuses: filter.statuses } : {}),
    ...(filter.priorities.length ? { priorities: filter.priorities } : {}),
    ...(filter.assignee !== "any" ? { assignee: filter.assignee } : {}),
    ...(filter.search.trim() ? { search: filter.search.trim() } : {}),
  };
}

/**
 * The queue reads its filters off the URL, so a saved view is just a link.
 * Lists are comma-joined, which keeps single-value links identical to what the
 * queue's own tabs and selects already produce.
 */
export function filterToSearchParams(filter: ViewFilter): URLSearchParams {
  const params = new URLSearchParams();

  if (filter.statuses.length) {
    params.set("status", filter.statuses.join(","));
  }

  if (filter.priorities.length) {
    params.set("priority", filter.priorities.join(","));
  }

  if (filter.assignee !== "any") {
    params.set("assignee", filter.assignee);
  }

  if (filter.search.trim()) {
    params.set("search", filter.search.trim());
  }

  return params;
}

export function isEmptyFilter(filter: ViewFilter): boolean {
  return (
    filter.statuses.length === 0 &&
    filter.priorities.length === 0 &&
    filter.assignee === "any" &&
    filter.search.trim() === ""
  );
}

/** One-line summary for the view card, so a name like "Triage" is not opaque. */
export function describeFilter(filter: ViewFilter): string {
  if (isEmptyFilter(filter)) {
    return "All tickets";
  }

  const parts: string[] = [];

  if (filter.statuses.length) {
    parts.push(filter.statuses.map((s) => STATUS_LABEL[s]).join(" or "));
  }

  if (filter.priorities.length) {
    parts.push(filter.priorities.map((p) => PRIORITY_LABEL[p]).join(" or "));
  }

  if (filter.assignee !== "any") {
    parts.push(ASSIGNEE_LABEL[filter.assignee]);
  }

  if (filter.search.trim()) {
    parts.push(`matching "${filter.search.trim()}"`);
  }

  return parts.join(" · ");
}

/**
 * Escape a search term for PostgREST's `or()` grammar.
 *
 * A comma or parenthesis in the box would otherwise close the filter list and
 * be parsed as further conditions.
 */
export function escapeSearchTerm(term: string): string {
  return term.replace(/[,()\\]/g, "\\$&");
}

/**
 * A saved view reduced to what the queue's tab row needs.
 *
 * Built on the server from a SavedView so the client component never imports
 * the (server-only) saved-views service, and never sees owner ids.
 */
export type SavedViewTab = {
  id: string;
  name: string;
  count: number;
  /** Serialised filter, compared against the URL to find the active tab. */
  query: string;
};
