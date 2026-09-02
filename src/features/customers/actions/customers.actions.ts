"use server";

import { fetchTenantCustomers } from "../services/customers.service";

export async function getCustomersAction(tenant: string) {
  try {
    const customers = await fetchTenantCustomers(tenant);
    return { success: true, customers };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : `Failed to fetch customers`;
    console.error("getCustomersAction failed:", message);
    return {
      success: false,
      error: message,
      customers: [],
    };
  }
}
