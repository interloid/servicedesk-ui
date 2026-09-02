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
  created_at: string;
  updated_at: string;
}

export interface SlaPolicy {
  id: string;
  tenant_id: string;
  name: string;
  business_hours_id: string;
  is_default: boolean;
  status: "active" | "inactive";
  applies_to: string;
  notify_before_breach: boolean;
  escalate_on_breach: boolean;
  created_at: string;
  updated_at: string;
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
  subject: string;
  requester_name: string;
  requester_company: string;
  priority: TicketPriority;
  assignee_name?: string;
  assignee_initials?: string;
  assignee_role?: string;
  status: TicketStatus;
  sla_type: "warning" | "breached" | "normal";
  sla_text: string;
  created_at: string;
  assignee_id?: string | null;
  first_response_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  tags?: string[];
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
  tags?: string[];
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
