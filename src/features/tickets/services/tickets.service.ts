import { cache } from "react";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { statStoredObject } from "@/lib/supabase/storage-object";
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
  TicketUploadedFile,
  TicketUploadTarget,
  TicketTag,
  TicketMessage,
  TicketPriority,
  TicketStatus,
  NO_SLA_TEXT,
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
import { filterToPostgrest, searchTerm } from "@/features/saved-view/filters";
import {
  attachmentContentType,
  attachmentExtension,
  attachmentsError,
} from "../lib/attachments";

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

/**
 * Log a database or storage error in full on the server and throw a fixed,
 * user-facing message: raw messages name tables, policies and constraints.
 */
function fail(
  context: string,
  error: { message: string; code?: string },
  userMessage: string,
): never {
  console.error(`[tickets] ${context}:`, error.code ?? "", error.message);
  throw new Error(userMessage);
}

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

/** The parts of a tickets query applyTicketFilters needs. */
interface TicketFilterable<Q> {
  in(column: "status" | "priority", values: string[]): Q;
  eq(column: "assignee_user_id", value: string): Q;
  is(column: "assignee_user_id", value: null): Q;
  or(filters: string): Q;
}

/** The known values in a comma-joined ?status= or ?priority=. */
function listParam<T extends string>(
  value: string | undefined,
  isKnown: (v: string | undefined) => v is T,
): T[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(isKnown),
    ),
  ];
}

/**
 * The list's status, priority and search filters on `query`. One copy for
 * the page and for its count, so a new filter can't apply to one and not
 * the other.
 */
function applyTicketFilters<Q extends TicketFilterable<Q>>(
  query: Q,
  filters: Pick<FetchTicketsOptions, "search" | "priority" | "status"> & {
    /** null for unassigned; left out for anyone. */
    assigneeUserId?: string | null;
    /** A saved view's rules as a PostgREST logic tree (filterToPostgrest). */
    viewLogic?: string | null;
  },
): Q {
  let filtered = query;

  // Only real enum values reach the query: a hand-typed ?status=foo is "all",
  // not a Postgres enum error.
  const statuses = listParam(filters.status, isTicketStatus);
  if (statuses.length) filtered = filtered.in("status", statuses);

  const priorities = listParam(filters.priority, isTicketPriority);
  if (priorities.length) filtered = filtered.in("priority", priorities);

  if (filters.assigneeUserId === null) {
    filtered = filtered.is("assignee_user_id", null);
  } else if (filters.assigneeUserId) {
    filtered = filtered.eq("assignee_user_id", filters.assigneeUserId);
  }

  // Commas, parentheses and quotes are syntax in a PostgREST or-filter, so
  // they are dropped and the pattern quoted: "login, password" is plain text.
  const term = searchTerm(filters.search ?? "");
  const searchLogic = term
    ? `or(subject.ilike."%${term}%",description.ilike."%${term}%")`
    : null;

  // One or= parameter holding both trees, ANDed, rather than two that
  // PostgREST may not combine.
  const logic = [filters.viewLogic, searchLogic].filter(Boolean);
  if (logic.length === 1) filtered = filtered.or(logic[0]!);
  else if (logic.length > 1) filtered = filtered.or(`and(${logic.join(",")})`);

  return filtered;
}

