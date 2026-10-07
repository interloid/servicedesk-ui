import "server-only";

import { cache } from "react";

import { trustedCustomerAvatarUrl } from "@/features/portal/avatar-url";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import type {
  CustomerPortalStatus,
  CustomerContact,
  CustomerDetail,
  CustomerListItem,
  CustomerListPage,
  CustomerSort,
  CustomerTicketPage,
  TicketStatus,
} from "@/features/customers/types/customers";
import {
  CUSTOMER_PORTAL_STATUS_FROM_DB,
  CUSTOMER_LIST_PAGE_SIZE,
  CUSTOMER_TICKET_PAGE_SIZE,
} from "@/features/customers/types/customers";
import { ilikeOrValue } from "@/lib/postgrest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Statuses that still need something from the team. */
const OPEN_STATUSES: TicketStatus[] = ["new", "open", "pending", "on_hold"];

/**
 * The server's clock, read once per request. Passed down so relative times
 * ("52 minutes ago") render the same on the server and in the browser.
 */
export const serverNow = cache(async function serverNow(): Promise<number> {
  return Date.now();
});

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Photos for the given portal users, keyed by user id.
 *
 * The photo lives on `users.avatar_url` (the portal's Profile settings writes
 * it there), reached through `customers.portal_user_id`. There is no foreign
 * key between the two, so it is a second query rather than an embed; one
 * query for the whole page, not one per row. `users_select` lets a member of
 * the tenant read the users who hold a membership in it, which customers do.
 *
 * Every URL goes through trustedCustomerAvatarUrl: a customer can write the
 * column themselves, and an unchecked value would be loaded by every agent.
 */
async function loadAvatars(
  supabase: ServerClient,
  tenantId: string,
  userIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(userIds.filter((id): id is string => Boolean(id))),
  );
  const avatars = new Map<string, string>();

  if (ids.length === 0) {
    return avatars;
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, avatar_url")
    .in("id", ids);

  if (error) {
    // Photos are decoration: initials are a fine fallback, not a failure.
    console.error("[customers] avatars failed:", error.message);
    return avatars;
  }

  for (const row of data ?? []) {
    const url = trustedCustomerAvatarUrl(tenantId, row.id, row.avatar_url);

    if (url) {
      avatars.set(row.id, url);
    }
  }

  return avatars;
}

/**
 * Portal status per customer, keyed by lower-cased email.
 *
 * From the customer's `memberships` row in this workspace. A customer who has
 * signed in is reached through `portal_user_id`; one who was invited and has
 * not signed in yet has no link on the customer row, so their account is found
 * by email. Admin client, scoped to the tenant: an invited person's profile is
 * not always visible to the agent's RLS, and the answer must not depend on it.
 * No membership at all reads as "Not invited".
 */
async function loadPortalStatuses(
  tenantId: string,
  rows: { email: string; portal_user_id: string | null }[],
): Promise<Map<string, CustomerPortalStatus>> {
  const statuses = new Map<string, CustomerPortalStatus>();

  if (rows.length === 0) {
    return statuses;
  }

  const admin = createSupabaseAdminClient();
  const userByEmail = new Map<string, string>();
  const unlinked: string[] = [];

  for (const row of rows) {
    const email = row.email.toLowerCase();

    if (row.portal_user_id) {
      userByEmail.set(email, row.portal_user_id);
    } else {
      unlinked.push(email);
    }
  }

  if (unlinked.length > 0) {
    const { data, error } = await admin
      .from("users")
      .select("id, email")
      .in("email", unlinked);

    if (error) {
      console.error("[customers] portal accounts failed:", error.message);
    }

    for (const user of data ?? []) {
      userByEmail.set(user.email.toLowerCase(), user.id);
    }
  }

  const userIds = Array.from(new Set(userByEmail.values()));

  if (userIds.length === 0) {
    return statuses;
  }

  const { data: memberships, error } = await admin
    .from("memberships")
    .select("user_id, status")
    .eq("tenant_id", tenantId)
    .eq("role", "customer")
    .in("user_id", userIds);

  if (error) {
    // Decoration next to the customer's name: logged, and shown as unknown
    // ("Not invited") rather than failing the page.
    console.error("[customers] portal statuses failed:", error.message);
    return statuses;
  }

  const statusByUser = new Map(
    (memberships ?? []).map((row) => [row.user_id, row.status]),
  );

  for (const [email, userId] of userByEmail) {
    const status =
      CUSTOMER_PORTAL_STATUS_FROM_DB[statusByUser.get(userId) ?? ""];

    if (status) {
      statuses.set(email, status);
    }
  }

  return statuses;
}

