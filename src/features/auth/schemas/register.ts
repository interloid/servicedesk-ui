import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";
import { MIN_PASSWORD_LENGTH } from "@/features/auth/schemas/signup-account";

/**
 * The whole four-step wizard as one payload, validated server-side before anything is
 * provisioned.
 *
 * The per-step schemas (`signup-account`, `create-org`) guard each screen as the user moves
 * through it; this one guards the single write at the end. It is not a duplicate — it is the
 * only check that runs on data the client assembled from `sessionStorage`, which the user
 * can edit freely.
 */

/** Lowercase alphanumerics and inner hyphens — what a subdomain label allows. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 24-hour HH:MM, matching the onboarding wizard's own `TIME_PATTERN`. */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The design's day labels, from `WORKING_DAYS` in onboarding-data.ts. */
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(1, "Enter your full name"),
    email: emailField("Enter your email address"),
    password: z
      .string()
      .min(
        MIN_PASSWORD_LENGTH,
        `Use at least ${MIN_PASSWORD_LENGTH} characters`,
      ),

    organizationName: z.string().trim().min(1, "Enter an organization name"),
    portalSlug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SLUG_PATTERN, "Use lowercase letters, numbers and hyphens only")
      .optional()
      .or(z.literal("")),

    timezoneId: z.string().min(1, "Pick a timezone"),
    workingDays: z
      .array(z.enum(DAY_LABELS))
      .min(1, "Pick at least one working day"),
    dayStart: z.string().regex(TIME_PATTERN, "Use 24-hour times, like 09:00"),
    dayEnd: z.string().regex(TIME_PATTERN, "Use 24-hour times, like 09:00"),

  
    inviteUsers: z
      .array(
        z.object({
          email: emailField("Enter an email address"),
          role: z.enum(["agent", "manager", "billing_admin"]),
        }),
      )
      .default([]),
  })
  .refine((values) => minutesOf(values.dayEnd) > minutesOf(values.dayStart), {
    path: ["dayEnd"],
    message: "The day has to end after it starts",
  });

export type RegisterValues = z.infer<typeof registerSchema>;
