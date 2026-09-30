import "server-only";

import { cache } from "react";

import { requestOrigin } from "@/features/auth/services/auth.service";
import { trustedCustomerAvatarUrl } from "@/features/portal/avatar-url";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import { inviteCustomerSchema } from "@/features/customers/schemas/customers";
import type { InviteCustomerValues } from "@/features/customers/schemas/customers";
import {
  getSessionTenantSlug,
  getTenantIdBySlug,
} from "@/features/tenancy/services/tenant-resolver";
import {
  getCallerRole,
  getCallerUserId,
} from "@/features/team/services/team.service";
import type {
  CustomerContact,
  CustomerDetail,
  CustomerInviteFailureCode,
  CustomerListItem,
  CustomerTicketPage,
  PortalInvite,
  PortalInviteStatus,
  TicketStatus,
} from "@/features/customers/types/customers";
import {
  canInviteToPortal,
  CUSTOMER_TICKET_PAGE_SIZE,
} from "@/features/customers/types/customers";
import { enqueueEmail } from "@/lib/email/email-queue";
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

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** What a customer reads as when nothing is outstanding. */
const NO_INVITE: PortalInvite = {
  status: "none",
  invitedAt: null,
  invitedBy: null,
};

/**
 * Thrown by the invite flow so the action can hand the user the sentence that
 * explains what went wrong, rather than a generic retry.
 */
export class CustomerInviteError extends Error {
  readonly status: number;
  readonly code: CustomerInviteFailureCode;

  constructor(
    message: string,
    { status = 400, code = "unknown" as CustomerInviteFailureCode } = {},
  ) {
    super(message);
    this.name = "CustomerInviteError";
    this.status = status;
    this.code = code;
  }
}

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
 * Mean CSAT per customer for the tenant, keyed by customer id.
 *
 * `csat_ratings` is not reachable from `customers` in the schema cache, and
 * embedding it would multiply rows by the number of ratings anyway, so it is a
 * second query over the whole table -- one for the page, not one per row, the
 * same shape as loadAvatars.
 *
 * Averages are computed here rather than in SQL: the column arrives as a plain
 * select, so there is no aggregate to trust, and a customer with two ratings
 * should weigh the same as one with twenty on this page.
 */
async function loadCsatScores(
  supabase: ServerClient,
  tenantId: string,
): Promise<Map<string, { score: number; count: number }>> {
  const scores = new Map<string, { score: number; count: number }>();

  const { data, error } = await supabase
    .from("csat_ratings")
    .select("customer_id, score")
    .eq("tenant_id", tenantId);

  if (error) {
    // The column is decoration next to the customer's identity: no ratings
    // reads as "—", not as a failed page.
    console.error("[customers] csat ratings failed:", error.message);
    return scores;
  }

  for (const row of data ?? []) {
    const customerId = (row as { customer_id?: string | null }).customer_id;
    const score = (row as { score?: number | null }).score;

    if (!customerId || typeof score !== "number") {
      continue;
    }

    const current = scores.get(customerId);

    scores.set(customerId, {
      score: current ? current.score + score : score,
      count: (current?.count ?? 0) + 1,
    });
  }

  for (const [customerId, { score, count }] of scores) {
    scores.set(customerId, { score: score / count, count });
  }

  return scores;
}

/**
 * Portal standing for every customer membership in the tenant, keyed by
 * lowercased email.
 *
 * `memberships` is the one place an invite is recorded, so this is the only
 * source for "Invited" -- `customers.portal_user_id` says someone has signed
 * in, not that anyone was ever asked to. One query for the tenant rather than
 * one per row, the same shape as loadAvatars.
 */
