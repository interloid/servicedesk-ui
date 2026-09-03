"use client";

import { useEffect, useRef } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

/**
 * Subscribe to realtime changes on `tickets` and `sla_events` for the current
 * tenant and trigger a Next.js server refresh (debounced) so the tickets list
 * re-fetches its server-rendered rows and recomputes the SLA column text.
 * RLS on both tables (tenant-wide for members) governs delivery.
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
