"use client";

import { CheckCircle2, Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TicketStatus } from "@/features/tickets/types/tickets.types";

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDay(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const isDone = (s: TicketStatus) => s === "resolved" || s === "closed";

/**
 * Reopen and Close for a resolved or closed ticket. An open ticket is resolved
 * from the Status field in the sidebar.
 */
export function TicketLifecycleActions({
  status,
  disabled,
  onChange,
}: {
  status: TicketStatus;
  disabled?: boolean;
  onChange: (next: TicketStatus) => void;
}) {
  if (!isDone(status)) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => onChange("open")}
        disabled={disabled}
        className="h-9 px-3.5 text-sm font-semibold"
      >
        <RotateCcw className="size-4" aria-hidden />
        Reopen
      </Button>
      {status === "resolved" && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange("closed")}
          disabled={disabled}
          className="h-9 px-3.5 text-sm font-semibold"
        >
          <Lock className="size-4" aria-hidden />
          Close
        </Button>
      )}
    </div>
  );
}

/** What a resolved or closed ticket is waiting for, under the title. */
export function TicketLifecycleBanner({
  status,
  resolvedAt,
  closedAt,
  autoCloseDays,
}: {
  status: TicketStatus;
  resolvedAt: string | null;
  closedAt: string | null;
  autoCloseDays: number;
}) {
  if (status === "resolved") {
    const closesAt =
      resolvedAt && autoCloseDays > 0
        ? new Date(resolvedAt).getTime() + autoCloseDays * DAY_MS
        : null;
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
        <CheckCircle2
          className="mt-px size-4 shrink-0 text-emerald-600"
          aria-hidden
        />
        <p>
          <span className="font-semibold">Resolved</span>
          {resolvedAt && <> {formatDay(new Date(resolvedAt).getTime())}</>}. The
          customer can rate the resolution or reopen it from the portal.
          {closesAt && <> It closes automatically on {formatDay(closesAt)}.</>}
        </p>
      </div>
    );
  }

  if (status === "closed") {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
        <Lock className="mt-px size-4 shrink-0 text-slate-500" aria-hidden />
        <p>
          <span className="font-semibold">Closed</span>
          {closedAt && <> {formatDay(new Date(closedAt).getTime())}</>}. Reopen
          the ticket to reply.
        </p>
      </div>
    );
  }

  return null;
}
