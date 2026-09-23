import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";

import type {
  ChangeMemberRoleValues,
  ChangeMemberStatusValues,
  InviteMemberValues,
  RemoveMemberValues,
  ResendInviteValues,
} from "@/features/team/schemas/team";
import type {
  TeamFailureCode,
  TeamMember,
  TeamRole,
  TeamSeats,
  TeamStatus,
  TenantPlanRecord,
  TenantPlanRow,
} from "@/features/team/types/team";
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  FREE_SEAT_LIMIT,
  getTeamSeats as calcTeamSeats,
  hasSeatLeft,
  STAFF_ROLES,
  TEAM_ROLE_ORDER,
  TEAM_STATUS_ORDER,
} from "@/features/team/types/team";

import { requestOrigin } from "@/features/auth/services/auth.service";
import { cache } from "react";

export class TeamError extends Error {
  readonly status: number;
  readonly code: TeamFailureCode;

  constructor(
    message: string,
    { status = 400, code = "unknown" as TeamFailureCode } = {},
  ) {
    super(message);
    this.name = "TeamError";
    this.status = status;
    this.code = code;
  }
}

type PostgrestFailure = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

/**
 * Raised by the enforce_team_seat_limit trigger. The app checks seats before
 * writing too, but only the trigger holds a lock, so it is what stops two
 * invites sent at the same moment from both taking the last seat.
 */
const SEAT_LIMIT_SQLSTATE = "TS409";

function toFailureCode(pgCode: string | undefined): TeamFailureCode {
  switch (pgCode) {
    case SEAT_LIMIT_SQLSTATE:
      return "seat-limit-reached";
    case "42501":
      return "action-not-allowed";
    case "23505":
      return "already-member";
    case "23503":
    case "P0001":
      return "member-not-found";
    default:
      return "unknown";
  }
}

function fail(
  userMessage: string,
  error: PostgrestFailure | null | undefined,
  status = 500,
) {
  if (error) {
    console.error(
      `[team] ${userMessage} — ${error.code ?? "?"} ${error.message ?? ""}`.trim(),
      error.details ? `\n  details: ${error.details}` : "",
      error.hint ? `\n  hint: ${error.hint}` : "",
    );
  }

  if (error?.code === SEAT_LIMIT_SQLSTATE) {
    return new TeamError(
      "All of your seats are in use. Remove or disable someone, or upgrade to add more.",
      { status: 409, code: "seat-limit-reached" },
    );
  }

  return new TeamError(userMessage, {
    status,
    code: toFailureCode(error?.code),
  });
}

function seatLimitError(seats: TeamSeats) {
  return new TeamError(
    `Your plan includes ${seats.limit} seat${
      seats.limit === 1 ? "" : "s"
    } and all ${seats.limit} are in use. Remove or disable someone, or upgrade to add more.`,
    { status: 409, code: "seat-limit-reached" },
  );
}

const ROLE_TO_DB: Record<TeamRole, string> = {
  "Tenant Admin": "tenant_admin",
  Manager: "manager",
  Agent: "agent",
  "Billing Admin": "billing_admin",
};

const ROLE_FROM_DB: Record<string, TeamRole> = {
  tenant_admin: "Tenant Admin",
  manager: "Manager",
  agent: "Agent",
  billing_admin: "Billing Admin",
};

const STATUS_TO_DB: Record<TeamStatus, string> = {
  Active: "active",
  Invited: "invited",
  Disabled: "disabled",
};

const STATUS_FROM_DB: Record<string, TeamStatus> = {
  active: "Active",
  invited: "Invited",
  disabled: "Disabled",
};

type TeamActor = {
  userId: string;
  tenantId: string;
  /** From the `tenant_slug` claim. Needed to build tenant-scoped email links. */
  tenantSlug: string | null;
  role: TeamRole | null;
};

/**
 * Wrapped in React's `cache` so one render resolves the actor once. It takes no
 * arguments on purpose: `cache` matches arguments by identity, and every
 * createSupabaseServerClient() call returns a new object, so keying it on the
 * client (as it used to be) missed on every call.
 *
 * The role comes from the live membership row, not the JWT claim. The claim
 * lives until the token refreshes (up to an hour), so a removed, disabled or
 * demoted member kept their old powers here for that long.
 */
