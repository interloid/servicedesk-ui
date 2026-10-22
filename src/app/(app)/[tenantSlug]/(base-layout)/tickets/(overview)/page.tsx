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
  getCurrentUserIdentity,
} from "@/features/tickets/services/tickets.service";
import {
  fetchSavedViewFilter,
  fetchSavedViewTabs,
} from "@/features/saved-view/services/saved-views.service";
import { isUuid } from "@/lib/uuid";

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
  const viewId = isUuid(sp.view) ? sp.view : null;
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

  // The tabs are the viewer's saved views, in their Views page order, each
  // with a count query: started first but not awaited, so the table paints first and the tabs
  // stream in. [] if they fail to load: the table shows "All tickets" alone.
  const viewTabs = fetchSavedViewTabs(tenantSlug);

  const [{ tickets, totalCount }, currentUser] = await Promise.all([
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
    getCurrentUserIdentity(tenantSlug),
  ]);
  return (
    <TicketsTable
      initialTickets={tickets}
      totalCount={totalCount}
      page={page}
      limit={limit}
      viewTabs={viewTabs}
      tenant={tenantSlug}
      // Tenant admins aren't assignees, so no bulk "Assign to me".
      canAssignToSelf={
        !!currentUser?.role && ASSIGNEE_ROLES.includes(currentUser.role)
      }
    />
  );
}
