"use server";

import { revalidatePath } from "next/cache";

import { getSessionTenantSlug } from "@/features/tenancy/services/tenant-resolver";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";

import { inviteCustomerSchema } from "@/features/customers/schemas/customers";
import {
  CustomerInviteError,
  fetchTenantCustomers,
  inviteCustomerToPortal,
} from "@/features/customers/services/customers.service";
import type { CustomerInviteResult } from "@/features/customers/types/customers";

export async function getCustomersAction(tenant: string) {
  try {
    const customers = await fetchTenantCustomers(tenant);
    return { success: true, customers };
  } catch (error: unknown) {
    return {
      error:
        error instanceof Error ? error.message : `Failed to fetch customers`,
      customers: [],
    };
  }
}

/**
 * Every route lives under `/[tenantSlug]/`, so a bare "/customers" matches
 * nothing and revalidates nothing -- the invite would save and leave the
 * "Not signed in yet" badge on screen, which reads as a failed send.
 */
async function revalidateCustomer(customerId: string): Promise<void> {
  const slug = await getSessionTenantSlug();

  if (!slug) {
    return;
  }

  revalidatePath(tenantPath(slug, TENANT_ROUTES.CUSTOMERS));
  revalidatePath(tenantPath(slug, `${TENANT_ROUTES.CUSTOMERS}/${customerId}`));
}

export async function inviteCustomerToPortalAction(
  values: unknown,
): Promise<CustomerInviteResult> {
  const parsed = inviteCustomerSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "That customer no longer exists.",
    };
  }

  try {
    await inviteCustomerToPortal(parsed.data);
    await revalidateCustomer(parsed.data.customerId);
    return { ok: true };
  } catch (error) {
    if (error instanceof CustomerInviteError) {
      return { ok: false, failureCode: error.code, message: error.message };
    }

    console.error("[customers] inviteCustomerToPortalAction failed", error);

    return {
      ok: false,
      failureCode: "unknown",
      message: "We couldn't send that invite. Try again in a moment.",
    };
  }
}
