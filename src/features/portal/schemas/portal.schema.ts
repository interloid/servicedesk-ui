import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";

export const portalEmailSchema = z.object({
  email: emailField("Please enter your email address"),
});

export type PortalEmailValues = z.infer<typeof portalEmailSchema>;

export const portalPasswordLoginSchema = z.object({
  email: emailField("Please enter your email address"),
  password: z.string().min(1, "Please enter your password"),
});

export type PortalPasswordLoginValues = z.infer<
  typeof portalPasswordLoginSchema
>;

/**
 * "At least 10 characters, one number" is the rule the Set a password screen
 * prints under the field. Keep the copy and this schema in step.
 */
export const portalSetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Use at least 8 characters")
      .regex(/\d/, "Include at least one number"),
    confirmPassword: z.string().min(1, "Please Re-enter your password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Both passwords must match",
  });

export type PortalSetPasswordValues = z.infer<typeof portalSetPasswordSchema>;

const subjectField = z
  .string()
  .trim()
  .min(1, "Give your request a subject")
  .max(200, "Keep the subject under 200 characters");

const descriptionField = z
  .string()
  .trim()
  .min(1, "Describe what happened")
  .max(10_000, "That description is too long to submit");

/** A signed-in customer's email comes from their session, never the form. */
export const portalProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(120, "Keep your name under 120 characters."),
  // Optional: many customers raise requests as individuals. Blank clears it.
  company: z
    .string()
    .trim()
    .max(120, "Keep the company name under 120 characters."),
});

export type PortalProfileValues = z.infer<typeof portalProfileSchema>;

export const portalRequestSchema = z.object({
  subject: subjectField,
  description: descriptionField,
});

export type PortalRequestValues = z.infer<typeof portalRequestSchema>;

/**
 * The signed-out path behind "First time here? Submit a request and we'll set
 * one up from your email." The email is the only way to reach them back, so it
 * is required here and validated server-side before any row is written.
 */
export const portalGuestRequestSchema = portalRequestSchema.extend({
  email: emailField("Enter the email we should reply to"),
  fullName: z
    .string()
    .trim()
    .max(120, "That name is too long")
    .optional()
    .or(z.literal("")),
});

export type PortalGuestRequestValues = z.infer<typeof portalGuestRequestSchema>;

export const portalReplySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a reply before sending")
    .max(10_000, "That reply is too long to send"),
});

export type PortalReplyValues = z.infer<typeof portalReplySchema>;

export const portalCsatSchema = z.object({
  score: z.coerce
    .number()
    .int()
    .min(1, "Pick a rating")
    .max(5, "Pick a rating"),
  comment: z
    .string()
    .trim()
    .max(2_000, "That comment is too long to send")
    .optional()
    .or(z.literal("")),
});

export type PortalCsatValues = z.infer<typeof portalCsatSchema>;
