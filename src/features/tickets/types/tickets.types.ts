import type { SlaCalendar } from "@/features/tickets/lib/sla-calendar";
import type { DurationUnit } from "@/features/sla-policies/duration";

export type TicketStatus =
  "new" | "open" | "pending" | "on_hold" | "resolved" | "closed";
export type TicketPriority = "urgent" | "high" | "normal" | "low";
export type SlaStatus = "warning" | "breached" | "normal";
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
  customers: {
    email: string;
    company: string;
    full_name: string;
  };
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
export interface TicketFilters {
  status?: string;
  priority?: string;
  search?: string;
  page?: number;
  limit?: number;
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
export interface TicketComment {
  id: string;
  ticket_id: string;
  author_name: string;
  author_initials: string;
  author_avatar_bg?: string;
  is_internal: boolean;
  content: string;
  created_at: string;
}

export interface SingleTicketDetail extends Ticket {
  comments?: TicketComment[];
  requester_plan?: string;
  sla_first_response?: string;
  sla_resolution?: string;
  attachments?: Array<{
    name: string;
    size: string;
    type: string;
  }>;
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