const getActorOrNull = cache(
  async function getActorOrNull(): Promise<TeamActor | null> {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return null;
    }

    const { data: claims } = await supabase.auth.getClaims();
    const tenantId = claims?.claims?.tenant_id as string | undefined;
    const tenantSlug = claims?.claims?.tenant_slug as string | undefined;

    if (!tenantId) {
      return null;
    }

    // Admin client: this must see "no row" as "removed", never as "RLS hid it".
    const { data: live, error: liveError } = await createSupabaseAdminClient()
      .from("memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .maybeSingle<{ role: string }>();

    if (liveError) {
      throw fail("We couldn't check your access to this workspace.", liveError);
    }

    if (!live) {
      return null;
    }

    return {
      userId: user.id,
      tenantId,
      tenantSlug: tenantSlug ?? null,
      role: ROLE_FROM_DB[live.role] ?? null,
    };
  },
);

async function requireActor(): Promise<TeamActor> {
  const actor = await getActorOrNull();

  if (!actor) {
    throw new TeamError("Sign in to do that.", {
      status: 401,
      code: "action-not-allowed",
    });
  }

  return actor;
}

function assertRole(actor: TeamActor, allowed: TeamRole[], message: string) {
  if (!actor.role || !allowed.includes(actor.role)) {
    throw new TeamError(message, {
      status: 403,
      code: "action-not-allowed",
    });
  }
}

const MEMBER_SELECT = `
  id,
  role,
  status,
  invited_by,
  joined_at,
  disabled_at,
  created_at,
  user:users!memberships_user_id_fkey (
    id,
    email,
    full_name,
    avatar_url
  ),
  inviter:users!memberships_invited_by_fkey (
    full_name
  )
` as const;

type MemberRow = {
  id: string;
  role: string;
  status: string;
  invited_by: string | null;
  joined_at: string | null;
  disabled_at: string | null;
  created_at: string;
  user: {
    id: string;
    email: string | null;
    full_name: string | null;
    avatar_url: string | null;
  } | null;
  inviter: { full_name: string | null } | null;
};

export async function listTeamMembers(): Promise<TeamMember[]> {
  const supabase = await createSupabaseServerClient();
  const currentUserId = (await getActorOrNull())?.userId ?? null;

  // Staff only. Portal customers are members of the tenant but they are not
  // the team, and they must never appear on a screen that can disable an
  // account or change a role.
  const { data, error } = await supabase
    .from("memberships")
    .select(MEMBER_SELECT)
    .in("role", [...STAFF_ROLES])
    .returns<MemberRow[]>();

  if (error) {
    throw fail("Couldn't load the team.", error);
  }

  return (data ?? [])
    .map((row): TeamMember | null => {
      const status = STATUS_FROM_DB[row.status] ?? "Active";
      const role = ROLE_FROM_DB[row.role] ?? "Agent";

      if (!row.user) {
        return null;
      }

      return {
        id: row.id,
        name: row.user.full_name || row.user.email || "—",
        email: row.user.email || "",
        avatarUrl: row.user.avatar_url,
        role,
        status,
        isSelf: currentUserId !== null && row.user.id === currentUserId,
        // The founding tenant admin never went through an invite, so the
        // backfill left joined_at null. The membership row was created when
        // the workspace was, which is the date we mean by "joined". Invites
        // are excluded: for them created_at is when the mail went out, not a
        // join, and the column says "Not yet joined" instead.
        joinedAt:
          row.joined_at ?? (status === "Invited" ? null : row.created_at),
        // An invite has no timestamp of its own -- the row is created by the
        // invite, so its created_at IS when the invitation went out.
        invitedAt: row.created_at,
        disabledAt: row.disabled_at,
        invitedBy: row.inviter?.full_name ?? row.invited_by,
      };
    })
    .filter((member): member is TeamMember => member !== null)
    .sort((a, b) => {
      // The signed-in person always leads, so "You" is the first row whatever
      // their role.
      const roleOrder =
        Number(b.isSelf) - Number(a.isSelf) ||
        TEAM_ROLE_ORDER[a.role] - TEAM_ROLE_ORDER[b.role] ||
        TEAM_STATUS_ORDER[a.status] - TEAM_STATUS_ORDER[b.status] ||
        a.name.localeCompare(b.name);
      return roleOrder;
    });
}

