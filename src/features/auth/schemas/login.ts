import { z } from "zod";

import { emailField } from "@/features/auth/schemas/email";

export const loginSchema = z.object({
  email: emailField("Please enter your email address"),
  password: z.string().min(1, "Please enter your password"),
  remember: z.boolean(),
});

export type LoginValues = z.infer<typeof loginSchema>;
