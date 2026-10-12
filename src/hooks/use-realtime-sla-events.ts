"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { SlaEvent } from "@/features/tickets/types/tickets.types";

const ORDER: Record<SlaEvent["type"], number> = {
  first_response: 0,
  resolution: 1,
};

/**
 * Subscribe to realtime changes on `sla_events` for a single ticket so the
 * SLA countdown / status card updates live (e.g. when an event completes or
 * breaches). RLS on the table (tenant-wide for members) governs delivery.
 */
export function useRealtimeSlaEvents(
  ticketId?: string,
  initial: SlaEvent[] = [],
) {
  const [events, setEvents] = useState<SlaEvent[]>(initial);

  // Realtime doesn't replay what was missed while the socket was down, so a
  // fresh server list (router.refresh, revalidatePath) is merged in: the
  // server's rows, except where realtime already delivered a newer version.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen && (initial.length > 0 || seen.length > 0)) {
    setSeen(initial);
    setEvents((prev) => {
      const live = new Map(prev.map((e) => [e.id, e]));
      return sortEvents(
        initial.map((e) => {
          const l = live.get(e.id);
          return l && l.updated_at > e.updated_at ? l : e;
        }),
      );
    });
  }

  useEffect(() => {
    if (!ticketId) return;
    if (typeof window === "undefined" || typeof WebSocket === "undefined")
      return;
    const supabase = createSupabaseClient();

    const channel = supabase
      .channel(`realtime-sla-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sla_events",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const ev = payload.new as SlaEvent;
          setEvents((prev) =>
            sortEvents(prev.some((e) => e.id === ev.id) ? prev : [...prev, ev]),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sla_events",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const ev = payload.new as SlaEvent;
          setEvents((prev) =>
            sortEvents(prev.map((e) => (e.id === ev.id ? ev : e))),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "sla_events",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const old = payload.old as { id: string };
          setEvents((prev) => prev.filter((e) => e.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId]);

  // A server answer (an action's fresh rows) wins over whatever realtime
  // delivered so far; later realtime changes still apply on top.
  const replaceEvents = useCallback(
    (next: SlaEvent[]) => setEvents(sortEvents(next)),
    [],
  );

  return { events, replaceEvents };
}

function sortEvents(events: SlaEvent[]): SlaEvent[] {
  return [...events].sort(
    (a, b) => (ORDER[a.type] ?? 99) - (ORDER[b.type] ?? 99),
  );
}
