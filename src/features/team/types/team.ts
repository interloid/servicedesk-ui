import { MembershipRole } from "@/types/team-members";

export const TEAM_ROLE_VALUES = [
  "Tenant Admin",
  "Manager",
  "Agent",
  "Billing Admin",
] as const;

export type TeamRole = (typeof TEAM_ROLE_VALUES)[number];

export const TEAM_ROLE_ORDER: Record<TeamRole, number> = {
  "Tenant Admin": 0,
  Manager: 1,
  Agent: 2,
  "Billing Admin": 3,
};

export const TEAM_ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  "Tenant Admin":
    "Has full control over the workspace, including team management, settings, billing, and subscriptions.",
  Manager:
    "Manages tickets and team members, assigns work, and oversees day-to-day support operations.",
  Agent:
    "Handles assigned tickets, communicates with customers, and works on resolving support requests.",
  "Billing Admin":
    "Manages billing, subscriptions, invoices, payment methods, and plan-related changes.",
};

/**
 * The one-liner that sits under a role in a table row. Deliberately shorter
 * than TEAM_ROLE_DESCRIPTIONS, which has room to breathe inside a dialog --
 * the row version has to survive next to a select at narrow widths.
 */
export const TEAM_ROLE_SUMMARIES: Record<TeamRole, string> = {
  "Tenant Admin": "Full workspace access",
  Manager: "Manages tickets and team",
  Agent: "Handles assigned tickets",
  "Billing Admin": "Manages billing and invoices",
};

/** "a Manager", "an Agent" -- for sentences like "Priya is now an Agent." */
export function roleWithArticle(role: TeamRole): string {
  return `${/^[AEIOU]/.test(role) ? "an" : "a"} ${role}`;
}

export const TEAM_PERMISSION_AREAS = [
  "tickets",
  "billing",
  "team",
  "settings",
] as const;

export type TeamPermissionArea = (typeof TEAM_PERMISSION_AREAS)[number];

export const TEAM_PERMISSION_AREA_LABELS: Record<TeamPermissionArea, string> = {
  tickets: "Tickets",
  billing: "Billing",
  team: "Team",
  settings: "Settings",
};

export const TEAM_PERMISSION_MATRIX: Record<
  TeamRole,
  Record<TeamPermissionArea, string>
> = {
  "Tenant Admin": {
    tickets: "Full",
    billing: "Full",
    team: "Full",
    settings: "Full",
  },
  Manager: {
    tickets: "Full",
    billing: "None",
    // Everything a Tenant Admin can do to the team, except touch the admins.
    team: "Full",
    settings: "Edit",
  },
  Agent: {
    tickets: "Own queue",
    billing: "None",
    team: "None",
    settings: "None",
  },
  "Billing Admin": {
    tickets: "None",
    billing: "Full",
    team: "None",
    settings: "None",
  },
};

export type TeamActionKey =
  "invite" | "resend" | "revoke" | "role" | "status" | "remove";

export type TeamFailureCode =
  | "member-not-found"
  | "action-not-allowed"
  | "already-member"
  | "invite-already-sent"
  | "seat-limit-reached"
  | "cannot-change-own-role"
  | "cannot-remove-self"
  | "email-required"
  | "validation"
  | "unknown";

export const TEAM_ACTION_PERMISSIONS: Record<
  TeamActionKey,
  { rowRole: string; writeRoles: TeamRole[] }
> = {
  invite: { rowRole: "All", writeRoles: ["Tenant Admin", "Manager"] },
  resend: { rowRole: "All", writeRoles: ["Tenant Admin", "Manager"] },
  revoke: { rowRole: "All", writeRoles: ["Tenant Admin", "Manager"] },
  role: { rowRole: "All", writeRoles: ["Tenant Admin", "Manager"] },
  status: { rowRole: "All", writeRoles: ["Tenant Admin", "Manager"] },
  remove: { rowRole: "All", writeRoles: ["Tenant Admin", "Manager"] },
};

export function canPerformTeamAction(
  action: TeamActionKey,
  role: TeamRole,
): boolean {
  return TEAM_ACTION_PERMISSIONS[action].writeRoles.includes(role);
}

/**
 * Roles only a Tenant Admin may hand out or touch. A Manager can invite and
 * edit the team, but granting Tenant Admin or Billing Admin -- to someone else
 * or to a second address of their own -- would be a way to promote
 * themselves, and editing an admin would let them demote the people above
 * them.
 */
export const ADMIN_ONLY_ROLES: readonly TeamRole[] = [
  "Tenant Admin",
  "Billing Admin",
];

