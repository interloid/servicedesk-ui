import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";

export const MIN_PASSWORD_LENGTH = 8;

export const signupAccountSchema = z
  .object({
    fullName: z.string().trim().min(1, "Please enter your full name"),
    email: emailField("Please enter your email address"),
    password: z
      .string()
      .min(1, "Please enter a password")
      .min(
        MIN_PASSWORD_LENGTH,
        `Use at least ${MIN_PASSWORD_LENGTH} characters`,
      ),
    confirm: z.string().min(1, "Please re-enter your password"),
  })
  .refine((values) => values.confirm === values.password, {
    path: ["confirm"],
    message: "Passwords don't match",
  });

export type SignupAccountValues = z.infer<typeof signupAccountSchema>;