export async function fetchTenantTickets(
  tenant: string,
  options: FetchTicketsOptions = {},
): Promise<{ tickets: Ticket[]; totalCount: number }> {
  const supabase = await createSupabaseServerClient();
  const tenantid = await getTenantIdBySlug(tenant);
  if (!tenantid) throw new Error("Tenant not found.");

  // No process_sla_breaches() here: pg_cron's sla_tick() marks overdue
  // clocks every 15 minutes, and the list works out breaches from due_at itself
  // (computeSlaClock), so a list render stays read-only.
  const {
    search,
    priority,
    status,
    assignee,
    viewFilter,
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

  // "me" is the viewer. Signed out it matches no one rather than everyone.
  const needsViewer =
    assignee === "me" ||
    !!viewFilter?.rules.some(
      (rule) => rule.field === "assignee" && rule.value === "me",
    );
  let viewerId = "00000000-0000-0000-0000-000000000000";
  if (needsViewer) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) viewerId = user.id;
  }

  let assigneeUserId: string | null | undefined;
  if (assignee === "unassigned") {
    assigneeUserId = null;
  } else if (assignee === "me") {
    assigneeUserId = viewerId;
  }

  const viewLogic = viewFilter ? filterToPostgrest(viewFilter, viewerId) : null;

  const filters = { search, priority, status, assigneeUserId, viewLogic };
  query = applyTicketFilters(query, filters);

  const sortColumn = sort === "subject" ? "subject" : "created_at";
  const sortAscending = sortOrder === "asc";

  const { data, error, count } = await query
    .order(sortColumn, { ascending: sortAscending })
    .range(from, to);

  // A page past the last row is PGRST103 (416), not an empty result. Treat it
  // as an empty page with the real total, so the table's "past the last
  // page" redirect can take the agent back to the last one.
  if (error?.code === "PGRST103") {
    const countQuery = supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantid);
    const { count: total, error: countError } = await applyTicketFilters(
      countQuery,
      filters,
    );
    if (countError) {
      fail("count tickets", countError, "Couldn't load tickets. Try again.");
    }
    return { tickets: [], totalCount: total ?? 0 };
  }

  // Thrown, not an empty list: an empty list reads as "Queue clear", and
  // agents would stop working tickets during an outage. error.tsx shows.
  if (error) {
    fail("load tickets", error, "Couldn't load tickets. Try again.");
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
          .select(
            `id, notify_before_mins, notify_before_breach, ${CALENDAR_SELECT}`,
          )
          .in("id", policyIds)
      : Promise.resolve({ data: [], error: null }),
    fetchTagsForTickets(ids),
  ]);

  const warnByPolicy = new Map(
    (policiesRes.data || []).map((p) => [p.id, slaWarnMins(p)]),
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
        sla_text: NO_SLA_TEXT,
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

  // ticket_tags only checks the ticket exists somewhere: confirm it is this
  // tenant's (and visible to the caller) before linking anything to it.
  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .select("id")
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (ticketError) {
    fail(
      "load ticket for tags",
      ticketError,
      "Couldn't update tags. Try again.",
    );
  }
  if (!ticket) throw new Error("Ticket not found.");

  const wanted = [...new Set(names.map(normalizeTagName).filter(Boolean))];

  const byName = new Map<string, TicketTag>();
  if (wanted.length > 0) {
    const { data: existing, error: existingError } = await supabase
      .from("tags")
      .select("id, name, color")
      .eq("tenant_id", tenantId)
      .in("name", wanted);
    if (existingError) {
      fail("load tags", existingError, "Couldn't update tags. Try again.");
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
      fail("create tags", insertError, "Couldn't update tags. Try again.");
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
    fail("load ticket tags", linksError, "Couldn't update tags. Try again.");
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
    if (error) fail("tag ticket", error, "Couldn't update tags. Try again.");
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("ticket_tags")
      .delete()
      .eq("ticket_id", ticketId)
      .eq("tenant_id", tenantId)
      .in("tag_id", toRemove);
    if (error) fail("untag ticket", error, "Couldn't update tags. Try again.");
  }

  return fetchTicketTags(ticketId);
}

/**
 * A policy's amber lead. With warnings off sla_tick sends none, so the UI
 * shows no amber either: a 0-minute lead.
 */
function slaWarnMins(policy: {
  notify_before_mins: number | null;
  notify_before_breach: boolean | null;
}): number {
  if (policy.notify_before_breach === false) return 0;
  return policy.notify_before_mins ?? DEFAULT_SLA_WARN_MINS;
}

/** The policy a ticket runs against, with what the SLA card shows of it. */
export async function fetchTicketSlaPolicy(
  policyId: string | null | undefined,
): Promise<TicketSlaPolicy | null> {
  if (!policyId) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sla_policies")
    .select(
      `id, name, notify_before_mins, notify_before_breach, ${CALENDAR_SELECT}`,
    )
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
    warn_before_mins: slaWarnMins(data),
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
  if (!tenantId) throw new Error("Tenant not found.");

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
    fail("create ticket", error, "Couldn't create the ticket. Try again.");
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

  if (error) {
    fail("load messages", error, "Couldn't load the conversation. Try again.");
  }

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
  if (!tenantId) throw new Error("Tenant not found.");
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
  if (error) {
    fail("send message", error, "Couldn't send the message. Try again.");
  }
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

  if (error) {
    fail("update ticket", error, "Couldn't update the ticket. Try again.");
  }
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
      // No plain-update fallback: it would skip the reason check, the kept
      // deadline and the audit entry that make a priority change trustworthy.
      console.error(
        "change_ticket_priority is missing; apply migration 20261011120000_ticket_priority_change_rules.sql.",
      );
      throw new Error(
        "Priority changes are unavailable until the database is updated. Contact your administrator.",
      );
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

  if (error) {
    fail(
      "bulk update tickets",
      error,
      "Couldn't update the tickets. Try again.",
    );
  }
  return data?.length ?? 0;
}

/** The storage bucket every ticket attachment lives in. */
const ATTACHMENT_BUCKET = "ticket-attachments";

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
    .from(ATTACHMENT_BUCKET)
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
    .storage.from(ATTACHMENT_BUCKET)
    .remove(staged.files.map((f) => f.path));
  if (error) {
    console.error("Could not remove staged attachments:", error.message);
  }
}

