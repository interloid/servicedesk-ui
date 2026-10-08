"use client";

import { useEffect, useRef } from "react";
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
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof WebSocket === "undefined")
      return;
    const supabase = createSupabaseClient();

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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId]);
}
