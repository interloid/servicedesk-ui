"use client";

import { ArrowRight, Code, Copy, FileText, X } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatRelativeTime, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_TITLE,
} from "@/features/team/components/modal-buttons";
import { AUDIT_ACTION_ICONS } from "@/features/audit/components/audit-icons";
import {
  AUDIT_ACTION_BADGE,
  AUDIT_ACTION_LABELS,
  AUDIT_MODULE_BADGE,
  AUDIT_MODULE_LABELS,
  AUDIT_RESULT_BADGE,
  AUDIT_RESULT_LABELS,
  formatAuditTimestamp,
  type AuditEvent,
} from "@/features/audit/types/audit";

export async function copyText(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error(`Couldn't copy the ${what.toLowerCase()}.`);
  }
}

function CopyButton({ value, what }: { value: string; what: string }) {
  return (
    <Button
      variant="outline"
      size="icon"
      className="size-7 shrink-0 rounded-md shadow-none"
      aria-label={`Copy ${what.toLowerCase()}`}
      onClick={() => copyText(value, what)}
    >
      <Copy className="size-3.5" aria-hidden />
    </Button>
  );
}

function Row({
  label,
  children,
  stacked,
}: {
  label: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "gap-2",
        stacked
          ? "flex flex-col"
          : "grid grid-cols-[7rem_minmax(0,1fr)] items-center",
      )}
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/**
 * Everything recorded about one event. Drawn in the docked panel on wide
 * screens and in a sheet on narrow ones, so it takes no layout of its own
 * beyond a scrolling column.
 */
export function AuditEventDetails({
  event,
  timeZone,
  now,
  onClose,
  showClose = true,
}: {
  event: AuditEvent;
  timeZone: string;
  now: number;
  onClose: () => void;
  showClose?: boolean;
}) {
  const ActionIcon = AUDIT_ACTION_ICONS[event.action];
  const relative = formatRelativeTime(event.createdAt, now);
  const failed = event.result === "failure";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
        <h2 className="text-lg font-semibold tracking-tight">Event details</h2>
        {showClose && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:bg-transparent hover:text-foreground"
            aria-label="Close event details"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <div className="flex items-start gap-3 border-b border-border pb-4">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full",
              failed
                ? "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
            )}
          >
            <ActionIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold break-words">{event.summary}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatAuditTimestamp(event.createdAt, timeZone)}
              {relative ? ` (${relative})` : ""}
            </p>
          </div>
        </div>

        <dl className="flex flex-col gap-3.5 py-4">
          <Row label="Result">
            <Badge className={AUDIT_RESULT_BADGE[event.result]}>
              {AUDIT_RESULT_LABELS[event.result]}
            </Badge>
          </Row>

          <Row label="User">
            {event.actor ? (
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-8">
                  {event.actor.avatarUrl && (
                    <AvatarImage src={event.actor.avatarUrl} alt="" />
                  )}
                  <AvatarFallback className="text-xs font-semibold">
                    {getInitials(event.actor.name, event.actor.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-medium">{event.actor.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {event.actor.role ?? event.actor.email}
                  </p>
                </div>
              </div>
            ) : (
              <span className="text-muted-foreground">System</span>
            )}
          </Row>

          <Row label="Module">
            <Badge className={AUDIT_MODULE_BADGE[event.module]}>
              {AUDIT_MODULE_LABELS[event.module]}
            </Badge>
          </Row>

          <Row label="Action">
            <Badge className={cn("gap-1", AUDIT_ACTION_BADGE[event.action])}>
              <ActionIcon className="size-3" aria-hidden />
              {AUDIT_ACTION_LABELS[event.action]}
            </Badge>
          </Row>

          <Row label="IP address">
            {event.ip ? (
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-[13px]">
                  {event.ip}
                </span>
                <CopyButton value={event.ip} what="IP address" />
              </div>
            ) : (
              <span className="text-muted-foreground">Not recorded</span>
            )}
          </Row>

          <Row label="User agent" stacked>
            {event.userAgent ? (
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate" title={event.userAgent}>
                  {event.userAgent}
                </span>
                <CopyButton value={event.userAgent} what="User agent" />
              </div>
            ) : (
              <span className="text-muted-foreground">Not recorded</span>
            )}
          </Row>
        </dl>

        <div className="rounded-xl border border-border bg-muted/40 p-3.5">
          <p className="text-sm font-semibold">Details</p>
          <p className="mt-1 text-sm break-words text-muted-foreground">
            {event.summary}
          </p>
        </div>

        {event.changes.length > 0 && (
          <section className="mt-5">
            <h3 className="text-sm font-semibold">Changes</h3>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Previous value
                </p>
                {event.changes.map((change) => (
                  <p key={change.field} className="text-xs break-words">
                    <span className="text-muted-foreground">
                      {change.label}:
                    </span>{" "}
                    {change.from}
                  </p>
                ))}
              </div>
              <ArrowRight
                className="size-4 self-center text-muted-foreground"
                aria-hidden
              />
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                <p className="mb-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  New value
                </p>
                {event.changes.map((change) => (
                  <p key={change.field} className="text-xs break-words">
                    <span className="text-muted-foreground">
                      {change.label}:
                    </span>{" "}
                    {change.to}
                  </p>
                ))}
              </div>
            </div>
          </section>
        )}

        {event.related && (
          <section className="mt-5">
            <h3 className="text-sm font-semibold">Related resources</h3>
            <div className="mt-2 flex items-center gap-3">
              <FileText
                className="size-5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="text-sm">{event.related.label}</span>
              <span className="ml-auto min-w-0 truncate font-mono text-xs text-muted-foreground">
                {event.related.value}
              </span>
              <CopyButton value={event.related.value} what="Resource ID" />
            </div>
          </section>
        )}

        <RawDataDialog event={event} />
      </div>
    </div>
  );
}

function RawDataDialog({ event }: { event: AuditEvent }) {
  const raw = JSON.stringify(
    {
      id: event.id,
      created_at: event.createdAt,
      action: event.action,
      module: event.module,
      result: event.result,
      entity: event.entity,
      entity_id: event.entityId,
      actor_id: event.actor?.id ?? null,
      ip: event.ip,
      user_agent: event.userAgent,
      meta: event.meta,
    },
    null,
    2,
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="mt-6 h-10 w-full gap-2 rounded-lg font-semibold shadow-none"
        >
          <Code className="size-4" aria-hidden />
          View raw data
        </Button>
      </DialogTrigger>
      <DialogContent className={`sm:max-w-2xl ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            Raw event data
          </DialogTitle>
          <DialogDescription>
            The event exactly as it was recorded.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
          {raw}
        </pre>
        <div className="flex justify-end">
          <Button
            variant="outline"
            className="h-10 gap-2 rounded-lg font-semibold shadow-none"
            onClick={() => copyText(raw, "Raw data")}
          >
            <Copy className="size-4" aria-hidden />
            Copy JSON
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