/**
 * Where a new ticket's files wait until the ticket exists: the portal's
 * staging prefix, `<tenant>/staging/<batch>/<file>`, which the daily
 * portal-staging-upload-sweep clears of anything never filed.
 */
const STAGING_SEGMENT = "staging";

/**
 * The caller is active staff of `tenant` and, with a `ticketId`, the ticket is
 * one of its. Every upload helper below writes with the admin client, which
 * skips RLS, so this is the check RLS would have made.
 */
async function requireStaffUploader(
  tenant: string,
  ticketId: string | null,
): Promise<{ tenantId: string; userId: string }> {
  const tenantId = await getTenantIdBySlug(tenant);
  if (!tenantId) throw new Error("Tenant not found.");

  const identity = await getCurrentUserIdentity(tenant);
  if (
    !identity?.id ||
    !identity.role ||
    !(ASSIGNABLE_ROLES as readonly string[]).includes(identity.role)
  ) {
    throw new Error("Unauthorized");
  }

  if (ticketId) {
    const supabase = await createSupabaseServerClient();
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id")
      .eq("id", ticketId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!ticket) throw new Error("Ticket not found.");
  }

  return { tenantId, userId: identity.id };
}

/** The folder files for `ticketId` (or a new ticket's batch) are put in. */
function uploadPrefix(tenantId: string, ticketId: string | null): string {
  return ticketId
    ? `${tenantId}/${ticketId}/`
    : `${tenantId}/${STAGING_SEGMENT}/`;
}

/**
 * The file name in `path` if it sits where this caller's uploads go --
 * directly under the ticket, or one batch folder under staging -- else null.
 */
function uploadedFileName(
  path: string,
  tenantId: string,
  ticketId: string | null,
): string | null {
  const prefix = uploadPrefix(tenantId, ticketId);
  if (!path.startsWith(prefix) || path.includes("..")) return null;
  const parts = path.slice(prefix.length).split("/");
  const depth = ticketId ? 1 : 2;
  if (parts.length !== depth || parts.some((p) => !p)) return null;
  return parts[parts.length - 1];
}

