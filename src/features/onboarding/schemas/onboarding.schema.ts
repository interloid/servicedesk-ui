import { z } from "zod";

export const inviteUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["agent", "admin", "manager"]).default("agent"),
});

export const slaRuleSchema = z.object({
  priority: z.enum(["Urgent", "High", "Normal", "Low"]),
  first_response_mins: z.number().positive(),
  resolution_mins: z.number().positive(),
});

export const registerSchema = z.object({
  email: z.string().email("Invalid work email"),
  password: z.string().min(10, "Password must be at least 10 characters"),
  full_name: z.string().min(2, "Full name is required"),

  organization_name: z.string().min(2, "Organization name is required"),
  portal_slug: z
    .string()
    .min(2, "Portal slug is required")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens",
    ),

  timezone_id: z.string().uuid("Invalid timezone ID"),
  working_days: z.array(z.string()).min(1, "Select at least one working day"),
  day_start: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid start time (HH:MM)"),
  day_end: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid end time (HH:MM)"),

  sla: z
    .array(slaRuleSchema)
    .min(1, "At least one SLA target rule is required"),

  invite_users: z.array(inviteUserSchema).default([]),
});

export type RegisterInput = z.infer<typeof registerSchema>;
