"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase/client";

/** Quiet time before a refresh, so a reply and its attachments are one refresh. */
const DEBOUNCE_MS = 400;
/** A steady stream of changes still refreshes at least this often. */
const MAX_WAIT_MS = 2000;

/**
 * Follow one portal request so the team's replies, edits and status changes
 * reach a customer with the thread open, as they do on the agent side.
 *
 * The portal thread is server-rendered (author names, signed attachment links,
 * the customer-facing state and the CSAT card are all worked out there), so
 * any change re-reads the page rather than patching rows in locally. RLS
 * governs delivery: a customer is only sent public messages on their own
 * requests, never internal notes.
 */
export function useRealtimePortalRequest(requestId: string) {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined" || typeof WebSocket === "undefined")
      return;
    const supabase = createSupabaseClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstQueuedAt: number | null = null;
    let joined = false;

    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      firstQueuedAt = null;
      router.refresh();
    };

    // Debounced, but never more than MAX_WAIT_MS after the first change
    // queued, so a steady stream can't starve the refresh.
    const schedule = () => {
      const now = Date.now();
      firstQueuedAt ??= now;
      if (timer) clearTimeout(timer);
      const wait = Math.max(
        0,
        Math.min(DEBOUNCE_MS, firstQueuedAt + MAX_WAIT_MS - now),
      );
      timer = setTimeout(fire, wait);
    };

    const messages = `ticket_id=eq.${requestId}`;

    const channel = supabase
      .channel(`realtime-portal-request-${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ticket_messages",
          filter: messages,
        },
        schedule,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ticket_messages",
          filter: messages,
        },
        schedule,
      )
      // Status changes -- resolved, waiting on you, auto-closed by sla_tick.
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tickets",
          filter: `id=eq.${requestId}`,
        },
        schedule,
      )
      // Realtime doesn't replay changes missed while the socket was down
      // (a sleeping phone, dropped wifi): re-read the thread on rejoin.
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (joined) fire();
        joined = true;
      });

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [requestId, router]);
}
