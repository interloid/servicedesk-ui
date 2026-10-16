"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase/client";
import {
  TicketPriority,
  TicketStatus,
} from "@/features/tickets/types/tickets.types";

/** The ticket columns that can change under an open detail page. */
export interface LiveTicketRow {
  status: TicketStatus;
  priority: TicketPriority;
  assignee_user_id: string | null;
  sla_policy_id: string | null;
  resolved_at: string | null;
  closed_at: string | null;
}

/**
 * Follow one ticket's row, so changes made elsewhere -- auto-close by
 * sla_tick, a customer reopening from the portal, a teammate -- reach an open
 * detail page. RLS on `tickets` governs delivery.
 */
export function useRealtimeTicket(
  ticketId: string,
  onUpdate: (row: LiveTicketRow) => void,
) {
  const router = useRouter();
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof WebSocket === "undefined")
      return;
    const supabase = createSupabaseClient();
    let joined = false;

    const channel = supabase
      .channel(`realtime-ticket-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tickets",
          filter: `id=eq.${ticketId}`,
        },
        (payload) => onUpdateRef.current(payload.new as LiveTicketRow),
      )
      // Realtime doesn't replay changes missed while the socket was down
      // (a sleeping laptop, dropped wifi). When the channel joins again,
      // re-read the page; the detail view and the message/SLA hooks merge
      // the fresh server data in.
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (joined) router.refresh();
        joined = true;
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId, router]);
}
