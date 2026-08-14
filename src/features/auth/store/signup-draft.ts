"use client";

import { DEFAULT_TIMEZONE_ID } from "@/features/auth/lib/timezones";
import {
  DEFAULT_WORKING_DAYS,
  SEED_INVITE_EMAILS,
} from "@/features/onboarding/lib/onboarding-data";

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

/**
 * Read the draft. Returns defaults when absent, and on any parse failure — a corrupt or
 * half-written entry should restart the wizard, not throw inside a render.
 */
export function readSignupDraft(): SignupDraft {
  // Guard for SSR: this module is imported by client components that still render on the
  // server first, where `sessionStorage` doesn't exist.
  if (typeof window === "undefined") {
    return EMPTY_DRAFT;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;

    // Spread over the defaults so a draft written by an older build, missing a key added
    // since, still yields a complete object instead of `undefined` fields.
    return { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<SignupDraft>) };
  } catch {
    return EMPTY_DRAFT;
  }
}

/** Merge a step's values into the draft. */
export function patchSignupDraft(patch: Partial<SignupDraft>): SignupDraft {
  const next = { ...readSignupDraft(), ...patch };

  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private-mode quota or a blocked storage partition. The wizard still works within a
      // single route; only cross-route persistence is lost, which the final step surfaces as
      // a missing-details error rather than a silent half-registration.
    }
  }

  return next;
}

/** Drop the draft — call once registration has succeeded, so the password stops living here. */
export function clearSignupDraft(): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do; the entry expires with the tab regardless.
  }
}
