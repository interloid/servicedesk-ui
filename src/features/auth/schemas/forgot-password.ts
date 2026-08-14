import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";

/**
 * The reset request carries one field. The design's other error — the rate limit — is not
 * a validation failure and is set by the form itself, so it is deliberately absent here.
 */
export const forgotPasswordSchema = z.object({
  email: emailField("Enter your work email"),
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
