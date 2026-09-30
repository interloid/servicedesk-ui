import { tenantPath } from "@/lib/tenancy";

/**
 * Paths are relative to the tenant prefix, the same way TENANT_ROUTES is.
 * The portal sits under /{slug}/portal/* so it never collides with the agent
 * app's /{slug}/login and /{slug}/tickets.
 */
export const PORTAL_ROUTES = {
  ROOT: "/portal",
  LOGIN: "/portal/login",
  CHECK_EMAIL: "/portal/check-email",
  PASSWORD: "/portal/password",
  WELCOME: "/portal/welcome",
  REQUESTS: "/portal/requests",
  NEW_REQUEST: "/portal/requests/new",
  HELP: "/portal/help",
  AUTH_CALLBACK: "/portal/auth/callback",
} as const;

/** A single request's thread. */
export function portalRequestPath(slug: string, requestId: string): string {
  return tenantPath(slug, `${PORTAL_ROUTES.REQUESTS}/${requestId}`);
}

export function portalPath(
  slug: string,
  path: string = PORTAL_ROUTES.REQUESTS,
): string {
  return tenantPath(slug, path);
}

/** Mirrors supabase/schemas/storage/buckets.sql. Private; read through signed URLs. */
export const ATTACHMENT_BUCKET = "ticket-attachments";

/**
 * Public bucket, shared with the team app. Every photo is written under
 * `<tenant id>/<user id>/`, which is what the storage policies key on.
 */
export const AVATAR_BUCKET = "avatars";

/** Mirrors the avatars bucket limit in supabase/schemas/storage/buckets.sql. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const AVATAR_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/** Why a picked profile photo can't be used, or null when it can. */
export function avatarError(file: {
  size: number;
  type: string;
}): string | null {
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Choose a JPG, PNG, GIF or WebP image.";
  }

  if (file.size > MAX_AVATAR_BYTES) {
    return "That image is over 5 MB. Choose a smaller one.";
  }

  return null;
}

/** Mirrors the storage bucket limit in supabase/schemas/storage/buckets.sql. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * Per message, not per request. Enforced on the server as well -- the client
 * limit is a courtesy, the server one is the rule.
 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/**
 * What the browser needs to send one file straight to Supabase Storage.
 *
 * The bytes never pass through the Next server: Server Action bodies are capped
 * (1 MB by default, and 4.5 MB by the hosting platform whatever the config
 * says), which no attachment limit worth offering fits inside. The server's job
 * is to authorise a path and record what landed on it.
 */
export type PortalUploadTarget = {
  /** `<tenant_id>/<ticket_id>/<random>.<ext>` — what the storage policies match. */
  path: string;
  /** Single-use, from createSignedUploadUrl. */
  token: string;
  name: string;
  size: number;
  mime: string;
};

/** What the client reports back once the bytes are in the bucket. */
export type PortalUploadedFile = {
  path: string;
  name: string;
  size: number;
  mime: string;
};

