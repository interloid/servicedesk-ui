import { TicketsTableSkeleton } from "@/features/tickets/components/ticket-skeletons";

/**
 * Lives inside the (overview) route group, not at tickets/loading.tsx: a
 * loading.tsx is the Suspense fallback for its whole segment including every
 * child, so one level up it would also flash the queue on the way to a single
 * ticket. (overview) and [ticketId] are siblings, so each wraps only its own
 * page. Route groups don't appear in the URL; the queue is still /tickets.
 *
 * Filters, search and paging navigate inside a transition, so they keep the
 * table on screen rather than showing this.
 */
export default function Loading() {
  return <TicketsTableSkeleton />;
}