/** API's per-response row cap (`max_rows` in supabase/config.toml). */
const API_ROW_CAP = 1000;

const LIST_COLUMNS =
  "id, full_name, email, company, created_at, portal_user_id, portal_last_login_at, ticket_count:tickets(count), latest:tickets(updated_at)";

/** The `customers` column behind each list column that sorts in SQL. */
const SQL_SORT_COLUMNS: Partial<Record<CustomerSort["key"], string>> = {
  fullName: "full_name",
  company: "company",
  createdAt: "created_at",
};

type CustomerListRow = {
  id: string;
  full_name: string;
  email: string;
  company: string | null;
  created_at: string;
  portal_user_id: string | null;
  portal_last_login_at: string | null;
  ticket_count: { count: number }[] | null;
  latest: { updated_at: string }[] | null;
};

/**
 * The later of two timestamps, either of which may be absent. Anything
 * unparseable is treated as absent rather than allowed to win.
 */
function newestOf(a: string | null, b: string | null): string | null {
  const left = a && !Number.isNaN(Date.parse(a)) ? a : null;
  const right = b && !Number.isNaN(Date.parse(b)) ? b : null;

  if (!left) return right;
  if (!right) return left;

  return Date.parse(left) >= Date.parse(right) ? left : right;
}

/**
 * Mean CSAT and rating count per customer, from `csat_ratings`.
 *
 * Read in pages of the API's row cap so a tenant with more ratings than one
 * response holds still gets every one of them counted; past the cap PostgREST
 * truncates silently. `customerIds` narrows it to one page of the list; leave
 * it out to read the whole tenant (sorting by CSAT needs every customer's).
 */
async function loadCsatScores(
  supabase: ServerClient,
  tenantId: string,
  customerIds?: string[],
): Promise<Map<string, { score: number; count: number }>> {
  const totals = new Map<string, { sum: number; count: number }>();

  if (customerIds && customerIds.length === 0) {
    return new Map();
  }

  for (let from = 0; ; from += API_ROW_CAP) {
    let query = supabase
      .from("csat_ratings")
      .select("customer_id, score")
      .eq("tenant_id", tenantId);

    if (customerIds) {
      query = query.in("customer_id", customerIds);
    }

    const { data, error } = await query
      .order("id", { ascending: true })
      .range(from, from + API_ROW_CAP - 1);

    if (error) {
      // The column is decoration next to the customer's identity: no ratings
      // reads as "—", not as a failed page.
      console.error("[customers] csat ratings failed:", error.message);
      break;
    }

    for (const row of data ?? []) {
      const score = Number(row.score);

      if (!row.customer_id || !Number.isFinite(score)) continue;

      const total = totals.get(row.customer_id) ?? { sum: 0, count: 0 };
      total.sum += score;
      total.count += 1;
      totals.set(row.customer_id, total);
    }

    if ((data ?? []).length < API_ROW_CAP) break;
  }

  const scores = new Map<string, { score: number; count: number }>();

  for (const [id, { sum, count }] of totals) {
    scores.set(id, { score: Math.round((sum / count) * 100) / 100, count });
  }

  return scores;
}

/**
 * One page of the tenant's customers, with the ticket and CSAT facts the table
 * shows.
 *
 * Read from `customers`, with ticket count and latest ticket as embedded
 * selects (`ticket_count:tickets(count)` is counted by the database, and
 * `latest:tickets(updated_at)` is ordered and cut to one row per customer).
 *
 * Name, company and date added are real columns, so those sorts are searched,
 * sorted and paged in SQL. Tickets, last activity and CSAT are computed per
 * customer, so for those every matching customer is read -- in pages of the
 * API's row cap, never cut short by it -- sorted here, and sliced to the page.
 */