export type PortalAttachment = {
  id: string;
  /** What the customer called it, not the randomised name in the bucket. */
  name: string;
  size: number;
  mime: string;
  /** Signed, short-lived. Null when the URL could not be minted. */
  url: string | null;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;

  const mb = kb / 1024;

  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * Rejects what the customer should not be sending before it costs an upload.
 * Type is deliberately NOT restricted: support tickets carry logs, archives
 * and whatever the customer's machine produced, and a mime allowlist here
 * turns "I can't send you the file" into a support ticket of its own. The
 * bucket is private and nothing is ever served as active content.
 */
export function attachmentError(file: {
  name: string;
  size: number;
}): string | null {
  if (file.size === 0) {
    return `${file.name} is empty.`;
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(
      MAX_ATTACHMENT_BYTES,
    )}.`;
  }

  return null;
}

export type PortalTenant = {
  id: string;
  name: string;
  slug: string;
  initial: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  textColor: string | null;
  backgroundColor: string | null;
  logoUrl: string | null;
};

/** What the portal footer says about when the team is around. */
export type PortalSupportHours = {
  /** "Mon–Fri, 09:00–18:30 IST", or null when no calendar is set up. */
  hours: string | null;
  /** "15 minutes" -- the urgent first-response promise, when there is one. */
  urgentTarget: string | null;
};

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * Turns a business_hours row into one readable line.
 *
 * `schedule_json` is what onboarding writes: `{ working_days: ["Mon", …],
 * day_start: "09:00", day_end: "18:30" }`. Anything else -- a hand-edited row,
 * a future per-day shape -- returns null so the footer drops the line rather
 * than printing half a schedule.
 */
export function describeBusinessHours(
  schedule: unknown,
  timezone: { code: string; display_name: string } | null,
): string | null {
  if (!schedule || typeof schedule !== "object") {
    return null;
  }

  const { working_days, day_start, day_end } = schedule as Record<
    string,
    unknown
  >;

  if (
    !Array.isArray(working_days) ||
    typeof day_start !== "string" ||
    typeof day_end !== "string"
  ) {
    return null;
  }

  const open = new Set(working_days.map((day) => String(day).slice(0, 3)));
  const days = WEEK.filter((day) => open.has(day));

  if (days.length === 0) {
    return null;
  }

  // Consecutive days collapse into a range: Mon–Fri, or Mon–Wed, Fri.
  const runs: string[] = [];
  let start = 0;

  for (let index = 1; index <= days.length; index += 1) {
    const contiguous =
      index < days.length &&
      WEEK.indexOf(days[index]) === WEEK.indexOf(days[index - 1]) + 1;

    if (!contiguous) {
      const first = days[start];
      const last = days[index - 1];
      runs.push(first === last ? first : `${first}–${last}`);
      start = index;
    }
  }

  const dayLabel = days.length === 7 ? "Every day" : runs.join(", ");

  // The seed's display names end in the abbreviation customers know
  // ("India Standard Time (IST)"); the IANA code is the fallback.
  const zone =
    timezone?.display_name.match(/\(([^)]+)\)\s*$/)?.[1] ?? timezone?.code;

  // Postgres hands `time` back with seconds ("09:00:00"); nobody quotes
  // opening hours that way.
  const hhmm = (value: string) => value.slice(0, 5);

  return `${dayLabel}, ${hhmm(day_start)}–${hhmm(day_end)}${zone ? ` ${zone}` : ""}`;
}

export type PortalCustomer = {
  id: string;
  fullName: string;
  email: string;
  company: string | null;
  initials: string;
  onboarded: boolean;
  /** Public URL of the photo set in Profile settings, or null for initials. */
  avatarUrl: string | null;
};

export type PortalIdentity = {
  tenant: PortalTenant;
  customer: PortalCustomer;
  userId: string;
};

/**
 * Where a sign-in lands. A customer who has not onboarded yet is offered a
 * password first (`password`), and both "Skip for now" and saving
 * one continue to the one-time welcome wizard (`welcome`). Everyone else goes
 * straight to their requests. The password is an offer, never a gate: the
 * portal works on links alone.
 */
export type PortalNextStep = "password" | "welcome" | "requests";

/** Mirrors the `ticket_priority` enum. */
export type PortalPriority = "low" | "normal" | "high" | "urgent";

/**
 * Every request raised from the portal starts here, with status `new`. The
 * customer does not choose: when anyone can pick "Urgent", everyone does, and
 * the team triages the priority instead.
 */
export const PORTAL_REQUEST_PRIORITY: PortalPriority = "low";

export type PortalTicketStatus =
  "new" | "open" | "pending" | "on_hold" | "resolved" | "closed";

/**
 * Customer-facing status vocabulary. The six ticket states are collapsed to the
 * three the portal screens show: a requester does not need to tell 'new' from
 * 'open', but does need to know when the ball is in their court.
 */
export type PortalRequestState = "open" | "waiting_on_you" | "resolved";

export const PORTAL_STATE_LABEL: Record<PortalRequestState, string> = {
  open: "Open",
  waiting_on_you: "Waiting on you",
  resolved: "Resolved",
};

export function toPortalState(status: PortalTicketStatus): PortalRequestState {
  switch (status) {
    case "pending":
    case "on_hold":
      return "waiting_on_you";
    case "resolved":
    case "closed":
      return "resolved";
    default:
      return "open";
  }
}

export type PortalRequest = {
  id: string;
  number: number | null;
  subject: string;
  status: PortalTicketStatus;
  priority: PortalPriority;
  state: PortalRequestState;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

/** A row on the requests list: the request plus a line of its description. */
export type PortalRequestSummary = PortalRequest & {
  /** The start of the description, whitespace collapsed; "" when empty. */
  preview: string;
};

/** How the requests list can be ordered, as carried in `?sort=`. */
export const PORTAL_REQUEST_SORTS = {
  updated: "Last updated",
  newest: "Newest first",
  oldest: "Oldest first",
} as const;

export type PortalRequestSort = keyof typeof PORTAL_REQUEST_SORTS;

export function isPortalRequestSort(value: string): value is PortalRequestSort {
  return Object.hasOwn(PORTAL_REQUEST_SORTS, value);
}

export type PortalMessageAuthor = "agent" | "customer" | "system";

export type PortalMessage = {
  id: string;
  authorType: PortalMessageAuthor;
  authorName: string;
  initials: string;
  body: string;
  createdAt: string;
  /** Written by the customer reading the thread, so it can be styled as theirs. */
  isMine: boolean;
  /**
   * Files hanging off this message. The opening post carries the ones stored
   * against the ticket with no message_id -- see getPortalRequest.
   */
  attachments: PortalAttachment[];
};

export const CSAT_SCORES = [1, 2, 3, 4, 5] as const;

export type CsatScore = (typeof CSAT_SCORES)[number];

export type PortalCsat = {
  /** Null until the customer rates this resolution. */
  score: CsatScore | null;
  comment: string | null;
  /**
   * Whether a rating is owed right now. False once rated, and false again the
   * moment the request is reopened — a new resolution creates a new slot.
   */
  isOwed: boolean;
  /** The resolution being rated. Null when the request is not resolved. */
  resolvedAt: string | null;
};

export type PortalRequestDetail = PortalRequest & {
  description: string;
  messages: PortalMessage[];
  csat: PortalCsat;
};

/** Reopening only makes sense once the team has stopped working on it. */
export function canReopen(state: PortalRequestState): boolean {
  return state === "resolved";
}

export const PORTAL_FAILURE_CODES = [
  "validation",
  "invalid_credentials",
  "expired_link",
  "rate_limited",
  "tenant_not_found",
  "not_signed_in",
  "no_portal_access",
  "not_found",
  "unknown",
] as const;

export type PortalFailureCode = (typeof PORTAL_FAILURE_CODES)[number];

/**
 * Broken out from PortalResult so the shared guard/validation helpers can be
 * typed as "always a failure" and still assign into any PortalResult<T>.
 */
export type PortalFailure = {
  success: false;
  code: PortalFailureCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type PortalResult<TData = undefined> =
  { success: true; data: TData } | PortalFailure;

export function initialsFrom(name: string, email: string): string {
  const source = name.trim() || email.trim();

  const initials = source
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return initials || "?";
}

export function firstNameFrom(name: string, email: string): string {
  const first = name.trim().split(/\s+/)[0];

  return first || email.split("@")[0] || "there";
}