/**
 * Seats used and allowed on the tenant's current plan.
 *
 * A seat is any staff membership that can still sign in — the Tenant Admin
 * included, so Free's two seats mean the admin plus one other person, not two
 * on top of the admin. Disabled members are not counted: they have no access,
 * and "disable someone" is the cheaper half of the advice the invite gate
 * gives. Pending invites ARE counted, or the limit would only bind after
 * everyone accepted.
 */
export async function getTeamSeats(): Promise<TeamSeats> {
  const supabase = await createSupabaseServerClient();
  const actor = await getActorOrNull();

  if (!actor) {
    return calcTeamSeats(0, FREE_SEAT_LIMIT);
  }

  const { count, error: countError } = await supabase
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", actor.tenantId)
    .in("role", [...STAFF_ROLES])
    .neq("status", "disabled");

  if (countError) {
    throw fail("Couldn't count your team.", countError);
  }

  // Goes through getTenantPlanRecord rather than reading `subscriptions` here.
  // RLS on that table admits only tenant_admin and billing_admin, so a manager
  // opening this page got no row and saw the Free cap of two seats against a
  // paid workspace's real headcount — which reads as "you are over your limit".
  // `actor.tenantId` comes from the caller's own JWT claims, so the read is
  // still scoped to their workspace.
  const plan = await getTenantPlanRecord(actor.tenantId);

  const limit =
    typeof plan?.seatLimit === "number" ? plan.seatLimit : FREE_SEAT_LIMIT;

  return calcTeamSeats(count ?? 0, limit);
}

/**
 * The server's clock for this render, handed to the table so its relative
 * times ("2 days ago") come out the same on the server and on hydration.
 * Lives here rather than in the page because calling Date.now() in a component
 * body is a render-purity violation.
 */
export const serverNow = cache(async function serverNow(): Promise<number> {
  return Date.now();
});

export async function getCallerRole(): Promise<TeamRole | null> {
  return (await getActorOrNull())?.role ?? null;
}

/**
 * Where the link in an invite email comes back to.
 *
 * An invited person has an account but no password, so landing them on the
 * workspace would only bounce them to a login they cannot complete. They go
 * straight to /{slug}/reset-password to choose one.
 *
 * NOT through /{slug}/auth/callback, which is the obvious-looking choice and
 * the wrong one. An admin-generated invite has no PKCE verifier -- there was no
 * browser to create one -- so Supabase returns the session in the URL FRAGMENT
 * (`#access_token=…&type=invite`) rather than as `?code=`. Fragments are never
 * sent to a server, so that route handler sees no code, calls the link
 * incomplete and bounces the invitee to the login page. The reset-password page
 * reads the fragment client-side, which is the only place it is visible.
 *
 * Passing this at all is the point: with no `redirectTo`, Supabase falls back
 * to the project's Site URL, which is how invite links ended up pointing at the
 * bare origin.
 */
async function inviteRedirectTo(
  slug: string | null,
): Promise<string | undefined> {
  if (!slug) {
    // Better to fall back to the Site URL than to mail a link to `/null/...`.
    console.error(
      "[team] no tenant_slug claim on the inviter; invite link falls back to the Site URL",
    );

    return undefined;
  }

  const origin = await requestOrigin();

  return `${origin}${tenantPath(slug, TENANT_ROUTES.RESET_PASSWORD)}`;
}

/**
 * Mails a brand-new or still-unconfirmed account its invite link. Supabase
 * only accepts this for an address it has never confirmed; a registered one
 * goes through emailWorkspaceLink instead.
 */
async function emailSupabaseInvite(
  admin: SupabaseClient,
  email: string,
  name: string,
  slug: string | null,
) {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: name },
    redirectTo: await inviteRedirectTo(slug),
  });

  if (error) {
    throw fail(
      "We couldn't email that person their invite. Try again.",
      error,
      400,
    );
  }

  return data;
}

/**
 * Mails a workspace link to someone who already has an account.
 *
 * `inviteUserByEmail` only works for an address Supabase has never seen -- it
 * rejects a registered one -- so an existing user used to get no mail at all:
 * the membership was created, the screen said "Invite sent", and nobody ever
 * told them. A magic link is the equivalent for an account that exists.
 *
 * Sent from a throwaway anon client, never the request-bound one. The
 * request-bound client stores a PKCE verifier in the INVITER's cookies, and
 * the invitee's browser has none, so the link would fail for them. This client
 * has no cookie storage, so the session arrives in the URL fragment -- which is
 * what the tenant reset-password page already reads.
 */