/**
 * Step one of attaching files: check the caller may, and hand the browser one
 * signed upload URL per file. The bytes go straight to storage, not through a
 * Server Action: the platform caps a request body at 4.5 MB, well under the
 * 20 MB attachments limit.
 *
 * A reply's files go under the ticket. A new ticket has no id yet, so its
 * files go under a random staging batch and are moved once it exists.
 */
export async function createTicketUploadTargets(params: {
  tenant: string;
  ticketId: string | null;
  files: { name: string; size: number }[];
}): Promise<TicketUploadTarget[]> {
  const { tenant, ticketId, files } = params;
  const { tenantId } = await requireStaffUploader(tenant, ticketId);

  // Count, total size and type: the pickers check these too, but this is the
  // copy that holds against a hand-made request. The sizes are the browser's
  // claim; inspectTicketUploads re-checks them on the stored objects.
  const invalid = attachmentsError(files);
  if (invalid) throw new Error(invalid);

  const folder = ticketId
    ? `${tenantId}/${ticketId}`
    : `${tenantId}/${STAGING_SEGMENT}/${crypto.randomUUID()}`;
  const admin = createSupabaseAdminClient();
  const targets: TicketUploadTarget[] = [];

  for (const file of files) {
    // Extension reduced to [a-z0-9] for the storage key; the stored content
    // type follows from it, never from the browser's file.type.
    const ext = attachmentExtension(file.name);
    // A random name: two files of the same type must never share a key.
    const path = `${folder}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
    const { data, error } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      fail(
        "authorise upload",
        error ?? { message: "no token returned" },
        "Couldn't start the upload. Try again.",
      );
    }
    targets.push({
      path,
      token: data.token,
      name: file.name,
      size: file.size,
      mime: attachmentContentType(file.name) ?? "application/octet-stream",
    });
  }

  return targets;
}

/** A media type without parameters, lower-case: "text/plain;charset=x" -> "text/plain". */
function bareMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

/**
 * Check files the browser reports it uploaded, and describe them for
 * recordStagedAttachments. Nothing the client sends is trusted: each path must
 * be a fresh upload where this caller's go (and on no attachments row yet),
 * and the size and type are read back off the stored object. A file stored
 * under a type other than its extension's -- which the composer never does --
 * is refused, so nothing can be served as active content from a signed link.
 *
 * With `ticketId` null the files are a new ticket's, still in staging; move
 * them with moveStagedTicketUploads once the ticket exists. On a failed check
 * the caller's uploads are removed.
 */
export async function inspectTicketUploads(params: {
  tenant: string;
  ticketId: string | null;
  uploads: TicketUploadedFile[];
}): Promise<StagedAttachments> {
  const { tenant, ticketId, uploads } = params;
  const { tenantId, userId } = await requireStaffUploader(tenant, ticketId);
  const staged: StagedAttachments = {
    tenantId,
    ticketId: ticketId ?? "",
    uploadedBy: userId,
    files: [],
  };
  if (uploads.length === 0) return staged;

  const refused = "Those files couldn't be attached. Try again.";
  const paths = uploads.map((u) => u.path);
  const names = paths.map((p) => uploadedFileName(p, tenantId, ticketId));
  if (names.some((n) => !n) || new Set(paths).size !== paths.length) {
    throw new Error(refused);
  }

  // A path already on an attachments row is somebody's filed file: refusing
  // it here keeps the cleanup below from ever deleting one.
  const admin = createSupabaseAdminClient();
  const { data: taken, error: takenError } = await admin
    .from("attachments")
    .select("storage_path")
    .in("storage_path", paths)
    .limit(1);
  if (takenError) {
    fail("attachment path check", takenError, refused);
  }
  if (taken && taken.length > 0) throw new Error(refused);

  const reject = async (message: string): Promise<never> => {
    const { error } = await admin.storage.from(ATTACHMENT_BUCKET).remove(paths);
    if (error) {
      console.error("Could not remove refused uploads:", error.message);
    }
    throw new Error(message);
  };

  for (const [i, upload] of uploads.entries()) {
    const storedName = names[i] as string;
    const directory = upload.path.slice(0, -storedName.length - 1);
    const stored = await statStoredObject(
      admin,
      ATTACHMENT_BUCKET,
      directory,
      storedName,
    );
    if (!stored) {
      return reject(`Couldn't attach ${upload.name}. Try again.`);
    }
    // The type comes from the server-minted name, whose extension was taken
    // from the original file name when the upload was authorised.
    const ext = attachmentExtension(storedName);
    const mime = attachmentContentType(storedName);
    if (!mime || bareMime(stored.mime) !== mime) {
      return reject(
        `${upload.name} can't be attached: that file type isn't allowed.`,
      );
    }
    staged.files.push({
      path: upload.path,
      storedName,
      original: upload.name,
      mime,
      ext,
      size: stored.size,
    });
  }

  const invalid = attachmentsError(
    staged.files.map((f) => ({ name: f.storedName, size: f.size })),
  );
  if (invalid) return reject(invalid);

  return staged;
}

