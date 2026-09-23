import type { SupabaseClient } from "@supabase/supabase-js";

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
} from "@/features/team/team";
import {
  getTeamSeats as calcTeamSeats,
  CURRENT_SUBSCRIPTION_STATUSES,
  FREE_SEAT_LIMIT,
  hasSeatLeft,
  STAFF_ROLES,
  TEAM_ROLE_ORDER,
} from "@/features/team/team";

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

function toFailureCode(pgCode: string | undefined): TeamFailureCode {
  switch (pgCode) {
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

  return new TeamError(userMessage, {
    status,
    code: toFailureCode(error?.code),
  });
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

async function getActorOrNull(
  supabase: SupabaseClient,
): Promise<TeamActor | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = claims?.claims?.tenant_id as string | undefined;
  const tenantRole = claims?.claims?.tenant_role as string | undefined;
  const tenantSlug = claims?.claims?.tenant_slug as string | undefined;

  if (!tenantId) {
    return null;
  }

  return {
    userId: user.id,
    tenantId,
    tenantSlug: tenantSlug ?? null,
    role: (tenantRole && ROLE_FROM_DB[tenantRole]) || null,
  };
}

async function requireActor(supabase: SupabaseClient): Promise<TeamActor> {
  const actor = await getActorOrNull(supabase);

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
  const currentUserId = (await getActorOrNull(supabase))?.userId ?? null;

  // Staff only. Portal customers are members of the tenant but they are not
  // the team, and they must never appear on a screen that can disable an
  // account or change a role.
  const { data, error } = await supabase
    .from("memberships")
    .select(MEMBER_SELECT)
    .in("role", [...STAFF_ROLES]);

  if (error) {
    throw fail("Couldn't load the team.", error);
  }

  return ((data as unknown as MemberRow[] | null) ?? [])
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
      const roleOrder =
        TEAM_ROLE_ORDER[a.role] - TEAM_ROLE_ORDER[b.role] ||
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.name.localeCompare(b.name);
      return roleOrder;
    });
}

const STATUS_ORDER: Record<TeamStatus, number> = {
  Active: 0,
  Invited: 1,
  Disabled: 2,
};

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
  const actor = await getActorOrNull(supabase);

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

export async function getCallerRole(): Promise<TeamRole | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  const { data: claims } = await supabase.auth.getClaims();
  const tenantRole = claims?.claims?.tenant_role as string | undefined;

  return (tenantRole && ROLE_FROM_DB[tenantRole]) || null;
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

export async function inviteMember(
  values: InviteMemberValues,
): Promise<TeamMember> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);

  assertRole(
    actor,
    ["Tenant Admin", "Manager"],
    "Only a Tenant Admin or Manager can invite people.",
  );

  const seats = await getTeamSeats();

  if (!hasSeatLeft(seats)) {
    throw new TeamError(
      `Your plan includes ${seats.limit} seat${
        seats.limit === 1 ? "" : "s"
      } and all ${seats.limit} are in use. Remove or disable someone, or upgrade to add more.`,
      { status: 409, code: "seat-limit-reached" },
    );
  }

  const email = values.email.trim().toLowerCase();
  const name = values.fullName?.trim() || email.split("@")[0] || "Team member";

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

  let authUserId: string;
  let isExistingUser = false;

  // 2. Existing user
  if (existingUser) {
    authUserId = existingUser.id;
    isExistingUser = true;
  } else {
    // 3. New user → Supabase invitation
    const { data: invited, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: name },
        redirectTo: await inviteRedirectTo(actor.tenantSlug),
      });

    if (inviteError || !invited?.user?.id) {
      throw fail(
        "We couldn't create an account for that email. Try again.",
        inviteError,
        400,
      );
    }

    authUserId = invited.user.id;
  }

  // 4. Check membership for THIS tenant
  const { data: existingMembership, error: existingMembershipError } =
    await admin
      .from("memberships")
      .select("id, user_id, status")
      .eq("tenant_id", actor.tenantId)
      .eq("user_id", authUserId)
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
    throw fail("We couldn't create that person's profile.", profileError);
  }

  // 6. Create membership
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .insert({
      tenant_id: actor.tenantId,
      user_id: authUserId,
      role: ROLE_TO_DB[values.role],
      status: "invited",
      invited_by: actor.userId,
    })
    .select(
      `
      id,
      role,
      status,
      invited_by,
      joined_at,
      created_at,
      user:users!memberships_user_id_fkey (
        id,
        email,
        full_name,
        avatar_url
      )
    `,
    )
    .single();

  if (membershipError) {
    throw fail("We couldn't add them to your team.", membershipError, 409);
  }

  // 7. Existing user → custom Resend email

  const row = membership as unknown as MemberRow;

  return {
    id: row.id,
    name: row.user?.full_name || name,
    email: row.user?.email || email,
    avatarUrl: row.user?.avatar_url ?? null,
    role: ROLE_FROM_DB[row.role] ?? "Agent",
    status: "Invited",
    isSelf: false,
    joinedAt: null,
    invitedAt: row.created_at,
    disabledAt: null,
    invitedBy: actor.userId,
  };
}

export async function resendInvite(values: ResendInviteValues): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);
  assertRole(
    actor,
    ["Tenant Admin", "Manager"],
    "Only a Tenant Admin or Manager can resend invites.",
  );

  const { data: rawMember, error } = await supabase
    .from("memberships")
    .select("id, status, user:users!memberships_user_id_fkey ( email )")
    .eq("id", values.memberId)
    .maybeSingle();

  if (error) {
    throw fail("Couldn't find that invitation.", error);
  }

  const member = rawMember as unknown as {
    id: string;
    status: string;
    user: { email: string | null } | null;
  } | null;

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

  const admin = createSupabaseAdminClient();
  const email = member.user?.email;

  if (!email) {
    throw new TeamError("That invitation is missing an email.", {
      status: 409,
      code: "member-not-found",
    });
  }

  const { error: sendError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: await inviteRedirectTo(actor.tenantSlug),
  });
  console.log("🚀 ~ resendInvite ~ sendError:", sendError);

  if (sendError) {
    throw fail("We couldn't resend the invite.", sendError);
  }
}

export async function changeMemberRole(
  values: ChangeMemberRoleValues,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor(supabase);
  assertRole(actor, ["Tenant Admin"], "Only a Tenant Admin can change roles.");

  if (values.memberId === actor.userId) {
    throw new TeamError("You can't change your own role.", {
      status: 409,
      code: "cannot-change-own-role",
    });
  }

  const { data, error } = await supabase
    .from("memberships")
    .update({
      role: ROLE_TO_DB[values.role],
      updated_at: new Date().toISOString(),
    })
    .eq("id", values.memberId)
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
  const actor = await requireActor(supabase);
  assertRole(
    actor,
    ["Tenant Admin"],
    "Only a Tenant Admin can enable or disable members.",
  );

  if (values.memberId === actor.userId) {
    throw new TeamError("You can't change your own status.", {
      status: 409,
      code: "cannot-change-own-role",
    });
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
  const actor = await requireActor(supabase);
  assertRole(
    actor,
    ["Tenant Admin"],
    "Only a Tenant Admin can remove members.",
  );

  if (values.memberId === actor.userId) {
    throw new TeamError("You can't remove yourself.", {
      status: 409,
      code: "cannot-remove-self",
    });
  }

  const { data, error } = await supabase
    .from("memberships")
    .delete()
    .eq("id", values.memberId)
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