async function emailWorkspaceLink(
  email: string,
  slug: string | null,
): Promise<void> {
  const redirectTo = await inviteRedirectTo(slug);

  const mailer = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: "implicit",
      },
    },
  );

  const { error } = await mailer.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });

  if (error) {
    // The membership already exists by the time this runs, so the invite is
    // not undone -- the row stays pending and "Resend invite" retries the mail.
    throw fail("We couldn't email that person their workspace link.", error);
  }
}

/**
 * Roles only a Tenant Admin may hand out. A Manager can invite and edit the
 * team, but inviting a second address of their own as Tenant Admin would be a
 * way to promote themselves.
 */
const ADMIN_ONLY_INVITE_ROLES: readonly TeamRole[] = [
  "Tenant Admin",
  "Billing Admin",
];

export async function inviteMember(values: InviteMemberValues): Promise<void> {
  const actor = await requireActor();

  assertRole(
    actor,
    ["Tenant Admin", "Manager"],
    "Only a Tenant Admin or Manager can invite people.",
  );

  if (
    ADMIN_ONLY_INVITE_ROLES.includes(values.role) &&
    actor.role !== "Tenant Admin"
  ) {
    throw new TeamError(
      `Only a Tenant Admin can invite someone as ${values.role}.`,
      { status: 403, code: "action-not-allowed" },
    );
  }

  const seats = await getTeamSeats();

  if (!hasSeatLeft(seats)) {
    throw seatLimitError(seats);
  }

  const email = values.email.trim().toLowerCase();
  // The invite form collects an email and a role, nothing else, so the
  // account starts out named after the address. They can change it on first
  // sign-in.
  const name = email.split("@")[0] || "Team member";

  const admin = createSupabaseAdminClient();

  // 1. Check whether the user already exists in users table
  const { data: existingUser, error: existingUserError } = await admin
    .from("users")
    .select("id, email, full_name")
    .eq("email", email)
    .maybeSingle();

  if (existingUserError) {
    throw fail(
      "We couldn't check whether that user already exists.",
      existingUserError,
    );
  }

  if (existingUser) {
    // 2. Already on this team?
    const { data: existingMembership, error: existingMembershipError } =
      await admin
        .from("memberships")
        .select("id")
        .eq("tenant_id", actor.tenantId)
        .eq("user_id", existingUser.id)
        .limit(1)
        .maybeSingle();

    if (existingMembershipError) {
      throw fail(
        "We couldn't check whether that person is already on your team.",
        existingMembershipError,
      );
    }

    if (existingMembership) {
      throw new TeamError("That person is already on this team.", {
        status: 409,
        code: "already-member",
      });
    }

    // 3. Stop-gap until sessions can switch workspace. The access-token hook
    // picks one membership per user, active ones first, so someone who
    // already belongs to another workspace always signs in there: this
    // invite would never be accepted and would hold a seat forever.
    const { count: elsewhere, error: elsewhereError } = await admin
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("user_id", existingUser.id)
      .neq("tenant_id", actor.tenantId)
      .neq("status", "disabled");

    if (elsewhereError) {
      throw fail(
        "We couldn't check whether that person belongs to another workspace.",
        elsewhereError,
      );
    }

    if (elsewhere) {
      throw new TeamError(
        "That person already belongs to another workspace and can't join a second one yet.",
        { status: 409, code: "already-member" },
      );
    }
  }

  // An account that exists but was never confirmed can still be invited the
  // normal way, so "already in the users table" is not the test -- only a
  // registered account needs the magic-link path.
  const isRegisteredAccount = await isRegistered(admin, existingUser?.id);

  let authUserId: string;
  let createdAuthUserId: string | null = null;

  if (existingUser) {
    authUserId = existingUser.id;
  } else {
    // 4. New address: create the account WITHOUT mailing it. The invite goes
    // out last, once the membership exists, so a failure in between can't
    // leave someone holding a link to a workspace they were never added to.
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        email_confirm: false,
        user_metadata: { full_name: name },
      });

    if (createError || !created?.user?.id) {
      throw fail(
        "We couldn't create an account for that email. Try again.",
        createError,
        400,
      );
    }

    authUserId = created.user.id;
    createdAuthUserId = created.user.id;
  }

  // Undo the account created above if a later step fails, so a retry starts
  // clean instead of finding a half-made user.
  const rollbackNewUser = async () => {
    if (!createdAuthUserId) return;
    const { error } = await admin.auth.admin.deleteUser(createdAuthUserId);
    if (error) {
      console.error("[team] rollback of new invitee failed:", error.message);
    }
  };

  // 5. Ensure application profile exists
  const { error: profileError } = await admin.from("users").upsert(
    {
      id: authUserId,
      email,
      full_name: existingUser?.full_name || name,
    },
    { onConflict: "id" },
  );

  if (profileError) {
    await rollbackNewUser();
    throw fail("We couldn't create that person's profile.", profileError);
  }

  // 6. Create membership. The seat trigger re-checks the limit under a lock.
  const { error: membershipError } = await admin.from("memberships").insert({
    tenant_id: actor.tenantId,
    user_id: authUserId,
    role: ROLE_TO_DB[values.role],
    status: "invited",
    invited_by: actor.userId,
  });

  if (membershipError) {
    await rollbackNewUser();
    throw fail("We couldn't add them to your team.", membershipError, 409);
  }

  // 7. Mail last, for every path. If this fails the membership stays pending
  // and "Resend invite" retries the mail.
  if (isRegisteredAccount) {
    await emailWorkspaceLink(email, actor.tenantSlug);
  } else {
    await emailSupabaseInvite(admin, email, name, actor.tenantSlug);
  }
}