/**
 * Move a new ticket's inspected files from staging onto the ticket. If any
 * move fails, the ones already moved are removed and the error is thrown,
 * leaving the caller to withdraw the ticket.
 */
export async function moveStagedTicketUploads(
  staged: StagedAttachments,
  ticketId: string,
): Promise<StagedAttachments> {
  const admin = createSupabaseAdminClient();
  const moved: StagedAttachments = { ...staged, ticketId, files: [] };

  for (const file of staged.files) {
    const path = `${staged.tenantId}/${ticketId}/${file.storedName}`;
    const { error } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .move(file.path, path);
    if (error) {
      console.error("Could not move a staged upload:", error.message);
      await discardStagedAttachments(moved);
      throw new Error(`Couldn't upload ${file.original}. Try again.`);
    }
    moved.files.push({ ...file, path });
  }

  return moved;
}

/**
 * Delete uploads the browser put in the bucket but never got to file: one
 * upload of several failed, or the reply or ticket was then refused. Only
 * paths that could be this caller's fresh uploads are touched (under the
 * ticket, or under staging), and anything on an attachments row is skipped,
 * so this can never remove a filed file. Best effort and silent: the staging
 * sweep is the backstop.
 */
export async function discardTicketUploads(params: {
  tenant: string;
  ticketId: string | null;
  paths: string[];
}): Promise<void> {
  const { tenant, ticketId, paths } = params;
  if (paths.length === 0) return;
  const { tenantId } = await requireStaffUploader(tenant, ticketId);

  const candidates = paths.filter((p) =>
    Boolean(uploadedFileName(p, tenantId, ticketId)),
  );
  if (candidates.length === 0) return;

  const admin = createSupabaseAdminClient();
  const { data: filed, error: filedError } = await admin
    .from("attachments")
    .select("storage_path")
    .in("storage_path", candidates);
  if (filedError) {
    console.error("Discard check failed:", filedError.message);
    return;
  }
  const keep = new Set((filed ?? []).map((r) => r.storage_path as string));
  const orphans = candidates.filter((p) => !keep.has(p));
  if (orphans.length === 0) return;

  const { error } = await admin.storage.from(ATTACHMENT_BUCKET).remove(orphans);
  if (error) {
    console.error("Could not discard unfiled uploads:", error.message);
  }
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
    throw new Error("Couldn't attach the files. Try again.");
  }

  return (data || []) as TicketAttachment[];
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
  const term = searchTerm(query).slice(0, 100);
  if (term) {
    request = request.or(
      `full_name.ilike."%${term}%",email.ilike."%${term}%",company.ilike."%${term}%"`,
    );
  }

  const { data, error } = await request
    .order("full_name", { ascending: true })
    .limit(REQUESTER_SEARCH_LIMIT);

  if (error) {
    fail("search customers", error, "Couldn't search customers. Try again.");
  }
  return data || [];
}
