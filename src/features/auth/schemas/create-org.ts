import { z } from "zod";

/** Lowercase alphanumerics and inner hyphens — what a subdomain label allows. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Step 2 of 4. `.trim().toLowerCase()` runs BEFORE the pattern check, so `Acme EU` fails
 * on the space rather than on the capitals — matching what the screen did before the
 * schema existed.
 *
 * Shape only. Availability is NOT checked here: the hardcoded `TAKEN_SLUG = "northwind"`
 * this schema used to carry was a stand-in for a registry that didn't exist, and now that
 * one does it would reject a genuinely free address. The real check runs against `tenants`
 * in `register.service.ts`, which is also the only place that can win the race.
 */
export const createOrgSchema = z.object({
  name: z.string().trim().min(1, "Enter an organization name"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter a portal address")
    .regex(SLUG_PATTERN, "Use lowercase letters, numbers and hyphens only"),
  // Always a valid id: the Select is seeded and cannot be cleared.
  timezone: z.string().min(1),
});

export type CreateOrgValues = z.infer<typeof createOrgSchema>;
