import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  CreateTicketPayload,
  FetchTicketsOptions,
  MessageVisibility,
  SlaEvent,
  SlaPolicy,
  Ticket,
  TicketAttachment,
  TicketPriority,
  TicketStatus,
} from "../types/tickets.types";

const VISIBLE_ASSIGNEE_ROLES = ["agent", "manager", "tenant_admin"] as const;

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function withVisibleAssignee<
  T extends { assignee_user_id?: string | null } & Record<string, unknown>,
>(supabase: SupabaseClient, rows: T[], tenantId: string): Promise<T[]> {
  const assigneeIds = [
    ...new Set(rows.map((t) => t.assignee_user_id).filter(Boolean) as string[]),
  ];

  if (assigneeIds.length === 0) {
    return rows.map((t) => ({
      ...t,
      assignee_name: undefined,
      assignee_initials: undefined,
    }));
  }

  const { data: memberships } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("user_id", assigneeIds)
    .in("role", [...VISIBLE_ASSIGNEE_ROLES]);

  const visibleRoles = Object.fromEntries(
    (memberships || []).map((m) => [m.user_id, m.role]),
  );

  return rows.map((row) => {
    const t = row as T & { assignee?: { full_name?: string | null } };
    const fullName = t.assignee?.full_name || undefined;
    const visible = t.assignee_user_id && visibleRoles[t.assignee_user_id];
    return {
      ...t,
      assignee_id: t.assignee_user_id ?? null,
      assignee_name: visible && fullName ? fullName : undefined,
      assignee_initials:
        visible && fullName
          ? fullName
              .split(" ")
              .map((s) => s[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()
          : undefined,
      assignee_role: visible || undefined,
    };
  });
}

export async function fetchTenantTickets(
  tenant: string,
  options: FetchTicketsOptions = {},
): Promise<{ tickets: Ticket[]; totalCount: number }> {
  const supabase = await createSupabaseServerClient();
  const tenantid = await getTenantIdBySlug(tenant);
  const { search, priority, status, page = 1, limit = 8 } = options;

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("tickets")
    .select(
      `
        *,
        customers:requester_customer_id (
          full_name,
          email,
          company
        ),
        assignee:assignee_user_id (
          full_name
        )
      `,
      { count: "exact" },
    )
    .eq("tenant_id", tenantid);

  if (status && status !== "all") {
    query = query.eq("status", status.toLowerCase() as TicketStatus);
  }

  if (priority && priority !== "all") {
    query = query.eq("priority", priority.toLowerCase() as TicketPriority);
  }

  if (search && search.trim() !== "") {
    query = query.or(`subject.ilike.%${search}%,description.ilike.%${search}%`);
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return { tickets: [], totalCount: 0 };
  }

  const tickets: Ticket[] = await withVisibleAssignee(
    supabase,
    (data || []).map((t) => ({
      ...t,
      requester_name:
        (t.customers as { full_name?: string } | null)?.full_name ||
        "Unknown Customer",
      requester_company:
        (t.customers as { company?: string } | null)?.company || "N/A",
    })),
    tenantid!,
  );

  return {
    tickets,
    totalCount: count || 0,
  };
}

export interface AssignableAgent {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

const ASSIGNABLE_ROLES = ["agent", "manager"] as const;

export async function fetchAssignableAgents(
  tenant: string,
): Promise<AssignableAgent[]> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, users!memberships_user_id_fkey(full_name, email)")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("role", [...ASSIGNABLE_ROLES]);

  if (error) {
    console.error("Error fetching assignable agents:", error.message);
    return [];
  }

  type AgentUser = { full_name: string | null; email: string };

  const rows = (data || []) as Array<{
    user_id: string;
    role: string;
    users: Array<AgentUser> | AgentUser | null;
  }>;

  const withUser = rows
    .map((m) => {
      const agentUser = Array.isArray(m.users) ? m.users[0] : m.users;
      return agentUser ? { m, agentUser } : null;
    })
    .filter(
      (r): r is { m: (typeof rows)[number]; agentUser: AgentUser } =>
        r !== null,
    );

  return withUser.map(({ m, agentUser }) => ({
    id: m.user_id,
    full_name: agentUser.full_name || agentUser.email || "Unknown",
    email: agentUser.email || "",
    role: m.role,
  }));
}

export async function getCurrentUserIdentity(tenant: string) {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();

  return {
    id: user.id,
    email: user.email || "",
    role: membership?.role || null,
  };
}

export async function fetchTenantSlaPolicies(
  tenant: string,
): Promise<SlaPolicy[]> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);
  const { data, error } = await supabase
    .from("sla_policies")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  if (error) {
    console.error("Error fetching SLA policies:", error.message);
    return [];
  }

  return (data as SlaPolicy[]) || [];
}

