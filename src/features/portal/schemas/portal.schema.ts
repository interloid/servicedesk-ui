import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";
import {
  AVATAR_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_AVATAR_BYTES,
} from "@/features/portal/portal";

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
 * "At least 8 characters, with a number" is the rule. Neither password screen
 * prints it -- both placeholders are dots -- so this schema is the only place it
 * is stated, and it comes back as the field's own error. Keep the copy in step.
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

/**
 * The new-request form when signed in. Same fields as the guest form, so one
 * `useForm<PortalGuestRequestValues>` serves both without a cast, but the email
 * and name are not checked: a signed-in customer's email comes from their
 * session (submitRequestAction never reads them), and the inputs are not
 * rendered -- so the guest form's "enter your email" rule would fail invisibly
 * and the submit would simply do nothing.
 */
export const portalSignedInRequestFormSchema = portalGuestRequestSchema.extend({
  email: z.string(),
});

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

/**
 * What the browser says about the file it picked, before the server hands out a
 * token to upload it with.
 *
 * Both fields are a claim, not a fact -- the real size and type are read off the
 * stored object afterwards (statStoredObject) -- but the claim is the only thing
 * available before the bytes move, so it is checked here rather than trusted.
 * Without it, prepareAvatarUploadAction would mint an upload token for any
 * Content-Type a caller cared to send, and the bucket's own allow-list would be
 * the last line of defence on a public bucket.
 *
 * The types match AVATAR_MIME_TYPES and MAX_AVATAR_BYTES in
 * src/features/portal/portal.ts, and the bucket's allowed_mime_types.
 */
export const portalAvatarFileSchema = z.object({
  size: z.number().int().positive().max(MAX_AVATAR_BYTES),
  type: z.enum(AVATAR_MIME_TYPES),
});

export type PortalAvatarFileValues = z.infer<typeof portalAvatarFileSchema>;

/**
 * Upload inputs, checked at runtime.
 *
 * Server actions are bare POST endpoints and TypeScript types do not exist at
 * runtime, so these are what stand between a hand-made request and the service:
 * a non-string path used to surface as a TypeError ("unknown error"), and a
 * megabyte-long file name was stored as original_filename as-is.
 */
const fileNameField = z
  .string()
  .min(1, "That file has no name")
  .max(255, "File names can be up to 255 characters");

/** What the browser says about each file before it is given upload targets. */
export const portalFileDescriptorsSchema = z
  .array(
    z.object({
      name: fileNameField,
      size: z.number().int().nonnegative(),
      type: z.string().max(255).optional(),
    }),
  )
  .max(
    MAX_ATTACHMENTS_PER_MESSAGE,
    `Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files at a time.`,
  );

export type PortalFileDescriptors = z.infer<typeof portalFileDescriptorsSchema>;

/** Files the browser reports as uploaded, with the paths it was handed. */
export const portalUploadedFilesSchema = z
  .array(
    z.object({
      path: z.string().min(1).max(512),
      name: fileNameField,
      size: z.number().int().nonnegative(),
      mime: z.string().max(255),
    }),
  )
  .max(
    MAX_ATTACHMENTS_PER_MESSAGE,
    `Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files at a time.`,
  );

/** The avatar path a profile save names, when a new photo was uploaded. */
export const portalAvatarPathSchema = z.string().min(1).max(512).nullish();

/** Paths handed back for deletion when a set of uploads could not be filed. */
export const portalDiscardPathsSchema = z
  .array(z.string().min(1).max(512))
  .max(MAX_ATTACHMENTS_PER_MESSAGE);
