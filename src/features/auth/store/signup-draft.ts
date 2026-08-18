"use client";

import { DEFAULT_TIMEZONE_ID } from "@/features/auth/lib/timezones";

const STORAGE_KEY = "sdp.signup.draft";

const DEFAULT_WORKING_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const SEED_INVITE_EMAILS = "priya@northwind.io";

export type SignupDraft = {
  fullName: string;
  email: string;
  password: string;
  organizationName: string;
  portalSlug: string;
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
    } catch {}
  }

  return next;
}

export function clearSignupDraft(): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}
