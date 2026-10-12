import { cache } from "react";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import {
  CreateTicketPayload,
  FetchTicketsOptions,
  MessageVisibility,
  PriorityChangeResult,
  SlaEvent,
  Ticket,
  TicketAttachment,
  TicketSlaPolicy,
  TicketTag,
  TicketMessage,
  TicketPriority,
  TicketStatus,
  TICKET_STATUSES,
  isTicketPriority,
  isTicketStatus,
} from "../types/tickets.types";
import {
  DEFAULT_SLA_WARN_MINS,
  computeSlaClock,
  headlineSlaEvent,
} from "../lib/sla";
import { normalizeTagName } from "../lib/tags";
import { CALENDAR_SELECT, one, toSlaCalendar } from "../lib/sla-calendar-row";
import { DurationUnit, isDurationUnit } from "@/features/sla-policies/duration";
import { getInitials } from "@/lib/format";
import { TICKET_ATTACHMENTS_MAX_BYTES } from "../lib/attachments";

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
        visible && fullName ? getInitials(fullName, "") : undefined,
      assignee_role: visible || undefined,
    };
  });
}

/**
 * One ticket for the detail page, shaped like a list row (requester and
 * visible assignee filled in), or null when it isn't the tenant's or the
 * caller can't see it. Cached per request: the page and its metadata share it.
 */
export const fetchTicketById = cache(
  async (tenant: string, ticketId: string): Promise<Ticket | null> => {
    const supabase = await createSupabaseServerClient();
    const tenantId = await getTenantIdBySlug(tenant);
    if (!tenantId) return null;

    const { data: ticket, error } = await supabase
      .from("tickets")
      .select(
        `
          *,
          customers:requester_customer_id (
            full_name,
            company,
            email
          ),
          assignee:assignee_user_id (
            full_name
          )
        `,
      )
      .eq("id", ticketId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      console.error("Error fetching single ticket:", error.message);
    }
    if (!ticket) return null;

    const cust = ticket.customers;
    const [formatted] = await withVisibleAssignee(
      supabase,
      [
        {
          ...ticket,
          requester_name: cust
            ? cust.full_name || cust.email
            : "Unknown Customer",
          requester_company: cust?.company || "N/A",
        },
      ],
      tenantId,
    );
    return formatted;
  },
);

