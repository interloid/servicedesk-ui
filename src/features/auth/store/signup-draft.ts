"use client";

import { DEFAULT_TIMEZONE_ID } from "@/features/auth/lib/timezones";

/**
 * The signup wizard's in-progress values, held client-side across three routes.
 *
 * Nothing is written to the database until "Finish setup" on /onboarding, so /signup and
 * /create-org have nowhere to put their answers. React state can't carry them: the routes
 * are separate pages with no shared layout, so each one unmounts on navigation.
 *
 * `sessionStorage`, not `localStorage`: the draft dies with the tab, which is the lifetime a
 * half-finished signup should have. It survives a refresh and a Back/Forward, which is the
 * whole point — losing everything on F5 mid-wizard is the failure mode this prevents.
 *
 * ── SECURITY NOTE ─────────────────────────────────────────────────────────────────────
 * This includes the user's chosen PASSWORD, in plaintext, in browser storage, for as long
 * as the wizard is open. That is inherent to submitting every step in one call at the end:
 * the password is collected at step 1 and not spent until step 4. It is same-origin and
 * tab-scoped, but any XSS on these routes can read it.
 *
 * The alternative is calling `signUp` at step 1 and provisioning the org later — then the
 * password is spent immediately and never stored. If that trade matters more than the
 * all-or-nothing write, that's the change to make.
 * ──────────────────────────────────────────────────────────────────────────────────────
 */

const STORAGE_KEY = "sdp.signup.draft";

/** Step 3 defaults — the same Mon–Fri week the business-hours step starts from. */
const DEFAULT_WORKING_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** Step 4 default — the placeholder invite the onboarding wizard pre-fills. */
const SEED_INVITE_EMAILS = "priya@northwind.io";

export type SignupDraft = {
  /** Step 1 — /signup. */
  fullName: string;
  email: string;
  password: string;

  /** Step 2 — /create-org. */
  organizationName: string;
  portalSlug: string;

  /** Steps 3–4 — /onboarding. `timezoneId` is a design id ("ist"), not a `timezones.id`. */
  timezoneId: string;
  workingDays: string[];
  dayStart: string;
  dayEnd: string;
  inviteEmails: string;
  inviteRole: string;
};

export const EMPTY_DRAFT: SignupDraft = {
  fullName: "",
  email: "",
  password: "",
  organizationName: "",
  portalSlug: "",
  timezoneId: DEFAULT_TIMEZONE_ID,
  workingDays: DEFAULT_WORKING_DAYS,
  dayStart: "09:00",
  dayEnd: "18:30",
  inviteEmails: SEED_INVITE_EMAILS,
  inviteRole: "Agent",
};


export function readSignupDraft(): SignupDraft {
  
  if (typeof window === "undefined") {
    return EMPTY_DRAFT;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;
    return { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<SignupDraft>) };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function patchSignupDraft(patch: Partial<SignupDraft>): SignupDraft {
  const next = { ...readSignupDraft(), ...patch };

  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
    }
  }

  return next;
}

export function clearSignupDraft(): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
  }
}
