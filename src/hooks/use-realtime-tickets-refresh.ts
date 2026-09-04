"use client";

import { useEffect, useRef } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { notifySlaBreachAction } from "@/features/tickets/actions/tickets.actions";

/**
 * Subscribe to realtime changes on `tickets` and `sla_events` for the current
 * tenant and trigger a Next.js server refresh (debounced) so the tickets list
 * re-fetches its server-rendered rows and recomputes the SLA column text.
 * RLS on both tables (tenant-wide for members) governs delivery.
 *
 * When an SLA event transitions `pending` -> `breached`, also notify the
 * ticket's assignee via `notifySlaBreachAction` (idempotent per event).
 */
export function useRealtimeTicketsRefresh(tenantSlug?: string) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!tenantSlug) return;
    if (typeof window === "undefined" || typeof WebSocket === "undefined")
      return;
    const supabase = createSupabaseClient();

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };

    const handleSlaChange = (payload: {
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => {
      schedule();
      const prev = payload.old?.status as string | undefined;
      const next = payload.new?.status as string | undefined;
      const ticketId = payload.new?.ticket_id as string | undefined;
      const eventId = payload.new?.id as string | undefined;
      const eventType = payload.new?.type as string | undefined;
      if (prev === "pending" && next === "breached" && ticketId && eventId) {
        notifySlaBreachAction({
          tenantId: tenantSlug,
          ticketId,
          slaEventId: eventId,
          slaLabel:
            eventType === "first_response"
              ? "First response SLA"
              : "Resolution SLA",
        });
      }
    };

    const channel = supabase
      .channel("realtime-tickets-table")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sla_events" },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sla_events" },
        handleSlaChange,
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "sla_events" },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tickets" },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tickets" },
        schedule,
      )
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [tenantSlug, router]);
}
