import { z } from "zod";

export const updatePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, { message: "Password must be at least 8 characters long." }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type UpdatePasswordValues = z.infer<typeof updatePasswordSchema>;

/**
 * Query parameter on the reset-password link saying which email it came from.
 * Supabase keeps it when it sends a dead link back with an error, which is
 * the one time the page can't tell from the tokens: the fragment has no
 * `type`. A forgotten password leads back to sign in; an invitee has no
 * password yet, so only their admin can get them a new link.
 */
export const LINK_ACTION_PARAM = "action";

export const LINK_ACTIONS = {
  INVITE: "invite",
  RESET: "reset",
} as const;

export type LinkAction = (typeof LINK_ACTIONS)[keyof typeof LINK_ACTIONS];
