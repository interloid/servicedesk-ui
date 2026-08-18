import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";

export const loginSchema = z.object({
  email: emailField("Enter your work email"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean(),
});

export type LoginValues = z.infer<typeof loginSchema>;