export async function fetchTenantCustomers(
  tenantSlug: string,
  {
    search,
    page: requestedPage,
    sort,
  }: { search: string; page: number; sort: CustomerSort },
): Promise<CustomerListPage> {
  const empty: CustomerListPage = {
    customers: [],
    total: 0,
    tenantTotal: 0,
    page: 1,
    pageCount: 1,
  };

  const tenantId = await getTenantIdBySlug(tenantSlug);

  if (!tenantId) {
    return empty;
  }

  const supabase = await createSupabaseServerClient();
  const term = search.trim();
  const wanted = Math.max(1, Math.floor(requestedPage) || 1);
  const ascending = sort.direction === "asc";
  const sqlColumn = SQL_SORT_COLUMNS[sort.key];

  const baseQuery = () => {
    let query = supabase
      .from("customers")
      .select(LIST_COLUMNS, { count: "exact" })
      .eq("tenant_id", tenantId);

    if (term) {
      const value = ilikeOrValue(term);

      query = query.or(
        `full_name.ilike.${value},email.ilike.${value},company.ilike.${value}`,
      );
    }

    return query
      .order("updated_at", { referencedTable: "latest", ascending: false })
      .limit(1, { referencedTable: "latest" });
  };

  // One SQL page, for the sorts the database can do itself.
  const readSqlPage = async (target: number) => {
    const from = (target - 1) * CUSTOMER_LIST_PAGE_SIZE;
    const { data, error, count } = await baseQuery()
      .order(sqlColumn ?? "full_name", {
        ascending,
        // A customer with no company sorts after every named one either way,
        // the same as the "—" it shows.
        nullsFirst: false,
      })
      // id as the tiebreak: two customers with the same name would otherwise
      // be free to swap places, and to appear on two pages or on none.
      .order("id", { ascending: true })
      .range(from, from + CUSTOMER_LIST_PAGE_SIZE - 1)
      .returns<CustomerListRow[]>();

    if (error) {
      console.error("[customers] list failed:", error.message);
      return null;
    }

    return { rows: data ?? [], total: count ?? 0 };
  };

  // Every matching customer, for the computed sorts.
  const readAll = async () => {
    const rows: CustomerListRow[] = [];

    for (let from = 0; ; from += API_ROW_CAP) {
      const { data, error } = await baseQuery()
        .order("id", { ascending: true })
        .range(from, from + API_ROW_CAP - 1)
        .returns<CustomerListRow[]>();

      if (error) {
        console.error("[customers] list failed:", error.message);
        return null;
      }

      rows.push(...(data ?? []));

      if ((data ?? []).length < API_ROW_CAP) break;
    }

    return rows;
  };

  const toItem = (
    row: CustomerListRow,
    csat: { score: number; count: number } | undefined,
    avatars: Map<string, string>,
  ): CustomerListItem => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    company: row.company,
    createdAt: row.created_at,
    portalActive: Boolean(row.portal_user_id),
    avatarUrl: row.portal_user_id
      ? (avatars.get(row.portal_user_id) ?? null)
      : null,
    ticketCount: row.ticket_count?.[0]?.count ?? 0,
    // Signing in to the portal is activity in its own right, so a customer
    // who has never raised a ticket is not blank: take whichever of the two
    // happened more recently.
    lastActivityAt: newestOf(
      row.latest?.[0]?.updated_at ?? null,
      row.portal_last_login_at,
    ),
    csatScore: csat?.score ?? null,
    csatCount: csat?.count ?? 0,
    // Filled in for the page's rows once the page is known.
    portalStatus: "Not invited",
  });

  const withPortalStatus = async (
    items: CustomerListItem[],
    rows: CustomerListRow[],
  ): Promise<CustomerListItem[]> => {
    const statuses = await loadPortalStatuses(tenantId, rows);

    return items.map((item) => ({
      ...item,
      portalStatus: statuses.get(item.email.toLowerCase()) ?? "Not invited",
    }));
  };

  // With a search, the tenant's own total is a second count: it decides
  // between "no customers yet" and "nothing matches", which read differently.
  const tenantCountQuery = term
    ? supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
    : Promise.resolve(null);

  let pageRows: CustomerListRow[];
  let pageItems: CustomerListItem[] | null = null;
  let total: number;
  let page: number;

  if (sqlColumn) {
    const [first, tenantCount] = await Promise.all([
      readSqlPage(wanted),
      tenantCountQuery,
    ]);

    if (!first) {
      return empty;
    }

    total = first.total;
    page = Math.min(
      wanted,
      Math.max(1, Math.ceil(total / CUSTOMER_LIST_PAGE_SIZE)),
    );

    // A bookmark or a narrower search can point past the end. Re-read the
    // last page rather than answering a URL that exists with an empty list.
    pageRows =
      page === wanted ? first.rows : ((await readSqlPage(page))?.rows ?? []);

    const [avatars, csatScores] = await Promise.all([
      loadAvatars(
        supabase,
        tenantId,
        pageRows.map((row) => row.portal_user_id),
      ),
      loadCsatScores(
        supabase,
        tenantId,
        pageRows.map((row) => row.id),
      ),
    ]);

    pageItems = pageRows.map((row) =>
      toItem(row, csatScores.get(row.id), avatars),
    );

    return finish(
      await withPortalStatus(pageItems, pageRows),
      total,
      page,
      tenantCount,
    );
  }

  const [all, csatScores, tenantCount] = await Promise.all([
    readAll(),
    loadCsatScores(supabase, tenantId),
    tenantCountQuery,
  ]);

  if (!all) {
    return empty;
  }

  const noAvatars = new Map<string, string>();
  const value = (item: CustomerListItem): number | null => {
    if (sort.key === "ticketCount") return item.ticketCount;
    if (sort.key === "csatScore") return item.csatScore;

    return item.lastActivityAt ? Date.parse(item.lastActivityAt) : null;
  };

  const sorted = all
    .map((row) => toItem(row, csatScores.get(row.id), noAvatars))
    .sort((a, b) => {
      const left = value(a);
      const right = value(b);

      // Blank values sort after every real one either way, like the "—".
      if (left === null || right === null) {
        if (left === right) return a.id.localeCompare(b.id);
        return left === null ? 1 : -1;
      }

      if (left !== right) return ascending ? left - right : right - left;

      return a.id.localeCompare(b.id);
    });

  total = sorted.length;
  page = Math.min(
    wanted,
    Math.max(1, Math.ceil(total / CUSTOMER_LIST_PAGE_SIZE)),
  );

  const from = (page - 1) * CUSTOMER_LIST_PAGE_SIZE;
  const slice = sorted.slice(from, from + CUSTOMER_LIST_PAGE_SIZE);
  const avatars = await loadAvatars(
    supabase,
    tenantId,
    all
      .filter((row) => slice.some((item) => item.id === row.id))
      .map((row) => row.portal_user_id),
  );

  pageItems = slice.map((item) => {
    const row = all.find((candidate) => candidate.id === item.id);

    return {
      ...item,
      avatarUrl: row?.portal_user_id
        ? (avatars.get(row.portal_user_id) ?? null)
        : null,
    };
  });

  return finish(
    await withPortalStatus(
      pageItems,
      all.filter((row) => slice.some((item) => item.id === row.id)),
    ),
    total,
    page,
    tenantCount,
  );

  function finish(
    customers: CustomerListItem[],
    matched: number,
    current: number,
    tenantCount: { count: number | null } | null,
  ): CustomerListPage {
    return {
      customers,
      total: matched,
      tenantTotal: tenantCount ? (tenantCount.count ?? matched) : matched,
      page: current,
      pageCount: Math.max(1, Math.ceil(matched / CUSTOMER_LIST_PAGE_SIZE)),
    };
  }
}

