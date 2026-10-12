import React from "react";
import { Inbox, MessageSquare, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function TicketsEmptyState({
  title = "Queue clear",
  description = "Nothing matches this view right now. Change the filters, or raise a ticket on a customer's behalf.",
  actionLabel = "New ticket",
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center w-full">
      <div className="mb-5 flex size-14 items-center justify-center rounded-xl bg-brand-accent/10 text-brand-accent">
        <Inbox className="size-7" aria-hidden />
      </div>

      <h3 className="text-lg font-bold text-slate-900 sm:text-xl">{title}</h3>
      <p className="mt-2 mb-6 max-w-md text-sm leading-relaxed text-slate-500">
        {description}
      </p>

      {onAction && (
        <Button
          onClick={onAction}
          className="h-10 gap-2 rounded-lg bg-brand-accent px-5 text-sm font-semibold text-brand-accent-foreground shadow-none hover:bg-brand-accent/90"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

/** Two chat bubbles: a grey one behind, a brand one in front. */
function ConversationIllustration() {
  return (
    <svg viewBox="0 0 96 80" className="h-20 w-24" fill="none" aria-hidden>
      <path
        d="M10 10a10 10 0 0 1 10-10h36a10 10 0 0 1 10 10v20a10 10 0 0 1-10 10H30l-12 10v-10.6A10 10 0 0 1 10 30Z"
        className="fill-slate-100 stroke-slate-200"
        strokeWidth="1.5"
      />
      <circle cx="30" cy="20" r="2.5" className="fill-slate-300" />
      <circle cx="38" cy="20" r="2.5" className="fill-slate-300" />
      <circle cx="46" cy="20" r="2.5" className="fill-slate-300" />
      <path
        d="M40 38a10 10 0 0 1 10-10h28a10 10 0 0 1 10 10v14a10 10 0 0 1-10 10h-2v10l-12-10H50a10 10 0 0 1-10-10Z"
        className="fill-white stroke-brand-accent"
        strokeWidth="2"
      />
      <circle cx="56" cy="45" r="2.5" className="fill-brand-accent" />
      <circle cx="64" cy="45" r="2.5" className="fill-brand-accent" />
      <circle cx="72" cy="45" r="2.5" className="fill-brand-accent" />
    </svg>
  );
}

/**
 * The ticket thread before anyone has written in it: what happened, and the
 * two ways to start. Each button picks the composer's mode and focuses it.
 * A closed ticket gets no buttons; it has to be reopened first.
 */
export function TicketThreadEmptyState({
  closed = false,
  onReply,
  onNote,
}: {
  closed?: boolean;
  onReply: () => void;
  onNote: () => void;
}) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
      <ConversationIllustration />

      <h3 className="mt-5 text-base font-bold text-slate-900 sm:text-lg">
        No messages on this ticket yet
      </h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
        {closed
          ? "This ticket was closed before anyone wrote in it. Reopen it to start the conversation."
          : "This ticket has been created but no messages have been added. Be the first to respond to start the conversation."}
      </p>

      {!closed && (
        <div className="mt-6 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button
            type="button"
            onClick={onReply}
            className="h-10 gap-2 rounded-lg bg-brand-accent px-5 text-sm font-semibold text-brand-accent-foreground shadow-none hover:bg-brand-accent/90"
          >
            <MessageSquare className="size-4" aria-hidden />
            Reply to customer
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onNote}
            className="h-10 gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-slate-800 shadow-none"
          >
            <StickyNote className="size-4" aria-hidden />
            Add internal note
          </Button>
        </div>
      )}
    </div>
  );
}
