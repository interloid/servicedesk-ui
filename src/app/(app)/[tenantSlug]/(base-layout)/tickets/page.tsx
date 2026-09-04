import TicketsTable from "@/features/tickets/components/tickets-table";
import {
  fetchTenantTickets,
  fetchTicketStatusCounts,
} from "@/features/tickets/services/tickets.service";

interface TicketsPageProps {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    [key: string]: string | string[] | undefined;
  }>;
}

export default async function TicketsPage({
  params,
  searchParams,
}: TicketsPageProps) {
  const { tenantSlug } = await params;
  const sp = await searchParams;

  const status = typeof sp.status === "string" ? sp.status : undefined;
  const priority = typeof sp.priority === "string" ? sp.priority : undefined;
  const search = typeof sp.search === "string" ? sp.search : undefined;
  const sort =
    sp.sort === "subject" || sp.sort === "created_at" ? sp.sort : undefined;
  const sortOrder =
    sp.sortOrder === "asc" || sp.sortOrder === "desc"
      ? sp.sortOrder
      : undefined;
  const page = typeof sp.page === "string" ? Number(sp.page) || 1 : 1;
  const limit = typeof sp.limit === "string" ? Number(sp.limit) || 8 : 8;

  const [{ tickets, totalCount }, statusCounts] = await Promise.all([
    fetchTenantTickets(tenantSlug, {
      status,
      priority,
      search,
      sort,
      sortOrder,
      page,
      limit,
    }),
    fetchTicketStatusCounts(tenantSlug),
  ]);

  return (
    <TicketsTable
      initialTickets={tickets}
      totalCount={totalCount}
      statusCounts={statusCounts}
      tenant={tenantSlug}
    />
  );
}
