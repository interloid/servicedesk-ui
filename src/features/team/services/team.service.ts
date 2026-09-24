import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EmailNotConfiguredError,
  escapeHtml,
  sendEmail,
} from "@/lib/email/send-email";
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
  ADMIN_ONLY_ROLES,
  canEditMemberWithRole,
  CURRENT_SUBSCRIPTION_STATUSES,
  FREE_SEAT_LIMIT,
  getTeamSeats as calcTeamSeats,
  hasSeatLeft,
  roleWithArticle,
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
  updated_at,
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
  updated_at: string | null;
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
        // An invite has no timestamp of its own. A new invite's row is
        // created by it; a re-invite reuses a deactivated row and bumps
        // updated_at, so for a pending invite updated_at is when it went out.
        invitedAt:
          status === "Invited"
            ? (row.updated_at ?? row.created_at)
            : row.created_at,
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
 * Sends the team invitation -- always the "You've been invited" email, never a
 * sign-in email, whatever state the person's auth account is in.
 *
 * Supabase's own invite (`inviteUserByEmail`, which mails the project's
 * "Invite user" template) only works for an address that has never confirmed
 * an account. Anyone who has -- they accepted an earlier invite and were later
 * removed, or they signed up themselves -- gets `email_exists` back. There is
 * no Supabase call that sends the invite template to such an account, so for
 * them we ask Supabase for a sign-in link WITHOUT sending it
 * (`generateLink({ type: "magiclink" })`) and send our own invitation email
 * carrying that link.
 *
 * Both links land on /{slug}/reset-password, which checks the membership is
 * still pending/active before it shows anything (a revoked invite gets
 * "Access removed"). Each link is single-use and expires after the project's
 * OTP expiry.
 */
async function emailTeamInvitation(
  admin: SupabaseClient,
  {
    userId,
    email,
    name,
    role,
    tenantId,
    slug,
  }: {
    userId: string;
    email: string;
    name: string;
    role: TeamRole;
    tenantId: string;
    slug: string | null;
  },
): Promise<void> {
  const redirectTo = await inviteRedirectTo(slug);

  if (!(await isRegistered(admin, userId))) {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name },
      redirectTo,
    });

    if (error) {
      throw fail(
        "We couldn't email that person their invite. Try again.",
        error,
        400,
      );
    }

    return;
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });

  const actionLink = link?.properties?.action_link;

  if (linkError || !actionLink) {
    throw fail(
      "We couldn't create an invitation link for that person. Try again.",
      linkError,
      400,
    );
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle<{ name: string }>();

  const workspace = tenant?.name ?? "your team";

  try {
    await sendEmail({
      to: email,
      subject: `You've been invited to ${workspace}`,
      html: invitationEmailHtml({ workspace, role, link: actionLink }),
      text: `You've been invited to join ${workspace} as ${roleWithArticle(role)}.\n\nAccept the invitation: ${actionLink}\n\nThis link works once and expires in 1 hour. If it has expired, ask your admin to resend the invite.`,
    });
  } catch (error) {
    console.error("[team] invitation email failed:", error);
    throw new TeamError(
      error instanceof EmailNotConfiguredError
        ? "Invitation email isn't set up for existing accounts yet. Ask your administrator to configure it."
        : "We couldn't email that person their invite. Try again.",
      { status: 502, code: "unknown" },
    );
  }
}