async function loadPortalInvites(
  supabase: ServerClient,
  tenantId: string,
): Promise<Map<string, PortalInvite>> {
  const invites = new Map<string, PortalInvite>();

  const { data, error } = await supabase
    .from("memberships")
    .select(
      "status, created_at, updated_at, user:users!memberships_user_id_fkey (email), inviter:users!memberships_invited_by_fkey (full_name)",
    )
    .eq("tenant_id", tenantId)
    .eq("role", "customer");

  if (error) {
    // The badge falls back to "Not signed in yet" and the invite button stays
    // available, which is the state the page is in before anyone is invited.
    console.error("[customers] portal invites failed:", error.message);
    return invites;
  }

  const rows = (data ?? []) as unknown as {
    status: string;
    created_at: string;
    updated_at: string;
    user: { email: string | null } | null;
    inviter: { full_name: string | null } | null;
  }[];

  for (const row of rows) {
    const email = row.user?.email?.trim().toLowerCase();

    if (!email) {
      continue;
    }

    // A disabled membership is not "invited": access was given and then taken
    // away, and from this page's point of view that is the same starting line
    // as never having been asked.
    const status: PortalInviteStatus =
      row.status === "active"
        ? "active"
        : row.status === "invited"
          ? "invited"
          : "none";

    invites.set(email, {
      status,
      // An invite has no timestamp of its own, the same as on the team table:
      // the row was created when the first mail went out and a resend bumps
      // updated_at, so for a pending invite that is when it went out.
      invitedAt: status === "none" ? null : (row.updated_at ?? row.created_at),
      invitedBy: row.inviter?.full_name ?? null,
    });
  }

  return invites;
}

/**
 * The later of two timestamps, either of which may be absent.
 *
 * PostgREST hands back `timestamptz` in one shape throughout, so the strings
 * compare correctly as strings; anything unparseable is treated as absent
 * rather than allowed to win the comparison and blank the cell.
 */
function newestOf(a: string | null, b: string | null): string | null {
  const left = a && !Number.isNaN(Date.parse(a)) ? a : null;
  const right = b && !Number.isNaN(Date.parse(b)) ? b : null;

  if (!left) return right;
  if (!right) return left;

  return Date.parse(left) >= Date.parse(right) ? left : right;
}

/**
 * Every customer in the tenant, with the ticket and CSAT facts the table shows.
 *
 * Both come from embedded selects rather than a second query over all tickets:
 * `ticket_count:tickets(count)` is counted by the database, and
 * `latest:tickets(updated_at)` is ordered and cut to one row per customer, so
 * the payload stays one row per customer however many tickets there are.
 */