type InviteRow = {
  id: string;
  status: string;
  user: { email: string | null } | null;
};

/**
 * True once the person has actually signed in and set a password. An invited
 * account exists in auth but stays unconfirmed until then, and Supabase will
 * still re-send an invite to one of those.
 */
async function isRegistered(
  admin: SupabaseClient,
  userId: string | undefined,
): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const { data, error } = await admin.auth.admin.getUserById(userId);

  if (error || !data.user) {
    return false;
  }

  return Boolean(data.user.email_confirmed_at ?? data.user.confirmed_at);
}

export async function resendInvite(values: ResendInviteValues): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor();
  assertRole(
    actor,
    ["Tenant Admin", "Manager"],
    "Only a Tenant Admin or Manager can resend invites.",
  );

  const { data: rawMember, error } = await supabase
    .from("memberships")
    .select("id, status, user:users!memberships_user_id_fkey ( email )")
    .eq("id", values.memberId)
    .maybeSingle<InviteRow>();

  if (error) {
    throw fail("Couldn't find that invitation.", error);
  }

  const member = rawMember;

  if (!member) {
    throw new TeamError("That invitation no longer exists.", {
      status: 404,
      code: "member-not-found",
    });
  }

  if (member.status !== "invited") {
    throw new TeamError("Only a pending invitation can be resent.", {
      status: 409,
      code: "invite-already-sent",
    });
  }

  const email = member.user?.email;

  if (!email) {
    throw new TeamError("That invitation is missing an email.", {
      status: 409,
      code: "member-not-found",
    });
  }

  // Supabase rejects inviteUserByEmail for an address it already knows, so a
  // pending invite whose account exists has to be resent as a magic link. The
  // confirmed_at check is what tells the two apart.
  const admin = createSupabaseAdminClient();

  const { data: authUser } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle<{ id: string }>();

  const hasAccount = await isRegistered(admin, authUser?.id);

  if (hasAccount) {
    await emailWorkspaceLink(email, actor.tenantSlug);
    return;
  }

  await emailSupabaseInvite(
    admin,
    email,
    email.split("@")[0] || "Team member",
    actor.tenantSlug,
  );
}

/**
 * The auth user behind a membership row.
 *
 * `memberId` is a membership id and `actor.userId` is an auth user id, so the
 * two are never equal -- comparing them directly is what let a Tenant Admin
 * demote or delete their own membership through a direct action call.
 */
async function getMemberUserId(
  supabase: SupabaseClient,
  memberId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("id", memberId)
    .maybeSingle();

  if (error) {
    throw fail("We couldn't look that member up.", error);
  }

  return (data?.user_id as string | undefined) ?? null;
}

async function assertNotSelf(
  supabase: SupabaseClient,
  actor: TeamActor,
  memberId: string,
  message: string,
  code: TeamFailureCode,
) {
  const targetUserId = await getMemberUserId(supabase, memberId);

  if (targetUserId === null) {
    throw new TeamError("That member no longer exists.", {
      status: 404,
      code: "member-not-found",
    });
  }

  if (targetUserId === actor.userId) {
    throw new TeamError(message, { status: 409, code });
  }
}

