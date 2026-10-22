"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { subscribeWithAuth } from "@/lib/supabase/realtime";
import { TicketMessage } from "@/features/tickets/types/tickets.types";
import { getInitials } from "@/lib/format";

/**
 * Subscribe to realtime INSERTs and edits on `ticket_messages` for a single ticket so new
 * replies appear live in the conversation without a page refresh. Agent author
 * names are resolved from the `nameById` map when available.
 */
export function useRealtimeMessages(
  ticketId?: string,
  initial: TicketMessage[] = [],
  nameById: Record<string, string> = {},
) {
  const [messages, setMessages] = useState<TicketMessage[]>(initial);

  // Realtime doesn't replay what was missed while the socket was down, so a
  // fresh server list (router.refresh, revalidatePath) is merged in by id:
  // server rows win, replies that arrived live and aren't in it yet stay.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen && (initial.length > 0 || seen.length > 0)) {
    setSeen(initial);
    setMessages((prev) => {
      const ids = new Set(initial.map((m) => m.id));
      return [...initial, ...prev.filter((m) => !ids.has(m.id))].sort((x, y) =>
        x.created_at.localeCompare(y.created_at),
      );
    });
  }
  const nameByIdRef = useRef(nameById);

  useEffect(() => {
    nameByIdRef.current = nameById;
  }, [nameById]);

  useEffect(() => {
    if (!ticketId) return;
    if (typeof window === "undefined" || typeof WebSocket === "undefined")
      return;
    const supabase = createSupabaseClient();

    const channel = supabase
      .channel(`realtime-messages-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ticket_messages",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const raw = payload.new as TicketMessage;
          const msg: TicketMessage = { ...raw };

          if (msg.author_type === "agent" && !msg.author_name) {
            const name = nameByIdRef.current[msg.author_id];
            if (name) {
              msg.author_name = name;
              msg.author_initials = getInitials(name, "");
            }
          }

          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        },
      )
      // Edits: replace the body (and is_edited) in place, keeping the
      // author name already resolved for the row.
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ticket_messages",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const raw = payload.new as TicketMessage;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === raw.id
                ? {
                    ...m,
                    ...raw,
                    author_name: raw.author_name ?? m.author_name,
                    author_initials: raw.author_initials ?? m.author_initials,
                  }
                : m,
            ),
          );
        },
      );

    const unsubscribe = subscribeWithAuth(supabase, channel);

    return () => {
      unsubscribe();
    };
  }, [ticketId]);

  return {
    messages,
    setMessages,
    lastActivityAt: messages[messages.length - 1]?.created_at || null,
  };
}
