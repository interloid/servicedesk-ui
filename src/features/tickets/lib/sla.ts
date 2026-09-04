import { Ticket } from "@/features/tickets/types/tickets.types";

function formatSlaDuration(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

export type LiveSla = {
  type: "warning" | "breached" | "normal" | "completed";
  text: string;
};

/**
 * Recompute the SLA status + text for a ticket at the given time (ms).
 * Uses the stored `sla_status` / `sla_due_at` snapshot so the countdown can
 * tick live without a server round-trip. Falls back to the stored values when
 * there is nothing to animate.
 */
export function computeLiveSla(ticket: Ticket, now: number): LiveSla {
  const { sla_status, sla_due_at } = ticket;

  if (ticket.status === "resolved" || ticket.status === "closed") {
    return { type: ticket.sla_type, text: ticket.sla_text };
  }

  if (sla_status === "completed") {
    return { type: "completed", text: ticket.sla_text };
  }

  if (!sla_due_at || (sla_status !== "pending" && sla_status !== "breached")) {
    return { type: ticket.sla_type, text: ticket.sla_text };
  }

  const due = new Date(sla_due_at).getTime();
  const remaining = due - now;

  if (sla_status === "breached" || remaining <= 0) {
    return {
      type: "breached",
      text: `Breached ${formatSlaDuration(remaining)} ago`,
    };
  }

  return {
    type: remaining < 600000 ? "warning" : "normal",
    text: `${formatSlaDuration(remaining)} left`,
  };
}
