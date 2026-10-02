import type { Metadata } from "next";

import CustomersTable from "@/features/customers/components/customers-table";
import {
  fetchTenantCustomers,
  serverNow,
} from "@/features/customers/services/customers.service";
import {
  parseCustomerSort,
  parsePageParam,
} from "@/features/customers/types/customers";

export const metadata: Metadata = {
  title: "Customers",
  description: "Companies and the people who raise tickets from them.",
};

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ tenantSlug }, query] = await Promise.all([params, searchParams]);

  // Search, sort and page live in the URL, so a filtered page survives a
  // reload, a shared link and the back button.
  const search = (first(query.q) ?? "").trim().slice(0, 200);
  const sort = parseCustomerSort(first(query.sort), first(query.dir));

  // Independent reads, so they go out together rather than one after another.
  const [result, now] = await Promise.all([
    fetchTenantCustomers(tenantSlug, {
      search,
      page: parsePageParam(first(query.page)),
      sort,
    }),
    serverNow(),
  ]);

  return (
    <CustomersTable
      tenant={tenantSlug}
      result={result}
      search={search}
      sort={sort}
      now={now}
    />
  );
}