export async function changeMemberRole(
  values: ChangeMemberRoleValues,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor();
  assertRole(actor, ["Tenant Admin"], "Only a Tenant Admin can change roles.");

  await assertNotSelf(
    supabase,
    actor,
    values.memberId,
    "You can't change your own role.",
    "cannot-change-own-role",
  );

  const { data, error } = await supabase
    .from("memberships")
    .update({
      role: ROLE_TO_DB[values.role],
      updated_at: new Date().toISOString(),
    })
    .eq("id", values.memberId)
    // Staff only, like the roster: a portal customer's membership id must not
    // be promotable to Agent through a direct action call.
    .in("role", [...STAFF_ROLES])
    .select("id");

  if (error) {
    throw fail("We couldn't change that person's role.", error);
  }

  if (!data || data.length === 0) {
    throw new TeamError("That member no longer exists.", {
      status: 404,
      code: "member-not-found",
    });
  }
}

export async function changeMemberStatus(
  values: ChangeMemberStatusValues,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor();
  assertRole(
    actor,
    ["Tenant Admin"],
    "Only a Tenant Admin can enable or disable members.",
  );

  await assertNotSelf(
    supabase,
    actor,
    values.memberId,
    "You can't change your own status.",
    "cannot-change-own-role",
  );

  // Disabled members don't hold a seat, so switching one back on takes one.
  // Without this, disable → invite → re-enable walked straight past the plan
  // limit. (The seat trigger enforces the same rule under a lock.)
  if (values.status === "Active") {
    const { data: target, error: targetError } = await supabase
      .from("memberships")
      .select("status")
      .eq("id", values.memberId)
      .maybeSingle<{ status: string }>();

    if (targetError) {
      throw fail("We couldn't look that member up.", targetError);
    }

    if (target?.status === "disabled") {
      const seats = await getTeamSeats();

      if (!hasSeatLeft(seats)) {
        throw seatLimitError(seats);
      }
    }
  }

  const { data, error } = await supabase
    .from("memberships")
    .update({
      status: STATUS_TO_DB[values.status],
      disabled_at:
        values.status === "Disabled" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", values.memberId)
    .in("role", [...STAFF_ROLES])
    .select("id");

  if (error) {
    throw fail("We couldn't update that member.", error);
  }

  if (!data || data.length === 0) {
    throw new TeamError("That member no longer exists.", {
      status: 404,
      code: "member-not-found",
    });
  }
}

export async function removeMember(values: RemoveMemberValues): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor();
  assertRole(
    actor,
    ["Tenant Admin"],
    "Only a Tenant Admin can remove members.",
  );

  await assertNotSelf(
    supabase,
    actor,
    values.memberId,
    "You can't remove yourself.",
    "cannot-remove-self",
  );

  const { data, error } = await supabase
    .from("memberships")
    .delete()
    .eq("id", values.memberId)
    .in("role", [...STAFF_ROLES])
    .select("id");

  if (error) {
    throw fail("We couldn't remove that member.", error);
  }

  if (!data || data.length === 0) {
    throw new TeamError("That member no longer exists.", {
      status: 404,
      code: "member-not-found",
    });
  }
}

export const getTenantPlanRecord = cache(async function getTenantPlanRecord(
  tenantId: string,
): Promise<TenantPlanRecord | null> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select(
      `
    status,
    seats,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    paypal_status,
    payment_status,
    plans!subscriptions_plan_id_fkey (
      name,
      seat_limit,
      features_json
    )
  `,
    )
    .eq("tenant_id", tenantId)
    .in("status", CURRENT_SUBSCRIPTION_STATUSES)
    .order("current_period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[entitlements] plan lookup failed:", error);
    return null;
  }

  if (!data) {
    return null;
  }

  // PostgREST types an embedded to-one as an array or an object depending on
  // the FK shape, so both forms are handled rather than guessed at.
  const plans = data.plans as
    TenantPlanRow | TenantPlanRow[] | null | undefined;

  const plan = Array.isArray(plans) ? plans[0] : plans;

  if (!plan) {
    return null;
  }

  return {
    planName: plan.name ?? "Free",
    seatLimit: typeof plan.seat_limit === "number" ? plan.seat_limit : null,
    seats: typeof data.seats === "number" ? data.seats : null,
    featuresJson: plan.features_json,
  };
});
