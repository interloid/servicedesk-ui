"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import {
  UiNotification,
  toUiNotification,
  NotificationType,
} from "@/lib/notifications-shared";

/**
 * Subscribe to realtime changes on the `notifications` table for the current
 * user within a tenant. RLS on the table (user_id = auth.uid()) ensures only
 * the recipient receives the streamed rows.
 */
export function useRealtimeNotifications(
  tenantSlug?: string,
  initial: UiNotification[] = [],
) {
  const [items, setItems] = useState<UiNotification[]>(initial);
  const currentUserId = useRef<string | null>(null);
  const ready = useRef(false);

  useEffect(() => {
    if (!tenantSlug) return;
    if (typeof window === "undefined" || typeof WebSocket === "undefined")
      return;
    const supabase = createSupabaseClient();

    let unsub: (() => void) | undefined;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        const uid = data.user?.id || null;
        if (!uid) return;
        currentUserId.current = uid;

        const channel = supabase
          .channel("realtime-notifications")
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "notifications",
              filter: `user_id=eq.${uid}`,
            },
            (payload) => {
              const row = payload.new as {
                id: string;
                type: NotificationType;
                payload_json: unknown;
                read_at: string | null;
                created_at: string;
              };
              const notif = toUiNotification(row);
              setItems((prev) => {
                if (prev.some((n) => n.id === notif.id)) return prev;
                return [notif, ...prev].slice(0, 100);
              });
            },
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "notifications",
              filter: `user_id=eq.${uid}`,
            },
            (payload) => {
              const row = payload.new as {
                id: string;
                read_at: string | null;
              };
              setItems((prev) =>
                prev.map((n) =>
                  n.id === row.id ? { ...n, unread: !row.read_at } : n,
                ),
              );
            },
          )
          .on(
            "postgres_changes",
            {
              event: "DELETE",
              schema: "public",
              table: "notifications",
              filter: `user_id=eq.${uid}`,
            },
            (payload) => {
              const old = payload.old as { id: string };
              setItems((prev) => prev.filter((n) => n.id !== old.id));
            },
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") ready.current = true;
          });

        unsub = () => {
          supabase.removeChannel(channel);
        };
      })
      .catch(() => {
        // ignore auth failures; realtime simply won't subscribe
      });

    return () => {
      unsub?.();
    };
  }, [tenantSlug]);

  const unread = items.filter((n) => n.unread).length;

  return { items, setItems, unread };
}