function invitationEmailHtml({
  workspace,
  role,
  link,
}: {
  workspace: string;
  role: TeamRole;
  link: string;
}): string {
  const safeWorkspace = escapeHtml(workspace);
  const safeRole = escapeHtml(roleWithArticle(role));
  const safeLink = escapeHtml(link);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're Invited</title>
</head>

<body
  style="
    margin: 0;
    padding: 0;
    background-color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
  "
>
  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="
      background-color: #f8fafc;
      padding: 40px 16px;
    "
  >
    <tr>
      <td align="center">

        <!-- Main Card -->
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            max-width: 520px;
            background-color: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            overflow: hidden;
          "
        >

          <!-- Header -->
          <tr>
            <td
              style="
                padding: 32px 32px 24px;
                text-align: center;
              "
            >
              <!-- Logo -->
              <div
                style="
                  width: 40px;
                  height: 40px;
                  line-height: 40px;
                  margin: 0 auto 14px;
                  background-color: #0f766e;
                  color: #ffffff;
                  border-radius: 10px;
                  font-size: 18px;
                  font-weight: 800;
                  text-align: center;
                "
              >
                S
              </div>

              <!-- Brand -->
              <div
                style="
                  font-size: 18px;
                  line-height: 24px;
                  font-weight: 700;
                  color: #0f172a;
                "
              >
                ServiceDesk Pro
              </div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td
              style="
                padding: 8px 40px 40px;
                text-align: center;
              "
            >

              <!-- Heading -->
              <h1
                style="
                  margin: 0 0 16px;
                  font-size: 26px;
                  line-height: 34px;
                  font-weight: 700;
                  color: #0f172a;
                "
              >
                You're Invited
              </h1>

              <!-- Description -->
              <p
                style="
                  margin: 0 0 16px;
                  font-size: 15px;
                  line-height: 24px;
                  color: #475569;
                "
              >
                You've been invited to join
                <strong>${safeWorkspace}</strong>
                as ${safeRole}.
              </p>

              <p
                style="
                  margin: 0 0 28px;
                  font-size: 15px;
                  line-height: 24px;
                  color: #64748b;
                "
              >
                Accept your invitation below to create your account
                and get started with your workspace.
              </p>

              <!-- Accept Invitation Button -->
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
              >
                <tr>
                  <td align="center">
                    <a
                      href="${safeLink}"
                      style="
                        display: inline-block;
                        padding: 13px 28px;
                        background-color: #0f766e;
                        color: #ffffff;
                        text-decoration: none;
                        font-size: 14px;
                        font-weight: 600;
                        line-height: 20px;
                        border-radius: 8px;
                        border: 1px solid #0f766e;
                      "
                    >
                      Accept invitation
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Spacer -->
              <div style="height: 28px;"></div>

              <!-- Security Note -->
              <div
                style="
                  padding: 14px 16px;
                  background-color: #f0fdfa;
                  border: 1px solid #ccfbf1;
                  border-radius: 8px;
                  text-align: left;
                "
              >
                <p
                  style="
                    margin: 0;
                    font-size: 12px;
                    line-height: 19px;
                    color: #475569;
                  "
                >
                  If you weren't expecting this invitation,
                  you can safely ignore this email.
                </p>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td
              style="
                padding: 20px 32px;
                border-top: 1px solid #f1f5f9;
                text-align: center;
              "
            >
              <p
                style="
                  margin: 0;
                  font-size: 12px;
                  line-height: 18px;
                  color: #94a3b8;
                "
              >
                © 2026 ServiceDesk Pro. All rights reserved.
              </p>

              <p
                style="
                  margin: 6px 0 0;
                  font-size: 12px;
                  line-height: 18px;
                  color: #94a3b8;
                "
              >
                This is an automated email. Please don't reply.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function inviteMember(values: InviteMemberValues): Promise<void> {
  const actor = await requireActor();

  assertRole(
    actor,
    ["Tenant Admin", "Manager"],
    "Only a Tenant Admin or Manager can invite people.",
  );

  if (ADMIN_ONLY_ROLES.includes(values.role) && actor.role !== "Tenant Admin") {
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

  // A deactivated member of THIS team is re-invited by reusing their row
  // (tenant_id + user_id is one membership), not by inserting a duplicate.
  let reusableMembershipId: string | null = null;

  if (existingUser) {
    // 2. Already on this team?
    const { data: existingMembership, error: existingMembershipError } =
      await admin
        .from("memberships")
        .select("id, status")
        .eq("tenant_id", actor.tenantId)
        .eq("user_id", existingUser.id)
        .limit(1)
        .maybeSingle<{ id: string; status: string }>();

    if (existingMembershipError) {
      throw fail(
        "We couldn't check whether that person is already on your team.",
        existingMembershipError,
      );
    }

    if (existingMembership?.status === "invited") {
      throw new TeamError(
        "That person already has a pending invitation. Use Resend invite to send it again.",
        { status: 409, code: "invite-already-sent" },
      );
    }

    if (existingMembership?.status === "disabled") {
      reusableMembershipId = existingMembership.id;
    } else if (existingMembership) {
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

  // 6. Membership back to `invited` -- reusing a deactivated row, or a new
  // one. Either way the seat trigger re-checks the limit under a lock.
  if (reusableMembershipId) {
    const { data: reused, error: reuseError } = await admin
      .from("memberships")
      .update({
        role: ROLE_TO_DB[values.role],
        status: "invited",
        invited_by: actor.userId,
        disabled_at: null,
        // Joined afresh when they accept; the hook stamps it then.
        joined_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reusableMembershipId)
      // Only if it is still the deactivated row we read above.
      .eq("status", "disabled")
      .select("id");

    if (reuseError) {
      throw fail("We couldn't add them to your team.", reuseError, 409);
    }

    if (!reused || reused.length === 0) {
      throw new TeamError(
        "That person's membership changed while you were inviting them. Refresh and try again.",
        { status: 409, code: "already-member" },
      );
    }
  } else {
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
  }

  // 7. Mail last: always the team invitation, never a sign-in email. If this
  // fails the membership stays pending and "Resend invite" retries the mail.
  await emailTeamInvitation(admin, {
    userId: authUserId,
    email,
    name,
    role: values.role,
    tenantId: actor.tenantId,
    slug: actor.tenantSlug,
  });
}

type InviteRow = {
  id: string;
  role: string;
  status: string;
  user_id: string;
  user: { email: string | null; full_name: string | null } | null;
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
    .select(
      "id, role, status, user_id, user:users!memberships_user_id_fkey ( email, full_name )",
    )
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

  // Same email as the first invite: the team invitation, never a sign-in link.
  await emailTeamInvitation(createSupabaseAdminClient(), {
    userId: member.user_id,
    email,
    name: member.user?.full_name || email.split("@")[0] || "Team member",
    role: ROLE_FROM_DB[member.role] ?? "Agent",
    tenantId: actor.tenantId,
    slug: actor.tenantSlug,
  });
}

/**
 * The staff membership a team action is aimed at, read through the caller's
 * own client so RLS keeps it inside their tenant. Also refuses actions on
 * yourself and, for a Manager, on anyone holding an admin role -- a Manager
 * has the admin's team powers over Agents and Managers, but must not be able
 * to demote, disable or remove the admins above them.
 *
 * RLS lets only a Tenant Admin write memberships, so every write that follows this check goes through the admin
 * client, pinned to the tenant and to the role read here.
 */
async function getEditableMember(
  supabase: SupabaseClient,
  actor: TeamActor,
  memberId: string,
  selfMessage: string,
  selfCode: TeamFailureCode,
): Promise<{ userId: string; role: TeamRole }> {
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("id", memberId)
    .eq("tenant_id", actor.tenantId)
    .in("role", [...STAFF_ROLES])
    .maybeSingle<{ user_id: string; role: string }>();

  if (error) {
    throw fail("We couldn't look that member up.", error);
  }

  const role = data ? ROLE_FROM_DB[data.role] : undefined;

  if (!data || !role) {
    throw new TeamError("That member no longer exists.", {
      status: 404,
      code: "member-not-found",
    });
  }

  // Compare user ids: `memberId` is a membership id and never equals
  // `actor.userId`, which is what once let an admin demote or delete their
  // own membership through a direct action call.
  if (data.user_id === actor.userId) {
    throw new TeamError(selfMessage, { status: 409, code: selfCode });
  }

  if (!canEditMemberWithRole(actor.role, role)) {
    throw new TeamError(
      `Only a Tenant Admin can manage ${roleWithArticle(role)}.`,
      {
        status: 403,
        code: "action-not-allowed",
      },
    );
  }

  return { userId: data.user_id, role };
}

export async function changeMemberRole(
  values: ChangeMemberRoleValues,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor();
  assertRole(
    actor,
    ["Tenant Admin", "Manager"],
    "Only a Tenant Admin or Manager can change roles.",
  );

  if (ADMIN_ONLY_ROLES.includes(values.role) && actor.role !== "Tenant Admin") {
    throw new TeamError(
      `Only a Tenant Admin can make someone ${roleWithArticle(values.role)}.`,
      { status: 403, code: "action-not-allowed" },
    );
  }

  const target = await getEditableMember(
    supabase,
    actor,
    values.memberId,
    "You can't change your own role.",
    "cannot-change-own-role",
  );

  // RLS lets only a Tenant Admin write memberships, so the Manager's change --
  // checked above -- is written with the admin client. Pinned to the tenant
  // and to the role we just read, so a row that changed in between (say an
  // admin promoted them meanwhile) is left alone rather than overwritten.
  const { data, error } = await createSupabaseAdminClient()
    .from("memberships")
    .update({
      role: ROLE_TO_DB[values.role],
      updated_at: new Date().toISOString(),
    })
    .eq("id", values.memberId)
    .eq("tenant_id", actor.tenantId)
    .eq("role", ROLE_TO_DB[target.role])
    .select("id");

  if (error) {
    throw fail("We couldn't change that person's role.", error);
  }

  if (!data || data.length === 0) {
    throw new TeamError(
      "That person's role changed while you were editing it. Refresh and try again.",
      { status: 409, code: "member-not-found" },
    );
  }
}

export async function changeMemberStatus(
  values: ChangeMemberStatusValues,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireActor();
  assertRole(
    actor,
    ["Tenant Admin", "Manager"],
    "Only a Tenant Admin or Manager can enable or disable members.",
  );

  const target = await getEditableMember(
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
    const { data: current, error: currentError } = await supabase
      .from("memberships")
      .select("status")
      .eq("id", values.memberId)
      .maybeSingle<{ status: string }>();

    if (currentError) {
      throw fail("We couldn't look that member up.", currentError);
    }

    if (current?.status === "disabled") {
      const seats = await getTeamSeats();

      if (!hasSeatLeft(seats)) {
        throw seatLimitError(seats);
      }
    }
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("memberships")
    .update({
      status: STATUS_TO_DB[values.status],
      disabled_at:
        values.status === "Disabled" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", values.memberId)
    .eq("tenant_id", actor.tenantId)
    .eq("role", ROLE_TO_DB[target.role])
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
    ["Tenant Admin", "Manager"],
    "Only a Tenant Admin or Manager can remove members.",
  );

  const target = await getEditableMember(
    supabase,
    actor,
    values.memberId,
    "You can't remove yourself.",
    "cannot-remove-self",
  );

  const { data, error } = await createSupabaseAdminClient()
    .from("memberships")
    .delete()
    .eq("id", values.memberId)
    .eq("tenant_id", actor.tenantId)
    .eq("role", ROLE_TO_DB[target.role])
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