export async function createTenantTicket(
  tenant: string,
  ticketData: CreateTicketPayload,
): Promise<Ticket> {
  console.log("🚀 ~ createTenantTicket ~ ticketData:", ticketData)
  const supabase = await createSupabaseServerClient();

  let selectedSlaId = ticketData.sla_policy_id || null;
  if (!selectedSlaId) {
    const policies = await fetchTenantSlaPolicies(tenant);
    const defaultPolicy = policies.find((p) => p.is_default);
    if (defaultPolicy) {
      selectedSlaId = defaultPolicy.id;
    }
  }
  const tenantId = await getTenantIdBySlug(tenant);
  const { count, error: countError } = await supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (countError) {
    throw new Error(`Failed to calculate ticket number: ${countError.message}`);
  }

  const nextNumber = (count || 0) + 1;

  const { data, error } = await supabase
    .from("tickets")
    .insert([
      {
        ...ticketData,
        tenant_id: tenantId,
        number: nextNumber,
        sla_policy_id: selectedSlaId,
        status: ticketData.status || "new",
        priority: ticketData.priority || "normal",
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("🚀 ~ createTenantTicket error:", error);
    throw new Error(`Failed to create ticket: ${error.message}`);
  }

  return data as Ticket;
}

export async function getTicketMessages(ticketId: string, tenantId: string) {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("ticket_messages")
    .select("*")
    .eq("ticket_id", ticketId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch messages: ${error.message}`);
  return data;
}

export async function fetchTicketSlaEvents(
  ticketId: string,
  tenantId: string,
): Promise<SlaEvent[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("sla_events")
    .select("*")
    .eq("ticket_id", ticketId)
    .eq("tenant_id", tenantId)
    .order("type", { ascending: true });

  if (error) {
    console.error("Error fetching SLA events:", error.message);
    return [];
  }

  return (data || []) as SlaEvent[];
}

export async function createMessage(params: {
  tenantId: string;
  ticketId: string;
  authorType: "agent" | "customer" | "system";
  authorId: string;
  body: string;
  visibility: MessageVisibility;
}) {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(params.tenantId);
  const { data, error } = await supabase
    .from("ticket_messages")
    .insert({
      tenant_id: tenantId,
      ticket_id: params.ticketId,
      author_type: params.authorType,
      author_id: params.authorId,
      body: params.body,
      visibility: params.visibility,
      is_edited: false,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to send message: ${error.message}`);
  return data;
}

export async function updateTicketDetails(
  ticketId: string,
  tenantSlug: string,
  updates: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assignee_user_id?: string | null;
    resolved_at?: string | null;
  },
) {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenantSlug);

  if (!tenantId) throw new Error("Tenant not found");

  const { data, error } = await supabase
    .from("tickets")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update ticket: ${error.message}`);
  return data;
}

export async function bulkUpdateTickets(
  tenantSlug: string,
  ticketIds: string[],
  updates: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assignee_user_id?: string | null;
    resolved_at?: string | null;
  },
): Promise<number> {
  if (ticketIds.length === 0) return 0;

  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenantSlug);

  if (!tenantId) throw new Error("Tenant not found");

  const { error } = await supabase
    .from("tickets")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .in("id", ticketIds);

  if (error) throw new Error(`Failed to update tickets: ${error.message}`);
  return ticketIds.length;
}

export async function fetchTicketAttachments(
  ticketId: string,
  tenantId: string,
): Promise<TicketAttachment[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("ticket_id", ticketId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching attachments:", error.message);
    return [];
  }

  const attachments = (data || []) as TicketAttachment[];

  const withUrls = await Promise.all(
    attachments.map(async (att) => {
      const cleanPath = att.storage_path
        .replace(/^ticket-attachments\//, "")
        .replace(/^\//, "");
      const { data: signed } = await supabase.storage
        .from("ticket-attachments")
        .createSignedUrl(cleanPath, 3600);
      return { ...att, signed_url: signed?.signedUrl || undefined };
    }),
  );

  return withUrls;
}

export async function uploadTicketAttachments(params: {
  tenant: string;
  ticketId: string;
  files: File[];
  messageId?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const { tenant, ticketId, files, messageId = null } = params;
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) {
    throw new Error("Tenant not found.");
  }

  const inserted: TicketAttachment[] = [];

  for (const file of files) {
    const ext = (file.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || "";
    const storedName = `${Date.now()}-${ext}`;
    const path = `${tenantId}/${ticketId}/${storedName}`;

    const { error: uploadError } = await admin.storage
      .from("ticket-attachments")
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload failed:", uploadError.message);
      throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
    }

    const { data, error } = await admin
      .from("attachments")
      .insert({
        tenant_id: tenantId,
        ticket_id: ticketId,
        message_id: messageId,
        storage_path: path,
        filename: storedName,
        original_filename: file.name,
        mime: file.type || "application/octet-stream",
        extension: ext || null,
        size: file.size,
        uploaded_by: null,
        checksum: null,
      })
      .select()
      .single();

    if (error) {
      console.error("Attachments row insert failed:", error.message);
      throw new Error(`Failed to record ${file.name}: ${error.message}`);
    }

    inserted.push(data as TicketAttachment);
  }

  return inserted;
}
