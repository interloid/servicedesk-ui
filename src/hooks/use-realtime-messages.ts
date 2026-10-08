"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { TicketMessage } from "@/features/tickets/types/tickets.types";

function initialsFromName(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Subscribe to realtime INSERTs on `ticket_messages` for a single ticket so new
 * replies appear live in the conversation without a page refresh. Agent author
 * names are resolved from the `nameById` map when available.
 */
export function useRealtimeMessages(
  ticketId?: string,
  initial: TicketMessage[] = [],
  nameById: Record<string, string> = {},
) {
  const [messages, setMessages] = useState<TicketMessage[]>(initial);
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
              msg.author_initials = initialsFromName(name);
            }
          }

          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId]);

  return {
    messages,
    setMessages,
    lastActivityAt: messages[messages.length - 1]?.created_at || null,
  };
}