/**
 * Cached per request: the route's generateMetadata and the page both ask for
 * the same customer, and this is several queries deep.
 */
export const fetchCustomerById = cache(async function fetchCustomerById(
  tenantSlug: string,
  customerId: string,
): Promise<CustomerDetail | null> {
  const tenantId = await getTenantIdBySlug(tenantSlug);

  if (!tenantId) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  const { data: customer, error } = await supabase
    .from("customers")
    .select("id, full_name, email, company, phone, created_at, portal_user_id")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !customer) {
    if (error) {
      console.error(`[customers] ${customerId} failed:`, error.message);
    }

    return null;
  }

  // Independent reads, so they go out together rather than one after another.
  const [openCount, companyRows, csat] = await Promise.all([
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("requester_customer_id", customerId)
      .in("status", OPEN_STATUSES),
    customer.company
      ? supabase
          .from("customers")
          .select("id, full_name, email, portal_user_id")
          .eq("tenant_id", tenantId)
          .eq("company", customer.company)
          .neq("id", customerId)
          .order("full_name", { ascending: true })
      : Promise.resolve({ data: [] as never[], error: null }),
    // This customer only; failures are logged inside, and read as "—".
    loadCsatScores(supabase, tenantId, [customerId]),
  ]);

  const portalStatus =
    (
      await loadPortalStatuses(tenantId, [
        { email: customer.email, portal_user_id: customer.portal_user_id },
      ])
    ).get(customer.email.toLowerCase()) ?? "Not invited";

  const csatScore = csat.get(customerId)?.score ?? null;
  const csatCount = csat.get(customerId)?.count ?? 0;

  // One query for this customer's photo and every colleague's.
  const avatars = await loadAvatars(supabase, tenantId, [
    customer.portal_user_id,
    ...(companyRows.data ?? []).map((contact) => contact.portal_user_id),
  ]);
  const avatarFor = (userId: string | null) =>
    userId ? (avatars.get(userId) ?? null) : null;

  const contacts: CustomerContact[] = (companyRows.data ?? []).map(
    (contact) => ({
      id: contact.id,
      name: contact.full_name,
      email: contact.email,
      portalActive: Boolean(contact.portal_user_id),
      avatarUrl: avatarFor(contact.portal_user_id),
    }),
  );

  return {
    id: customer.id,
    fullName: customer.full_name,
    email: customer.email,
    company: customer.company,
    phone: customer.phone,
    createdAt: customer.created_at,
    portalActive: Boolean(customer.portal_user_id),
    avatarUrl: avatarFor(customer.portal_user_id),
    openTicketsCount: openCount.count ?? 0,
    csatScore,
    csatCount,
    contacts,
    portalStatus,
  };
});

