import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";

/**
 * Shape-only. There is no auth, so nothing here checks a credential — a submission that
 * satisfies this schema still lands on the design's failure copy, which the form sets by
 * hand (`setError`) rather than through validation.
 */
export const loginSchema = z.object({
  email: emailField("Enter your work email"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean(),
});

export type LoginValues = z.infer<typeof loginSchema>;
