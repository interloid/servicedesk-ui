import type { SlaCalendar } from "@/features/tickets/lib/sla-calendar";
import type { DurationUnit } from "@/features/sla-policies/duration";

export type TicketStatus =
  "new" | "open" | "pending" | "on_hold" | "resolved" | "closed";
export type TicketPriority = "urgent" | "high" | "normal" | "low";
export type SlaStatus = "warning" | "breached" | "normal";

/** Every ticket_status enum value, for checking input before it reaches SQL. */
export const TICKET_STATUSES: readonly TicketStatus[] = [
  "new",
  "open",
  "pending",
  "on_hold",
  "resolved",
  "closed",
];
export const TICKET_PRIORITIES: readonly TicketPriority[] = [
  "urgent",
  "high",
  "normal",
  "low",
];

/** Display names, shared by the queue, the detail view and the dialogs. */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: "New",
  open: "Open",
  pending: "Pending",
  on_hold: "On hold",
  resolved: "Resolved",
  closed: "Closed",
};
export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export function isTicketStatus(v: unknown): v is TicketStatus {
  return (TICKET_STATUSES as readonly unknown[]).includes(v);
}

export function isTicketPriority(v: unknown): v is TicketPriority {
  return (TICKET_PRIORITIES as readonly unknown[]).includes(v);
}

/** Low to urgent, the same order as the ticket_priority enum. */
const PRIORITY_RANK: Record<TicketPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

/** Lowering a priority needs a reason (change_ticket_priority enforces it). */
export function isPriorityLowered(
  from: TicketPriority,
  to: TicketPriority,
): boolean {
  return PRIORITY_RANK[to] < PRIORITY_RANK[from];
}

export const PRIORITY_REASON_MAX = 500;

/** What change_ticket_priority did. */
export interface PriorityChangeResult {
  changed: boolean;
  direction?: "raised" | "lowered";
  /** Clocks that were due soon, so kept their original deadline. */
  slaKept: SlaEvent["type"][];
  /** Clocks already breached; the breach stays recorded. */
  breached: SlaEvent["type"][];
}
export type MessageVisibility = "public" | "internal";
export type AuthorType = "agent" | "customer" | "system";

export interface SlaEvent {
  id: string;
  tenant_id: string;
  ticket_id: string;
  type: "first_response" | "resolution";
  status: "pending" | "completed" | "breached";
  due_at: string;
  completed_at: string | null;
  breached_at: string | null;
  /** When the clock started: ticket creation, or the reopen for a restart. */
  started_at: string;
  target_mins: number | null;
  /** Null for a wall-clock (24/7) clock. */
  business_hours_id: string | null;
  /** Set while the ticket is Pending / On hold. */
  paused_at: string | null;
  /** SLA seconds left at the moment the clock paused. */
  remaining_secs: number | null;
  created_at: string;
  updated_at: string;
}

/** The policy a ticket is measured against, as the detail page shows it. */
export interface TicketSlaPolicy {
  id: string;
  name: string;
  /** Minutes before a deadline the clock turns amber (notify_before_mins). */
  warn_before_mins: number;
  business_hours_name: string | null;
  /** The calendar the clocks count; null for 24/7 or an unusable one. */
  calendar: SlaCalendar | null;
  /** Minutes in one SLA day: a working day, or 1440 for 24/7. */
  day_mins: number;
  /** The unit each priority's targets were entered in ("1 day", "4 hours"). */
  target_units: Partial<
    Record<
      TicketPriority,
      { first_response: DurationUnit | null; resolution: DurationUnit | null }
    >
  >;
}

export interface TicketTag {
  id: string;
  name: string;
  color: string | null;
}

export interface CreateTicketPayload {
  subject: string;
  description: string;
  requester_customer_id: string;
  priority?: TicketPriority;
  status?: TicketStatus;
  assignee_user_id?: string | null;
  sla_policy_id?: string | null;
}
export interface Ticket {
  id: string;
  tenant_id: string;
  /** Per-tenant ticket number, assigned by the set_tickets_number trigger. */
  number: number;
  subject: string;
  /**
   * The opening request: both the agent thread and the portal show it as the
   * first post (it isn't a ticket_messages row).
   */
  description?: string | null;
  requester_name: string;
  requester_company: string;
  priority: TicketPriority;
  assignee_name?: string;
  assignee_initials?: string;
  assignee_role?: string;
  status: TicketStatus;
  sla_type: "warning" | "breached" | "normal" | "paused";
  sla_text: string;
  sla_due_at?: string | null;
  /** When the headline clock started, to tell "Starts" from "Resumes". */
  sla_started_at?: string | null;
  sla_status?: "pending" | "completed" | "breached" | null;
  sla_completed_at?: string | null;
  /** The running clock is paused (ticket Pending / On hold). */
  sla_paused?: boolean;
  /** SLA seconds left when it paused; the list shows it frozen. */
  sla_remaining_secs?: number | null;
  /** The policy's warning lead, so the list turns amber when the policy says. */
  sla_warn_before_mins?: number;
  /** The policy's calendar, so the list counts working time; null for 24/7. */
  sla_calendar?: SlaCalendar | null;
  /** Minutes in one SLA day: a working day, or 1440 for 24/7. */
  sla_day_mins?: number;
  sla_policy_id?: string | null;
  created_at: string;
  assignee_id?: string | null;
  first_response_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  tags?: TicketTag[];
  /** The requester, embedded; null when the customer row is gone. */
  customers: {
    email: string;
    company: string | null;
    full_name: string;
  } | null;
}

export interface TicketMessage {
  id: string;
  tenant_id: string;
  ticket_id: string;
  author_type: AuthorType;
  author_id: string;
  body: string;
  visibility: MessageVisibility;
  is_edited: boolean;
  edited_at?: string;
  created_at: string;
  author_name?: string;
  author_initials?: string;
}
export interface FetchTicketsOptions {
  search?: string;
  priority?: string;
  status?: string;
  page?: number;
  limit?: number;
  sort?: "subject" | "created_at";
  sortOrder?: "asc" | "desc";
}

export interface TicketAttachment {
  id: string;
  tenant_id: string;
  ticket_id: string;
  message_id: string | null;
  storage_path: string;
  filename: string;
  original_filename: string;
  mime: string;
  extension: string | null;
  size: number;
  uploaded_by: string | null;
  checksum: string | null;
  created_at: string;
  signed_url?: string;
}

/**
 * Where the browser may put one attachment: a server-minted path and a
 * single-use token from createSignedUploadUrl. `mime` is the type the file
 * must be uploaded as (from the allow-list, not the browser).
 */
/** `sla_text` for a ticket with no SLA clock; the queue shows a muted dash. */
export const NO_SLA_TEXT = "-";

export interface TicketUploadTarget {
  path: string;
  token: string;
  name: string;
  size: number;
  mime: string;
}

/** A file the browser has put in the bucket, reported back by path. */
export interface TicketUploadedFile {
  path: string;
  name: string;
}
