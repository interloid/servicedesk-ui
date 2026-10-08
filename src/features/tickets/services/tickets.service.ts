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
  TicketCsat,
  TicketSlaPolicy,
  TicketTag,
  TicketMessage,
  TicketPriority,
  TicketStatus,
} from "../types/tickets.types";
import {
  DEFAULT_SLA_WARN_MINS,
  computeSlaClock,
  headlineSlaEvent,
} from "../lib/sla";
import { normalizeTagName } from "../lib/tags";

const VISIBLE_ASSIGNEE_ROLES = ["agent", "manager", "tenant_admin"] as const;
export interface Customer {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  created_at?: string;
}
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

  // Mark any overdue SLA events as breached so realtime picks up the change.
  try {
    await supabase.rpc("process_sla_breaches");
  } catch (e) {
    console.error("[fetchTenantTickets] process_sla_breaches failed:", e);
  }
  const {
    search,
    priority,
    status,
    page = 1,
    limit = 8,
    sort,
    sortOrder,
  } = options;

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
    )
    .eq("tenant_id", tenantid);

  const countQuery = supabase
    .from("tickets")
    .select("id", { count: "exact" })
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

  const sortColumn = sort === "subject" ? "subject" : "created_at";
  const sortAscending = sortOrder === "asc";

  const [countRes, { data, error }] = await Promise.all([
    countQuery,
    query.order(sortColumn, { ascending: sortAscending }).range(from, to),
  ]);

  const totalCount = countRes.count || 0;

  if (error) {
    return { tickets: [], totalCount };
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

  const withSla = await attachSlaInfo(tickets);

  return {
    tickets: withSla,
    totalCount,
  };
}

export type TicketStatusCounts = Partial<Record<TicketStatus, number>>;

