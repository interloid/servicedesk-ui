"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { inviteCustomerSchema } from "@/features/customers/schemas/customers";
import {
  CustomerInviteError,
  type CustomerInviteFailure,
  inviteCustomer,
  inviteExistingCustomer,
  setCustomerPortalAccess,
} from "@/features/customers/services/customer-invite.service";
import { getSessionTenantSlug } from "@/features/tenancy/services/tenant-resolver";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";

export type InviteCustomerResult =
  | { ok: true }
  | {
      ok: false;
      failureCode: CustomerInviteFailure | "validation";
      message: string;
    };

export async function inviteCustomerAction(
  values: unknown,
): Promise<InviteCustomerResult> {
  const parsed = inviteCustomerSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "Check the highlighted fields and try again.",
    };
  }

  try {
    await inviteCustomer(parsed.data);
  } catch (error) {
    return toFailure(
      error,
      "We couldn't send that invite. Try again in a moment.",
    );
  }

  await revalidateCustomers();

  return { ok: true };
}

/** The list and every customer page under it (`layout` covers the detail). */
async function revalidateCustomers() {
  const slug = await getSessionTenantSlug();

  if (slug) {
    revalidatePath(tenantPath(slug, TENANT_ROUTES.CUSTOMERS), "layout");
  }
}

function toFailure(error: unknown, fallback: string): InviteCustomerResult {
  if (error instanceof CustomerInviteError) {
    return { ok: false, failureCode: error.code, message: error.message };
  }

  console.error("[customers] action failed", error);

  return { ok: false, failureCode: "unknown", message: fallback };
}

const customerAccessSchema = z.object({
  customerId: z.uuid(),
  enabled: z.boolean(),
});

/** Disable or re-enable a customer's portal access. Tenant Admin only. */
export async function setCustomerAccessAction(
  values: unknown,
): Promise<InviteCustomerResult> {
  const parsed = customerAccessSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "That isn't a customer we can update.",
    };
  }

  try {
    await setCustomerPortalAccess(parsed.data.customerId, parsed.data.enabled);
  } catch (error) {
    return toFailure(error, "We couldn't change their access. Try again.");
  }

  await revalidateCustomers();

  return { ok: true };
}

/** Invite a customer already on the list, or resend a pending invite. */
export async function inviteExistingCustomerAction(
  values: unknown,
): Promise<InviteCustomerResult> {
  const parsed = z.object({ customerId: z.uuid() }).safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "That isn't a customer we can invite.",
    };
  }

  try {
    await inviteExistingCustomer(parsed.data.customerId);
  } catch (error) {
    return toFailure(error, "We couldn't send that invite. Try again.");
  }

  await revalidateCustomers();

  return { ok: true };
}
