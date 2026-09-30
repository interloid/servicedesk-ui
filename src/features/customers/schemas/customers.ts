import { z } from "zod";

/**
 * The invite carries no fields: the address is already on the customer record
 * and the one person who may send it is decided by the caller's role, not by
 * anything the browser sends. The id is still validated here rather than
 * trusted, because a Server Action is a bare POST.
 */
export const inviteCustomerSchema = z.object({
  customerId: z.uuid("That customer no longer exists."),
});

export type InviteCustomerValues = z.infer<typeof inviteCustomerSchema>;