export async function fetchTicketStatusCounts(
  tenant: string,
): Promise<TicketStatusCounts> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);
  if (!tenantId) return {};

  const { data, error } = await supabase
    .from("tickets")
    .select("status")
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("Error fetching ticket status counts:", error.message);
    return {};
  }

  const counts: TicketStatusCounts = {};
  for (const row of data || []) {
    const status = row.status as TicketStatus;
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

/**
 * Attach each ticket's SLA snapshot (the clock that matters most right now)
 * and its tags. The list ticks the countdown itself from this (computeLiveSla).
 */
async function attachSlaInfo(tickets: Ticket[]): Promise<Ticket[]> {
  if (tickets.length === 0) return tickets;

  const supabase = await createSupabaseServerClient();
  const ids = tickets.map((t) => t.id);
  const policyIds = [
    ...new Set(tickets.map((t) => t.sla_policy_id).filter(Boolean)),
  ] as string[];

  const [eventsRes, policiesRes, tagsByTicket] = await Promise.all([
    supabase
      .from("sla_events")
      .select("*")
      .in("ticket_id", ids)
      .order("type", { ascending: true }),
    policyIds.length > 0
      ? supabase
          .from("sla_policies")
          .select("id, notify_before_mins")
          .in("id", policyIds)
      : Promise.resolve({ data: [], error: null }),
    fetchTagsForTickets(ids),
  ]);

  const warnByPolicy = new Map(
    (policiesRes.data || []).map((p) => [p.id, p.notify_before_mins]),
  );

  const byTicket = new Map<string, SlaEvent[]>();
  for (const ev of (eventsRes.data || []) as SlaEvent[]) {
    const list = byTicket.get(ev.ticket_id) || [];
    list.push(ev);
    byTicket.set(ev.ticket_id, list);
  }

  const now = Date.now();

  return tickets.map((t) => {
    const tags = tagsByTicket.get(t.id) || [];
    const warnMins =
      (t.sla_policy_id && warnByPolicy.get(t.sla_policy_id)) ||
      DEFAULT_SLA_WARN_MINS;
    const ev = eventsRes.error
      ? undefined
      : headlineSlaEvent(byTicket.get(t.id) || []);

    if (!ev) {
      return {
        ...t,
        tags,
        sla_type: "normal" as const,
        sla_text: "—",
        sla_due_at: null,
        sla_status: null,
        sla_completed_at: null,
        sla_paused: false,
        sla_warn_before_mins: warnMins,
      };
    }

    const clock = computeSlaClock(ev, now, warnMins);
    return {
      ...t,
      tags,
      sla_type:
        clock.state === "breached"
          ? ("breached" as const)
          : clock.state === "warning"
            ? ("warning" as const)
            : clock.state === "paused"
              ? ("paused" as const)
              : ("normal" as const),
      sla_text: clock.text,
      sla_due_at: ev.due_at,
      sla_status: clock.state === "breached" ? "breached" : ev.status,
      sla_completed_at: ev.completed_at,
      sla_paused: clock.state === "paused",
      sla_remaining_secs: ev.remaining_secs,
      sla_warn_before_mins: warnMins,
    };
  });
}

/** Ticket id → its tags, for the rows on screen. */
async function fetchTagsForTickets(
  ticketIds: string[],
): Promise<Map<string, TicketTag[]>> {
  const map = new Map<string, TicketTag[]>();
  if (ticketIds.length === 0) return map;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ticket_tags")
    .select("ticket_id, tags(id, name, color)")
    .in("ticket_id", ticketIds);

  if (error) {
    console.error("Error fetching ticket tags:", error.message);
    return map;
  }

  for (const row of data || []) {
    const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags;
    if (!tag) continue;
    const list = map.get(row.ticket_id) || [];
    list.push(tag as TicketTag);
    map.set(row.ticket_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

export async function fetchTicketTags(ticketId: string): Promise<TicketTag[]> {
  return (await fetchTagsForTickets([ticketId])).get(ticketId) || [];
}

/** Every tag in the tenant, for the tag picker's suggestions. */
export async function fetchTenantTags(tenant: string): Promise<TicketTag[]> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("tags")
    .select("id, name, color")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching tags:", error.message);
    return [];
  }
  return (data || []) as TicketTag[];
}

/**
 * Make the ticket's tags exactly `names`: creates tags the tenant doesn't have
 * yet, links the new ones, unlinks the rest. Returns the resulting tags.
 */
export async function setTicketTags(
  tenant: string,
  ticketId: string,
  names: string[],
): Promise<TicketTag[]> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);
  if (!tenantId) throw new Error("Tenant not found.");

  const wanted = [...new Set(names.map(normalizeTagName).filter(Boolean))];

  const byName = new Map<string, TicketTag>();
  if (wanted.length > 0) {
    const { data: existing, error: existingError } = await supabase
      .from("tags")
      .select("id, name, color")
      .eq("tenant_id", tenantId)
      .in("name", wanted);
    if (existingError) {
      throw new Error(`Failed to load tags: ${existingError.message}`);
    }
    for (const t of existing || []) byName.set(t.name, t as TicketTag);
  }
  const missing = wanted.filter((n) => !byName.has(n));

  if (missing.length > 0) {
    // ignoreDuplicates: somebody else may create the same tag in between.
    const { error: insertError } = await supabase.from("tags").upsert(
      missing.map((name) => ({ tenant_id: tenantId, name })),
      { onConflict: "tenant_id,name", ignoreDuplicates: true },
    );
    if (insertError) {
      throw new Error(`Failed to create tags: ${insertError.message}`);
    }
    const { data: created } = await supabase
      .from("tags")
      .select("id, name, color")
      .eq("tenant_id", tenantId)
      .in("name", missing);
    for (const t of created || []) byName.set(t.name, t as TicketTag);
  }

  const wantedIds = new Set(
    wanted.map((n) => byName.get(n)?.id).filter(Boolean) as string[],
  );

  const { data: links, error: linksError } = await supabase
    .from("ticket_tags")
    .select("tag_id")
    .eq("ticket_id", ticketId)
    .eq("tenant_id", tenantId);
  if (linksError) {
    throw new Error(`Failed to load ticket tags: ${linksError.message}`);
  }

  const current = new Set((links || []).map((l) => l.tag_id));
  const toAdd = [...wantedIds].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !wantedIds.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabase.from("ticket_tags").upsert(
      toAdd.map((tag_id) => ({
        tenant_id: tenantId,
        ticket_id: ticketId,
        tag_id,
      })),
      { onConflict: "ticket_id,tag_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(`Failed to tag ticket: ${error.message}`);
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("ticket_tags")
      .delete()
      .eq("ticket_id", ticketId)
      .eq("tenant_id", tenantId)
      .in("tag_id", toRemove);
    if (error) throw new Error(`Failed to untag ticket: ${error.message}`);
  }

  return fetchTicketTags(ticketId);
}

/** The policy a ticket runs against, with what the SLA card shows of it. */
export async function fetchTicketSlaPolicy(
  policyId: string | null | undefined,
): Promise<TicketSlaPolicy | null> {
  if (!policyId) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sla_policies")
    .select("id, name, notify_before_mins, business_hours(name)")
    .eq("id", policyId)
    .maybeSingle();

  if (error || !data) {
    if (error)
      console.error("Error fetching ticket SLA policy:", error.message);
    return null;
  }

  const calendar = Array.isArray(data.business_hours)
    ? data.business_hours[0]
    : data.business_hours;
  return {
    id: data.id,
    name: data.name,
    warn_before_mins: data.notify_before_mins ?? DEFAULT_SLA_WARN_MINS,
    business_hours_name: calendar?.name ?? null,
  };
}

/** Ratings the requester left on this ticket, newest resolution first. */
export async function fetchTicketCsat(
  ticketId: string,
  tenantId: string,
): Promise<TicketCsat[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("csat_ratings")
    .select("id, score, comment, resolved_at, created_at")
    .eq("ticket_id", ticketId)
    .eq("tenant_id", tenantId)
    .order("resolved_at", { ascending: false });

  if (error) {
    console.error("Error fetching CSAT:", error.message);
    return [];
  }
  return (data || []) as TicketCsat[];
}

/** Days a resolved ticket waits before sla_tick() closes it (0 = never). */
export async function fetchAutoCloseDays(tenantId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("tenants")
    .select("auto_close_after_days")
    .eq("id", tenantId)
    .maybeSingle();
  return data?.auto_close_after_days ?? 0;
}

export interface AssignableAgent {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

const ASSIGNABLE_ROLES = ["agent", "manager", "tenant_admin"] as const;
const MENTIONABLE_ROLES = ["agent", "manager", "tenant_admin"] as const;

export async function fetchMentionableMembers(
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
    .in("role", [...MENTIONABLE_ROLES]);

  if (error) {
    console.error("Error fetching mentionable members:", error.message);
    return [];
  }

  type MemberUser = { full_name: string | null; email: string };

  const rows = (data || []) as Array<{
    user_id: string;
    role: string;
    users: Array<MemberUser> | MemberUser | null;
  }>;

  return rows
    .map((m) => {
      const user = Array.isArray(m.users) ? m.users[0] : m.users;
      return user
        ? {
            id: m.user_id,
            full_name: user.full_name || user.email || "Unknown",
            email: user.email || "",
            role: m.role,
          }
        : null;
    })
    .filter((r): r is AssignableAgent => r !== null);
}

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
    .select("role, users!memberships_user_id_fkey(full_name)")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();

  const memberUser = membership
    ? (Array.isArray(membership.users)
        ? membership.users[0]
        : membership.users) || null
    : null;

  return {
    id: user.id,
    email: user.email || "",
    full_name: memberUser?.full_name || user.email || "",
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
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

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
  const supabase = await createSupabaseServerClient();

  // No sla_policy_id: the tickets_assign_sla_policy trigger picks the
  // customer's policy (their 'Selected customers' one, else the default) and
  // tickets_sync_sla starts the clocks.
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

  const rows = (data || []) as TicketMessage[];

  const authorIds = Array.from(
    new Set(
      rows.filter((m) => m.author_type === "agent").map((m) => m.author_id),
    ),
  );

  if (authorIds.length > 0) {
    const { data: members } = await supabase
      .from("memberships")
      .select("user_id, users!memberships_user_id_fkey(full_name, email)")
      .eq("tenant_id", tenantId)
      .in("user_id", authorIds);

    type MemberUser = { full_name: string | null; email: string };

    const nameById = new Map<string, string>();
    for (const m of (members || []) as Array<{
      user_id: string;
      users: MemberUser[] | MemberUser | null;
    }>) {
      const user = Array.isArray(m.users) ? m.users[0] : m.users;
      if (user && m.user_id) {
        nameById.set(m.user_id, user.full_name || user.email || "Agent");
      }
    }

    rows.forEach((m) => {
      if (m.author_type === "agent" && !m.author_name) {
        const name = nameById.get(m.author_id);
        if (name) {
          m.author_name = name;
          m.author_initials = name
            .split(" ")
            .map((p) => p[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase();
        }
      }
    });
  }

  return rows;
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

/**
 * Insert a ticket message on behalf of a customer using the service-role client,
 * bypassing RLS. Used when an agent creates a ticket with a description so the
 * seed message is attributed to the customer even though the signed-in caller is
 * an agent (the ticket_messages_insert policy only permits agents to insert
 * their own agent-authored rows).
 */
export async function createSystemCustomerMessage(params: {
  tenantId: string;
  ticketId: string;
  authorId: string;
  body: string;
  visibility: MessageVisibility;
}) {
  const admin = createSupabaseAdminClient();
  const tenantId = await getTenantIdBySlug(params.tenantId);
  const { error } = await admin.from("ticket_messages").insert({
    tenant_id: tenantId,
    ticket_id: params.ticketId,
    author_type: "customer",
    author_id: params.authorId,
    body: params.body,
    visibility: params.visibility,
    is_edited: false,
  });
  if (error) {
    throw new Error(`Failed to seed message: ${error.message}`);
  }
}

export async function updateTicketDetails(
  ticketId: string,
  tenantSlug: string,
  updates: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assignee_user_id?: string | null;
    resolved_at?: string | null;
    sla_policy_id?: string | null;
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

export async function fetchTenantCustomers(
  tenant: string,
): Promise<Customer[]> {
  const supabase = await createSupabaseServerClient();
  const tenantid = await getTenantIdBySlug(tenant);

  if (!tenantid) {
    throw new Error(`Tenant not found for slug: ${tenant}`);
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, tenant_id, full_name, email, company, phone, created_at")
    .eq("tenant_id", tenantid)
    .order("full_name", { ascending: true });

  if (error) {
    console.error("Error fetching customers:", error.message);
    return [];
  }

  return (data as Customer[]) || [];
}
