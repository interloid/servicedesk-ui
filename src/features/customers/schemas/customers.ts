import { z } from "zod";

/**
 * A portal invitation. The Share customer portal popup sends the address
 * alone; name and company are passed when inviting a customer already on the
 * list, so their record keeps what is known about them.
 */
export const inviteCustomerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Please enter an email address.")
    .max(254, "That email is too long.")
    .email("Please enter a valid email address."),
  fullName: z.string().trim().max(120, "That name is too long.").optional(),
  company: z
    .string()
    .trim()
    .max(120, "That company name is too long.")
    .optional(),
});

export type InviteCustomerValues = z.infer<typeof inviteCustomerSchema>;