/** The roles `caller` may give someone, by invite or by a role change. */
export function assignableRoles(caller: TeamRole | null): TeamRole[] {
  if (caller === "Tenant Admin") {
    return [...TEAM_ROLE_VALUES];
  }

  return TEAM_ROLE_VALUES.filter((role) => !ADMIN_ONLY_ROLES.includes(role));
}

/**
 * Whether `caller` may change the role or status of, or remove, someone who
 * holds `target`.
 * The action itself must also be allowed for the caller's role.
 */
export function canEditMemberWithRole(
  caller: TeamRole | null,
  target: TeamRole,
): boolean {
  if (caller === "Tenant Admin") {
    return true;
  }

  return caller === "Manager" && !ADMIN_ONLY_ROLES.includes(target);
}

export const TEAM_STATUS_VALUES = ["Active", "Invited", "Disabled"] as const;

export type TeamStatus = (typeof TEAM_STATUS_VALUES)[number];

export const TEAM_STATUS_ORDER: Record<TeamStatus, number> = {
  Active: 0,
  Invited: 1,
  Disabled: 2,
};

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: TeamRole;
  status: TeamStatus;
  isSelf: boolean;
  joinedAt: string | null;
  /** When the invitation was created. Drives "Invited 2 days ago". */
  invitedAt: string | null;
  /** When access was switched off. Drives "Deactivated 3 days ago". */
  disabledAt: string | null;
  invitedBy: string | null;
  /**
   * The Tenant Admin who created the workspace: a Tenant Admin membership
   * nobody invited. Nobody else can change, disable or remove them.
   */
  isOwner: boolean;
}

export interface TeamSeats {
  used: number;
  limit: number;
  seatsLeft: number;
}

export function getTeamSeats(used: number, limit: number): TeamSeats {
  return {
    used,
    limit,
    seatsLeft: limit > 0 ? Math.max(0, limit - used) : 0,
  };
}

export function hasSeatLeft(seats: TeamSeats): boolean {
  return seats.limit === 0 || seats.seatsLeft > 0;
}

export interface TeamActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  failureCode?: TeamFailureCode;
  message?: string;
}

export type TeamStatusCounts = Record<TeamStatus, number>;

export function countByStatus(members: TeamMember[]): TeamStatusCounts {
  const counts: TeamStatusCounts = { Active: 0, Invited: 0, Disabled: 0 };

  for (const member of members) {
    counts[member.status] += 1;
  }

  return counts;
}

/**
 * "12 Mar 2026" for the Joined column.
 *
 * Pinned to en-GB and UTC on purpose: the table is server-rendered and then
 * hydrated, and a locale- or zone-dependent string would differ between the
 * two and trip a hydration mismatch.
 */
export function formatAbsoluteDate(iso: string | null): string | null {
  if (!iso) {
    return null;
  }

  const parsed = Date.parse(iso);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/**
 * "2 days ago" for the timestamps under a status badge.
 *
 * Rounds to whole units and stops at minutes, so the server render and the
 * client hydration agree: anything finer would tick over between the two and
 * React would report a text mismatch on a screen nobody was interacting with.
 */
export function formatRelativeTime(
  iso: string | null,
  now: number = Date.now(),
): string | null {
  if (!iso) {
    return null;
  }

  const then = Date.parse(iso);

  if (Number.isNaN(then)) {
    return null;
  }

  const elapsed = now - then;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= size) {
      return formatter.format(-Math.round(elapsed / size), unit);
    }
  }

  return "just now";
}

export type TenantPlanRow = {
  name?: string | null;
  seat_limit?: number | null;
  features_json?: Record<string, unknown>;
};
export type TenantPlanRecord = {
  planName: string;
  seatLimit: number | null;
  /** Seats bought on the subscription, which can differ from the plan's cap. */
  seats: number | null;
  featuresJson: Record<string, unknown> | undefined;
};

export const FREE_SEAT_LIMIT = 2;

export const CURRENT_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;

/**
 * The roles that make up a workspace's team: shown on the roster, counted as
 * seats, and editable from the Team page. `platform_admin` is deliberately
 * left out -- it is our account, not the customer's, so it must not use one of
 * their seats or be demotable/removable by their Tenant Admin (it used to show
 * up labelled "Agent"). The seat trigger in the database uses the same list.
 */
export const STAFF_ROLES = [
  "tenant_admin",
  "manager",
  "agent",
  "billing_admin",
] as const satisfies readonly MembershipRole[];