export async function fetchTenantTickets(
  tenant: string,
  options: FetchTicketsOptions = {},
): Promise<{ tickets: Ticket[]; totalCount: number }> {
  const supabase = await createSupabaseServerClient();
  const tenantid = await getTenantIdBySlug(tenant);
  if (!tenantid) throw new Error("Tenant not found.");

  // Mark any overdue SLA events as breached so realtime picks up the change.
  // Not awaited before the list: the list works out breaches from due_at
  // itself (computeSlaClock), so it doesn't need this to finish first.
  const breaches = supabase
    .rpc("process_sla_breaches")
    .then(({ error: breachError }) => {
      if (breachError) {
        console.error(
          "[fetchTenantTickets] process_sla_breaches failed:",
          breachError.message,
        );
      }
    });
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
      // Counted with the filters below, so the total and the pages match
      // what the list shows.
      { count: "exact" },
    )
    .eq("tenant_id", tenantid);

  // Only real enum values reach the query: a hand-typed ?status=foo is "all",
  // not a Postgres enum error.
  const statusFilter = status?.toLowerCase();
  if (isTicketStatus(statusFilter)) {
    query = query.eq("status", statusFilter);
  }

  const priorityFilter = priority?.toLowerCase();
  if (isTicketPriority(priorityFilter)) {
    query = query.eq("priority", priorityFilter);
  }

  // Commas, parentheses and quotes are syntax in a PostgREST or-filter, so
  // they are dropped and the pattern quoted: "login, password" is plain text.
  const term = (search ?? "").replace(/[,()"\\]/g, " ").trim();
  if (term) {
    query = query.or(`subject.ilike."%${term}%",description.ilike."%${term}%"`);
  }

  const sortColumn = sort === "subject" ? "subject" : "created_at";
  const sortAscending = sortOrder === "asc";

  const [{ data, error, count }] = await Promise.all([
    query.order(sortColumn, { ascending: sortAscending }).range(from, to),
    breaches,
  ]);

  // Thrown, not an empty list: an empty list reads as "Queue clear", and
  // agents would stop working tickets during an outage. error.tsx shows.
  if (error) {
    throw new Error(`Failed to load tickets: ${error.message}`);
  }

  const totalCount = count || 0;

  const tickets: Ticket[] = await withVisibleAssignee(
    supabase,
    (data || []).map((t) => ({
      ...t,
      requester_name: t.customers?.full_name || "Unknown Customer",
      requester_company: t.customers?.company || "N/A",
    })),
    tenantid,
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

  // One head-only count per status: nothing is downloaded, and the totals
  // aren't cut off at the API's max_rows (1000) the way counting rows was.
  const results = await Promise.all(
    TICKET_STATUSES.map((status) =>
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", status),
    ),
  );

  const counts: TicketStatusCounts = {};
  results.forEach(({ count, error }, i) => {
    if (error) {
      console.error("Error fetching ticket status counts:", error.message);
      return;
    }
    if (count) counts[TICKET_STATUSES[i]] = count;
  });
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
          .select(`id, notify_before_mins, ${CALENDAR_SELECT}`)
          .in("id", policyIds)
      : Promise.resolve({ data: [], error: null }),
    fetchTagsForTickets(ids),
  ]);

  const warnByPolicy = new Map(
    (policiesRes.data || []).map((p) => [p.id, p.notify_before_mins]),
  );
  const calendarByPolicy = new Map(
    (policiesRes.data || []).map((p) => [
      p.id,
      toSlaCalendar(p.business_hours),
    ]),
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
    // ?? and not ||: a policy may set a 0-minute lead, as the detail page reads it.
    const warnMins =
      (t.sla_policy_id ? warnByPolicy.get(t.sla_policy_id) : undefined) ??
      DEFAULT_SLA_WARN_MINS;
    const { calendar, dayMins } = (t.sla_policy_id &&
      calendarByPolicy.get(t.sla_policy_id)) || {
      calendar: null,
      dayMins: 1440,
    };
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
        sla_calendar: calendar,
        sla_day_mins: dayMins,
      };
    }

    const clock = computeSlaClock(ev, now, warnMins, calendar, dayMins);
    return {
      ...t,
      tags,
      sla_type:
        clock.state === "breached"
          ? ("breached" as const)
          : clock.state === "warning"
            ? ("warning" as const)
            : clock.state === "paused" || clock.state === "waiting"
              ? ("paused" as const)
              : ("normal" as const),
      sla_text: clock.text,
      sla_due_at: ev.due_at,
      sla_started_at: ev.started_at,
      sla_status: clock.state === "breached" ? "breached" : ev.status,
      sla_completed_at: ev.completed_at,
      sla_paused: clock.state === "paused",
      sla_remaining_secs: ev.remaining_secs,
      sla_warn_before_mins: warnMins,
      sla_calendar: ev.business_hours_id ? calendar : null,
      sla_day_mins: dayMins,
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
    .select(`id, name, notify_before_mins, ${CALENDAR_SELECT}`)
    .eq("id", policyId)
    .maybeSingle();

  if (error || !data) {
    if (error)
      console.error("Error fetching ticket SLA policy:", error.message);
    return null;
  }

  // Separate and select("*"): only the units are wanted, and a database
  // without the unit columns yet still shows the card.
  const { data: targets } = await supabase
    .from("sla_policy_targets")
    .select("*")
    .eq("policy_id", policyId);

  const unit = (v: unknown): DurationUnit | null =>
    isDurationUnit(v) ? v : null;
  const target_units: TicketSlaPolicy["target_units"] = {};
  for (const t of (targets || []) as Record<string, unknown>[]) {
    const scope = t.priority_scope as TicketPriority;
    target_units[scope] = {
      first_response: unit(t.first_response_unit),
      resolution: unit(t.resolution_unit),
    };
  }

  const join = data.business_hours;
  const { calendar, dayMins } = toSlaCalendar(join);
  return {
    id: data.id,
    name: data.name,
    warn_before_mins: data.notify_before_mins ?? DEFAULT_SLA_WARN_MINS,
    business_hours_name: one(join)?.name ?? null,
    calendar,
    day_mins: dayMins,
    target_units,
  };
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

/** Staff who work tickets: they can be @mentioned and attach files. */
const ASSIGNABLE_ROLES = ["agent", "manager", "tenant_admin"] as const;

/**
 * Who a ticket can be assigned to: agents and managers. Tenant admins run the
 * workspace rather than the queue, so they are left out of the assignee list
 * and don't get "Assign to me" (they can still be @mentioned).
 */
export const ASSIGNEE_ROLES: readonly string[] = ["agent", "manager"];

export async function fetchAssignableAgents(
  tenant: string,
): Promise<AssignableAgent[]> {
  const staff = await fetchTenantStaff(tenant);
  return staff.filter((m) => ASSIGNEE_ROLES.includes(m.role));
}

/** Every active staff member: agents, managers and tenant admins. */
export async function fetchTenantStaff(
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

/** The tickets row as inserted: no requester name, SLA or tags filled in. */
export type TicketRow = Database["public"]["Tables"]["tickets"]["Row"];

export async function createTenantTicket(
  tenant: string,
  ticketData: CreateTicketPayload,
): Promise<TicketRow> {
  const supabase = await createSupabaseServerClient();

  // No sla_policy_id: the tickets_assign_sla_policy trigger picks the
  // customer's policy (their 'Selected customers' one, else the default) and
  // tickets_sync_sla starts the clocks. No number either: set_tickets_number
  // assigns it under a per-tenant lock, so deletes and parallel creates can't
  // hand out one that is taken.
  const tenantId = await getTenantIdBySlug(tenant);

  const { data, error } = await supabase
    .from("tickets")
    .insert([
      {
        ...ticketData,
        tenant_id: tenantId,
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

  return data;
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
          m.author_initials = getInitials(name, "");
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
  tenantSlug: string;
  ticketId: string;
  authorType: "agent" | "customer" | "system";
  authorId: string;
  body: string;
  visibility: MessageVisibility;
}) {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(params.tenantSlug);
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

/**
 * Changes a ticket's priority through change_ticket_priority, which owns the
 * rules: lowering needs a reason, a clock due soon keeps its deadline, a
 * breach stays recorded, and every change is written to audit_logs.
 */
export async function changeTicketPriority(
  ticketId: string,
  priority: TicketPriority,
  reason?: string,
): Promise<PriorityChangeResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("change_ticket_priority", {
    p_ticket_id: ticketId,
    p_priority: priority,
    p_reason: reason?.trim() || undefined,
  });

  if (error) {
    // P0001 / P0002 carry plain-words messages written for this.
    if (error.code === "P0001" || error.code === "P0002") {
      throw new Error(error.message);
    }
    if (error.code === "PGRST202") {
      // Before migration 20261011120000 there is no function: change the
      // priority as before (re-targeted by the SLA engine, but no reason
      // check, kept deadline or audit entry) rather than fail every change.
      console.warn(
        "change_ticket_priority is missing; apply migration 20261011120000_ticket_priority_change_rules.sql. Changed without its rules.",
      );
      const { data: rows, error: updateError } = await supabase
        .from("tickets")
        .update({ priority, updated_at: new Date().toISOString() })
        .eq("id", ticketId)
        .neq("priority", priority)
        .select("id");
      if (updateError) {
        throw new Error(`Failed to update ticket: ${updateError.message}`);
      }
      return { changed: (rows?.length ?? 0) > 0, slaKept: [], breached: [] };
    }
    console.error("change_ticket_priority failed:", error.code, error.message);
    throw new Error("Couldn't change the priority. Try again.");
  }

  const result = (data ?? {}) as {
    changed?: boolean;
    direction?: "raised" | "lowered";
    sla_kept?: SlaEvent["type"][];
    breached?: SlaEvent["type"][];
  };
  return {
    changed: result.changed === true,
    direction: result.direction,
    slaKept: result.sla_kept ?? [],
    breached: result.breached ?? [],
  };
}

export async function bulkUpdateTickets(
  tenantSlug: string,
  ticketIds: string[],
  updates: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assignee_user_id?: string | null;
  },
  options: {
    /** Leave tickets already in these statuses untouched. */
    skipStatuses?: readonly TicketStatus[];
  } = {},
): Promise<number> {
  if (ticketIds.length === 0) return 0;

  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenantSlug);

  if (!tenantId) throw new Error("Tenant not found");

  // RLS skips rows the caller may not change without an error, so count the
  // rows that actually changed.
  let query = supabase
    .from("tickets")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .in("id", ticketIds);
  if (options.skipStatuses?.length) {
    query = query.not("status", "in", `(${options.skipStatuses.join(",")})`);
  }
  const { data, error } = await query.select("id");

  if (error) throw new Error(`Failed to update tickets: ${error.message}`);
  return data?.length ?? 0;
}

/** How long an attachment link signed for the detail page stays valid. */
export const ATTACHMENT_LINK_TTL_SECS = 3600;

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
  if (attachments.length === 0) return attachments;

  // One request for every link. They last an hour; the detail page refreshes
  // before that (ATTACHMENT_LINK_REFRESH_MS) so an open ticket keeps working.
  const paths = attachments.map((att) =>
    att.storage_path.replace(/^ticket-attachments\//, "").replace(/^\//, ""),
  );
  const { data: signed } = await supabase.storage
    .from("ticket-attachments")
    .createSignedUrls(paths, ATTACHMENT_LINK_TTL_SECS);
  const urlByPath = new Map(
    (signed || []).map((s) => [s.path, s.signedUrl] as const),
  );

  return attachments.map((att, i) => ({
    ...att,
    signed_url: urlByPath.get(paths[i]) || undefined,
  }));
}

/** Files already in storage, waiting for their attachments rows. */
export interface StagedAttachments {
  tenantId: string;
  ticketId: string;
  /** The staff member who uploaded them. */
  uploadedBy: string;
  files: {
    path: string;
    storedName: string;
    original: string;
    mime: string;
    ext: string;
    size: number;
  }[];
}

/** Remove staged objects from storage; logged, never thrown. */
export async function discardStagedAttachments(
  staged: StagedAttachments,
): Promise<void> {
  if (staged.files.length === 0) return;
  const { error } = await createSupabaseAdminClient()
    .storage.from("ticket-attachments")
    .remove(staged.files.map((f) => f.path));
  if (error) {
    console.error("Could not remove staged attachments:", error.message);
  }
}

/**
 * Step one of attaching files: check the caller may, and put the bytes in
 * storage. Nothing is visible yet -- no attachments row exists -- so a reply
 * can be saved only once every file is safely stored (recordStagedAttachments
 * then links them). If any upload fails, the ones before it are removed.
 */
export async function stageTicketAttachments(params: {
  tenant: string;
  ticketId: string;
  files: File[];
}): Promise<StagedAttachments> {
  const admin = createSupabaseAdminClient();
  const { tenant, ticketId, files } = params;
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) {
    throw new Error("Tenant not found.");
  }

  // The writes below use the admin client, which skips RLS, so check here what
  // RLS would: the caller is staff of this tenant and the ticket is one of its.
  const identity = await getCurrentUserIdentity(tenant);
  if (
    !identity?.role ||
    !(ASSIGNABLE_ROLES as readonly string[]).includes(identity.role)
  ) {
    throw new Error("Unauthorized");
  }
  const supabase = await createSupabaseServerClient();
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id")
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!ticket) {
    throw new Error("Ticket not found.");
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > TICKET_ATTACHMENTS_MAX_BYTES) {
    throw new Error("Attachments are limited to 20 MB in total.");
  }

  const staged: StagedAttachments = {
    tenantId,
    ticketId,
    uploadedBy: identity.id,
    files: [],
  };

  for (const file of files) {
    const ext = (file.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || "";
    // A random name: Date.now() alone collided for two files of the same
    // type in one millisecond, and upsert: false then failed the whole send.
    const storedName = `${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
    const path = `${tenantId}/${ticketId}/${storedName}`;
    const mime = file.type || "application/octet-stream";

    const { error: uploadError } = await admin.storage
      .from("ticket-attachments")
      .upload(path, file, { contentType: mime, upsert: false });

    if (uploadError) {
      console.error("Upload failed:", uploadError.message);
      await discardStagedAttachments(staged);
      throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
    }

    staged.files.push({
      path,
      storedName,
      original: file.name,
      mime,
      ext,
      size: file.size,
    });
  }

  return staged;
}

/**
 * Step two: the attachments rows that make staged files visible. With a
 * `messageId` they belong to that reply or note and follow its visibility,
 * and record who uploaded them. Without one they are the ticket's opening
 * files, which the customer sees -- so that is only for a new ticket, never
 * a reply (an internal note's file would leak to the portal). On failure the
 * staged objects are removed.
 */
export async function recordStagedAttachments(
  staged: StagedAttachments,
  messageId: string | null,
): Promise<TicketAttachment[]> {
  if (staged.files.length === 0) return [];

  const { data, error } = await createSupabaseAdminClient()
    .from("attachments")
    .insert(
      staged.files.map((f) => ({
        tenant_id: staged.tenantId,
        ticket_id: staged.ticketId,
        message_id: messageId,
        storage_path: f.path,
        filename: f.storedName,
        original_filename: f.original,
        mime: f.mime,
        extension: f.ext || null,
        size: f.size,
        // Null on opening files: the portal shows message-less files to the
        // customer only when nobody on staff is named as the uploader.
        uploaded_by: messageId ? staged.uploadedBy : null,
        checksum: null,
      })),
    )
    .select();

  if (error) {
    console.error("Attachments row insert failed:", error.message);
    await discardStagedAttachments(staged);
    throw new Error(`Failed to record attachments: ${error.message}`);
  }

  return (data || []) as TicketAttachment[];
}

/** A new ticket's opening files: staged and recorded in one go. */
export async function uploadTicketAttachments(params: {
  tenant: string;
  ticketId: string;
  files: File[];
}): Promise<TicketAttachment[]> {
  const staged = await stageTicketAttachments(params);
  return recordStagedAttachments(staged, null);
}

/** How many requesters the create-ticket picker shows per search. */
const REQUESTER_SEARCH_LIMIT = 50;

/**
 * Customers matching `query` by name, email or company, A→Z, at most 50 --
 * so the picker never loads a big tenant's whole customer list. An empty
 * query returns the first 50.
 */
export async function searchTenantCustomers(
  tenant: string,
  query: string,
): Promise<Customer[]> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);
  if (!tenantId) throw new Error("Tenant not found.");

  let request = supabase
    .from("customers")
    .select("id, tenant_id, full_name, email, company, phone, created_at")
    .eq("tenant_id", tenantId);

  // Same escaping as the ticket search: these are or-filter syntax.
  const term = query
    .replace(/[,()"\\]/g, " ")
    .trim()
    .slice(0, 100);
  if (term) {
    request = request.or(
      `full_name.ilike."%${term}%",email.ilike."%${term}%",company.ilike."%${term}%"`,
    );
  }

  const { data, error } = await request
    .order("full_name", { ascending: true })
    .limit(REQUESTER_SEARCH_LIMIT);

  if (error) throw new Error(`Failed to search customers: ${error.message}`);
  return data || [];
}
