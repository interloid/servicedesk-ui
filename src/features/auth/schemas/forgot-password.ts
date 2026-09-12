import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";

export const forgotPasswordSchema = z.object({
  email: emailField("Enter your email"),
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
