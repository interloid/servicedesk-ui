import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";

export const MIN_PASSWORD_LENGTH = 8;

export const signupAccountSchema = z
  .object({
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
  .refine((values) => values.confirm === values.password, {
    path: ["confirm"],
    message: "Passwords don't match",
  });

export type SignupAccountValues = z.infer<typeof signupAccountSchema>;
