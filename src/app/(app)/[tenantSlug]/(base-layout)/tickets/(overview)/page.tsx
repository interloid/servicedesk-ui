import type { Metadata } from "next";
import TicketsTable from "@/features/tickets/components/tickets-table";
import { TICKET_PAGE_SIZES } from "@/features/tickets/lib/list";
import {
  isTicketPriority,
  isTicketStatus,
} from "@/features/tickets/types/tickets.types";
import {
  ASSIGNEE_ROLES,
  fetchTenantTickets,
  fetchTicketStatusCounts,
  getCurrentUserIdentity,
} from "@/features/tickets/services/tickets.service";
import {
  fetchSavedViewFilter,
  fetchSavedViewTabs,
} from "@/features/saved-view/services/saved-views.service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: "Tickets",
};

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

  // Only real values filter the list; anything else (?status=foo) is "all".
  const rawStatus =
    typeof sp.status === "string" ? sp.status.toLowerCase() : undefined;
  const rawPriority =
    typeof sp.priority === "string" ? sp.priority.toLowerCase() : undefined;
  const status = isTicketStatus(rawStatus) ? rawStatus : undefined;
  const priority = isTicketPriority(rawPriority) ? rawPriority : undefined;
  const search = typeof sp.search === "string" ? sp.search : undefined;

  // A saved view's AND / OR rules don't fit in status=/priority= params, so
  // its tab links by id and the rules are read here. An id that isn't a view
  // the viewer can see is ignored: every ticket.
  const viewId =
    typeof sp.view === "string" && UUID_RE.test(sp.view) ? sp.view : null;
  const viewFilter = viewId
    ? await fetchSavedViewFilter(tenantSlug, viewId)
    : null;
  // Subject A→Z unless the list asks otherwise; the table shows the same.
  const sort =
    sp.sort === "subject" || sp.sort === "created_at" ? sp.sort : "subject";
  const sortOrder =
    sp.sortOrder === "asc" || sp.sortOrder === "desc"
      ? sp.sortOrder
      : sort === "subject"
        ? "asc"
        : "desc";
  // Only what the table offers: a hand-typed ?limit=100000 or ?page=-2 would
  // load every ticket at once or an empty range.
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const limit = TICKET_PAGE_SIZES.includes(Number(sp.limit))
    ? Number(sp.limit)
    : TICKET_PAGE_SIZES[0];

  const [{ tickets, totalCount }, statusCounts, currentUser, viewTabs] =
    await Promise.all([
      fetchTenantTickets(tenantSlug, {
        status,
        priority,
        search,
        viewFilter,
        sort,
        sortOrder,
        page,
        limit,
      }),
      fetchTicketStatusCounts(tenantSlug),
      getCurrentUserIdentity(tenantSlug),
      // The tabs are the viewer's saved views, in their Views page order.
      // [] if they fail to load: the table falls back to the status tabs.
      fetchSavedViewTabs(tenantSlug),
    ]);

  return (
    <TicketsTable
      initialTickets={tickets}
      totalCount={totalCount}
      page={page}
      limit={limit}
      statusCounts={statusCounts}
      viewTabs={viewTabs}
      tenant={tenantSlug}
      // Tenant admins aren't assignees, so no bulk "Assign to me".
      canAssignToSelf={
        !!currentUser?.role && ASSIGNEE_ROLES.includes(currentUser.role)
      }
    />
  );
}
