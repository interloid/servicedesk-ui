import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";

/** Stated in the Password hint so the rule and the copy cannot drift apart. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Step 1 of 4. Nothing is created and nothing is hashed — this only decides whether the
 * flow may advance to /create-org.
 *
 * The two `min()` calls on `password` are not redundant: an empty field reports the blank
 * copy, a short one reports the length copy, and zod keeps them in that order.
 */
export const signupAccountSchema = z
  .object({
    // Not in the design, which collects no name anywhere in the four steps — but
    // `public.users.full_name` is NOT NULL, so registration cannot complete without one.
    // Deriving it from the email local-part was the alternative and would have written
    // "sam" into every profile; asking is better than guessing at someone's name.
    fullName: z.string().trim().min(1, "Enter your full name"),
    email: emailField("Enter your email address"),
    password: z
      .string()
      .min(1, "Enter a password")
      .min(
        MIN_PASSWORD_LENGTH,
        `Use at least ${MIN_PASSWORD_LENGTH} characters`,
      ),
    confirm: z.string().min(1, "Re-enter your password"),
  })
  // Reported on `confirm`, so a mismatch blocks the field the user can fix without
  // disturbing the password field's own hint.
  .refine((values) => values.confirm === values.password, {
    path: ["confirm"],
    message: "Passwords don't match",
  });

export type SignupAccountValues = z.infer<typeof signupAccountSchema>;