export async function fetchTenantCustomers(
  tenantSlug: string,
): Promise<CustomerListItem[]> {
  const tenantId = await getTenantIdBySlug(tenantSlug);

  if (!tenantId) {
    return [];
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, full_name, email, company, created_at, portal_user_id, portal_last_login_at, ticket_count:tickets(count), latest:tickets(updated_at)",
    )
    .eq("tenant_id", tenantId)
    .order("updated_at", { referencedTable: "latest", ascending: false })
    .limit(1, { referencedTable: "latest" })
    .order("full_name", { ascending: true });

  if (error) {
    console.error("[customers] list failed:", error.message);
    return [];
  }

  // Independent reads, so they go out together rather than one after another.
  const [avatars, csatScores] = await Promise.all([
    loadAvatars(
      supabase,
      tenantId,
      (data ?? []).map((row) => row.portal_user_id),
    ),
    loadCsatScores(supabase, tenantId),
  ]);

  return (data ?? []).map((row) => {
    const csat = csatScores.get(row.id);

    return {
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
    };
  });
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
  const [openCount, companyRows, invites, csat] = await Promise.all([
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
    loadPortalInvites(supabase, tenantId),
    // This customer only, so the whole-table pass the list needs would be
    // wasted work for one row.
    supabase
      .from("csat_ratings")
      .select("score")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId),
  ]);

  // Averaged here for the same reason as the list: a customer with two
  // ratings should weigh the same as one with twenty.
  const csatScores = ((csat.data ?? []) as { score?: number | null }[])
    .map((row) => row.score)
    .filter((score): score is number => typeof score === "number");
  const csatScore =
    csatScores.length > 0
      ? csatScores.reduce((sum, score) => sum + score, 0) / csatScores.length
      : null;
  const csatCount = csatScores.length;

  // A failed query and a customer nobody has rated look identical on the page
  // -- "—" either way -- so the error has to be logged here or the card reads
  // as a data gap for good.
  if (csat.error) {
    console.error(`[customers] CSAT ${customerId} failed:`, csat.error.message);
  }

  // One query for this customer's photo and every colleague's.
  const avatars = await loadAvatars(supabase, tenantId, [
    customer.portal_user_id,
    ...(companyRows.data ?? []).map((contact) => contact.portal_user_id),
  ]);
  const avatarFor = (userId: string | null) =>
    userId ? (avatars.get(userId) ?? null) : null;
  const inviteFor = (email: string) =>
    invites.get(email.trim().toLowerCase()) ?? NO_INVITE;

  const contacts: CustomerContact[] = (companyRows.data ?? []).map(
    (contact) => ({
      id: contact.id,
      name: contact.full_name,
      email: contact.email,
      portalActive: Boolean(contact.portal_user_id),
      invite: inviteFor(contact.email),
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
    invite: inviteFor(customer.email),
    avatarUrl: avatarFor(customer.portal_user_id),
    openTicketsCount: openCount.count ?? 0,
    csatScore,
    csatCount,
    contacts,
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

// ---------------------------------------------------------------------------
// Portal invites
// ---------------------------------------------------------------------------

/**
 * The auth account and application profile behind an invite.
 *
 * `public.users` is looked up by email first because its id IS the auth id
 * (supabase/schemas/tables/04_users.sql) and every route that creates an
 * account writes both. The one address that is in `auth.users` with no profile
 * is someone who asked the portal for a sign-in link and never clicked it --
 * the email job creates the account, and only portal_link_user writes the
 * profile, on sign-in. createUser's email_exists is how that case announces
 * itself, and generateLink is the only admin call that hands back the id of an
 * account which already exists.
 */
async function resolveInviteAccount(
  admin: AdminClient,
  email: string,
  fullName: string,
): Promise<{ userId: string; createdAuthUser: boolean }> {
  const { data: existing, error: existingError } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle<{ id: string }>();

  if (existingError) {
    console.error(
      "[customers] invite profile lookup failed:",
      existingError.message,
    );
    throw new CustomerInviteError("We couldn't check that email address.", {
      status: 500,
    });
  }

  if (existing) {
    return { userId: existing.id, createdAuthUser: false };
  }

  // Confirmed, because the queued email mints a magic link and generateLink
  // only produces one for a confirmed address. The account is inert until that
  // link is clicked: no membership is active and no session can exist.
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

  if (!createError && created?.user?.id) {
    return { userId: created.user.id, createdAuthUser: true };
  }

  if (createError?.code !== "email_exists") {
    console.error(
      "[customers] invite createUser failed:",
      createError?.message,
    );
    throw new CustomerInviteError(
      "We couldn't create an account for that email. Try again.",
      { status: 400 },
    );
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !link?.user?.id) {
    console.error(
      "[customers] invite generateLink for an existing account failed:",
      linkError?.message,
    );
    throw new CustomerInviteError(
      "We couldn't find an account for that email. Try again.",
      { status: 400 },
    );
  }

  return { userId: link.user.id, createdAuthUser: false };
}

/**
 * Hand a customer the portal.
 *
 * The whole invite is one `memberships` row -- role 'customer', status
 * 'invited' -- plus the queued sign-in email. Nothing is written to
 * `customers`: portal_user_id means "has signed in", and claiming it here
 * would tell the team they were in before they ever were. The invite is
 * accepted by custom_access_token_hook, which flips the row to 'active' on the
 * customer's first sign-in, so a customer membership costs no agent seat and
 * the plan limit never applies to one.
 *
 * A customer takes no seat, but they do take a row, so pressing the button
 * twice is a resend rather than a second invite: both the pending row and a
 * row that was switched off are written back to 'invited'.
 */
export async function inviteCustomerToPortal(
  values: InviteCustomerValues,
): Promise<void> {
  const parsed = inviteCustomerSchema.safeParse(values);

  if (!parsed.success) {
    throw new CustomerInviteError("That customer no longer exists.", {
      status: 400,
      code: "customer-not-found",
    });
  }

  const role = await getCallerRole();

  if (role === null) {
    throw new CustomerInviteError("Sign in to do that.", {
      status: 401,
      code: "action-not-allowed",
    });
  }

  if (!canInviteToPortal(role)) {
    throw new CustomerInviteError(
      "Only a Tenant Admin can invite a customer to the portal.",
      { status: 403, code: "action-not-allowed" },
    );
  }

  // The tenant comes from the caller's own claims, never from the URL: a
  // customerId posted by hand must not reach a workspace the caller is not in.
  const slug = await getSessionTenantSlug();
  const tenantId = slug ? await getTenantIdBySlug(slug) : null;

  if (!slug || !tenantId) {
    throw new CustomerInviteError(
      "We couldn't work out which workspace this is.",
    );
  }

  const [callerUserId, tenantRow] = await Promise.all([
    getCallerUserId(),
    createSupabaseAdminClient()
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .maybeSingle<{ name: string }>(),
  ]);

  // The workspace's own name is what the portal email wears. A failed lookup
  // only costs the subject line, so it falls through to generic wording.
  const { data: tenant, error: tenantError } = tenantRow;

  if (tenantError) {
    console.error(
      "[customers] invite tenant lookup failed:",
      tenantError.message,
    );
  }

  const supabase = await createSupabaseServerClient();

  // Read through the caller's own client, so RLS is what keeps the customer
  // inside their workspace.
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, full_name, email, portal_user_id")
    .eq("id", parsed.data.customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      full_name: string;
      email: string;
      portal_user_id: string | null;
    }>();

  if (customerError) {
    console.error(
      `[customers] invite lookup for ${parsed.data.customerId} failed:`,
      customerError.message,
    );
    throw new CustomerInviteError("We couldn't look that customer up.", {
      status: 500,
    });
  }

  if (!customer) {
    throw new CustomerInviteError("That customer no longer exists.", {
      status: 404,
      code: "customer-not-found",
    });
  }

  if (customer.portal_user_id) {
    throw new CustomerInviteError(
      `${customer.full_name} already has portal access.`,
      { status: 409, code: "already-active" },
    );
  }

  const admin = createSupabaseAdminClient();
  const email = customer.email.trim().toLowerCase();
  const { userId, createdAuthUser } = await resolveInviteAccount(
    admin,
    email,
    customer.full_name,
  );

  // Undo the auth account if anything below fails, so a retry starts clean
  // instead of finding a half-made user.
  const rollbackNewUser = async () => {
    if (!createdAuthUser) return;
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error(
        "[customers] rollback of a new invitee failed:",
        error.message,
      );
    }
  };

  const { error: profileError } = await admin
    .from("users")
    .upsert(
      { id: userId, email, full_name: customer.full_name },
      { onConflict: "id" },
    );

  if (profileError) {
    await rollbackNewUser();
    throw new CustomerInviteError("We couldn't create that person's profile.", {
      status: 500,
    });
  }

  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("id, role, status")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle<{ id: string; role: string; status: string }>();

  if (membershipError) {
    await rollbackNewUser();
    console.error(
      "[customers] invite membership lookup failed:",
      membershipError.message,
    );
    throw new CustomerInviteError("We couldn't check their portal access.", {
      status: 500,
    });
  }

  if (membership && membership.role !== "customer") {
    // A team member of this workspace, invited as a customer, would be handed a
    // second role they cannot hold: hasTeamMembership turns them away from the
    // portal the moment they sign in, and the team page would lose them.
    throw new CustomerInviteError(
      `${customer.full_name} is already on your team and can't be a portal contact.`,
      { status: 409, code: "already-active" },
    );
  }

  if (membership?.status === "active") {
    // Caught by portal_user_id above in every case we have seen; kept so a
    // customer whose profile was unlinked by hand is not invited twice.
    throw new CustomerInviteError(
      `${customer.full_name} already has portal access.`,
      { status: 409, code: "already-active" },
    );
  }

  // Sessions cannot switch workspace yet, and custom_access_token_hook stamps
  // one membership per user, so an address that belongs to another workspace
  // would always sign in there and this invite would never be accepted.
  const { count: elsewhere, error: elsewhereError } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("tenant_id", tenantId)
    .neq("status", "disabled");

  if (elsewhereError) {
    await rollbackNewUser();
    console.error(
      "[customers] invite cross-workspace lookup failed:",
      elsewhereError.message,
    );
    throw new CustomerInviteError("We couldn't check their portal access.", {
      status: 500,
    });
  }

  if (elsewhere) {
    throw new CustomerInviteError(
      "That email already belongs to another workspace and can't be invited here yet.",
      { status: 409, code: "action-not-allowed" },
    );
  }

  const now = new Date().toISOString();

  if (membership) {
    // A pending invite is resent by pressing the button again, and a membership
    // that was switched off is re-opened by the same write. Either way there is
    // still only one row: (tenant_id, user_id) is unique.
    const { data: reused, error: reuseError } = await admin
      .from("memberships")
      .update({
        role: "customer",
        status: "invited",
        invited_by: callerUserId,
        disabled_at: null,
        // Stamped afresh by the hook when the invite is accepted.
        joined_at: null,
        updated_at: now,
      })
      .eq("id", membership.id)
      .eq("tenant_id", tenantId)
      // Only the row as it was read above, so a membership that changed in
      // between is left alone rather than overwritten.
      .eq("status", membership.status)
      .select("id")
      .maybeSingle<{ id: string }>();

    // A guarded update that matches nothing reports no error, so the row coming
    // back is the only evidence it was written. Without it a membership
    // accepted in the meantime would still get an email for an invite that no
    // longer exists.
    if (reuseError || !reused) {
      await rollbackNewUser();
      console.error(
        "[customers] invite membership reuse failed:",
        reuseError
          ? reuseError.message
          : "the membership changed while we read it",
      );
      throw new CustomerInviteError(
        reuseError
          ? "We couldn't send that invite. Try again."
          : "Their portal access just changed. Refresh to see where they are.",
        { status: reuseError ? 500 : 409 },
      );
    }
  } else {
    const { error: insertError } = await admin.from("memberships").insert({
      tenant_id: tenantId,
      user_id: userId,
      role: "customer",
      status: "invited",
      invited_by: callerUserId,
    });

    if (insertError) {
      await rollbackNewUser();
      console.error(
        "[customers] invite membership insert failed:",
        insertError.message,
      );
      throw new CustomerInviteError(
        "We couldn't send that invite. Try again.",
        {
          status: 500,
        },
      );
    }
  }

  // Mail last, and the same email a customer signs in with: the portal's own
  // magic link, which wears the workspace's name and lands on the portal
  // callback. Queued rather than sent inline so the invite answers without
  // waiting on the auth API and Resend, and a failed send is retried. The
  // membership is already written, so pressing the button again re-queues it.
  const origin = await requestOrigin();
  const redirectTo = new URL(
    portalPath(slug, PORTAL_ROUTES.AUTH_CALLBACK),
    origin,
  ).toString();

  try {
    await enqueueEmail(
      "portal_sign_in",
      { email, redirectTo, tenantName: tenant?.name ?? "your support team" },
      {
        tenantId,
        dedupeKey: `portal:${tenantId}:${email}`,
      },
    );
  } catch {
    throw new CustomerInviteError(
      "We couldn't email them their invite. Try again in a moment.",
      { status: 502 },
    );
  }
}