/**
 * One page of a customer's tickets, newest first, with the count it is a page
 * of.
 *
 * Paged in the database rather than in the browser. The count rides back on
 * the same query, so the pager and the tab's own count can never disagree, and
 * a customer with four hundred tickets costs the same as one with four.
 */
export const fetchCustomerTickets = cache(async function fetchCustomerTickets(
  tenantSlug: string,
  customerId: string,
  requestedPage: number,
): Promise<CustomerTicketPage> {
  const empty: CustomerTicketPage = {
    tickets: [],
    total: 0,
    page: 1,
    pageCount: 1,
  };

  const tenantId = await getTenantIdBySlug(tenantSlug);

  if (!tenantId) {
    return empty;
  }

  const supabase = await createSupabaseServerClient();
  const wanted = Math.max(1, Math.floor(requestedPage) || 1);

  const readPage = async (target: number) => {
    const from = (target - 1) * CUSTOMER_TICKET_PAGE_SIZE;

    const { data, error, count } = await supabase
      .from("tickets")
      .select(
        "id, number, subject, status, created_at, updated_at, resolved_at",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .eq("requester_customer_id", customerId)
      // id as the tiebreak: two tickets raised in the same millisecond would
      // otherwise be free to swap places between one page and the next.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + CUSTOMER_TICKET_PAGE_SIZE - 1);

    if (error) {
      console.error(`[customers] tickets ${customerId} failed:`, error.message);

      return null;
    }

    return { rows: data ?? [], total: count ?? 0 };
  };

  const first = await readPage(wanted);

  if (!first) {
    return empty;
  }

  const pageCount = Math.max(
    1,
    Math.ceil(first.total / CUSTOMER_TICKET_PAGE_SIZE),
  );
  const page = Math.min(wanted, pageCount);

  // A shared link, or a bookmark from when the customer had more tickets, can
  // point past the end. Re-read the last page rather than answering a URL
  // that exists with an empty list.
  const result = page === wanted ? first : ((await readPage(page)) ?? first);

  return {
    tickets: result.rows.map((ticket) => ({
      id: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      status: ticket.status,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      resolvedAt: ticket.resolved_at,
    })),
    total: result.total,
    page,
    pageCount,
  };
});
