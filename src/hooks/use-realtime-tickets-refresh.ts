"use client";

import { useEffect, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

/** Quiet time before a refresh, so a burst of changes is one refresh. */
const DEBOUNCE_MS = 400;
/** A steady stream of changes still refreshes at least this often. */
const MAX_WAIT_MS = 2000;

/**
 * Subscribe to realtime changes on `tickets` and `sla_events` for the current
 * tenant and trigger a Next.js server refresh (debounced) so the tickets list
 * re-fetches its server-rendered rows and recomputes the SLA column text.
 * Listeners are filtered to the tenant's rows (RLS still governs delivery),
 * so another tenant's activity doesn't re-render this queue.
 *
 * `tenantId` is taken from a loaded row when there is one; an empty queue
 * looks it up from the slug.
 *
 * Breach and due-soon notifications are sent by the database (sla_tick), not
 * from here, so they go out whether or not anyone has the queue open.
 */
export function useRealtimeTicketsRefresh(
  tenantSlug?: string,
  knownTenantId?: string,
) {
  const router = useRouter();

  // Remember the tenant id once seen, so a filter that empties the list
  // doesn't drop the subscription.
  const [remembered, setRemembered] = useState<{
    slug: string;
    id: string;
  } | null>(null);
  if (
    tenantSlug &&
    knownTenantId &&
    (remembered?.slug !== tenantSlug || remembered.id !== knownTenantId)
  ) {
    setRemembered({ slug: tenantSlug, id: knownTenantId });
  }
  const tenantId =
    remembered && remembered.slug === tenantSlug ? remembered.id : undefined;

  useEffect(() => {
    if (!tenantSlug || tenantId) return;
    let cancelled = false;
    createSupabaseClient()
      .from("tenants")
      .select("id")
      .eq("slug", tenantSlug)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.id)
          setRemembered({ slug: tenantSlug, id: data.id });
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, tenantId]);

  useEffect(() => {
    if (!tenantId) return;
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

    const filter = `tenant_id=eq.${tenantId}`;

    const channel = supabase
      .channel(`realtime-tickets-table-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sla_events", filter },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sla_events", filter },
        schedule,
      )
      // Deletes can't be filtered server-side; skip one that names another
      // tenant (the old row may carry only the id, then it counts).
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "sla_events" },
        (payload) => {
          const old = payload.old as { tenant_id?: string } | undefined;
          if (old?.tenant_id && old.tenant_id !== tenantId) return;
          schedule();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tickets", filter },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tickets", filter },
        schedule,
      )
      // Realtime doesn't replay changes missed while the socket was down
      // (a sleeping laptop, dropped wifi): re-read the list on rejoin.
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (joined) fire();
        joined = true;
      });

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [tenantId, router]);
}
