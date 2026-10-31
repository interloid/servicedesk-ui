"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, FileText } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRelativeTime, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

import { TEAM_DIALOG_TITLE } from "@/features/team/components/modal-buttons";
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
    return true;
  } catch {
    toast.error(`Couldn't copy the ${what.toLowerCase()}.`);
    return false;
  }
}

const COPIED_MS = 2000;

/** Copy, then report `copied` for two seconds so the button can show a tick. */
function useCopy(value: string, what: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (!(await copyText(value, what))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return { copied, copy };
}

function CopyButton({ value, what }: { value: string; what: string }) {
  const { copied, copy } = useCopy(value, what);
  const Icon = copied ? Check : Copy;

  return (
    <Button
      variant="outline"
      size="icon"
      className="size-7 shrink-0 rounded-md shadow-none"
      aria-label={copied ? `${what} copied` : `Copy ${what.toLowerCase()}`}
      onClick={copy}
    >
      <Icon
        className={cn("size-3.5", copied && "text-emerald-600")}
        aria-hidden
      />
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
          : "grid grid-cols-[5.5rem_minmax(0,1fr)] items-center sm:grid-cols-[7rem_minmax(0,1fr)]",
      )}
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/**
 * Everything recorded about one event: the inside of the details popup -- its
 * header and a scrolling body. The caller supplies the
 * Dialog and its DialogContent (with TEAM_DIALOG_CONTENT), so it looks like
 * every other popup in the app; the dialog's own cross closes it.
 */
export function AuditEventDetails({
  event,
  timeZone,
  now,
}: {
  event: AuditEvent;
  timeZone: string;
  now: number;
}) {
  const ActionIcon = AUDIT_ACTION_ICONS[event.action];
  const relative = formatRelativeTime(event.createdAt, now);
  const failed = event.result === "failure";

  return (
    <>
      <DialogHeader className="min-w-0 pr-6">
        <DialogTitle className={TEAM_DIALOG_TITLE}>Event details</DialogTitle>
        <DialogDescription>
          Everything recorded about this event.
        </DialogDescription>
      </DialogHeader>

      {/* Only the body scrolls: the title stays in view. */}
      <div className="-mx-5 max-h-[60vh] min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-5">
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
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-mono text-[13px] break-all">
                  {event.ip}
                </span>
                <CopyButton value={event.ip} what="IP address" />
              </div>
            ) : (
              <span className="text-muted-foreground">Not recorded</span>
            )}
          </Row>

          <Row label="Event ID">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 font-mono text-[13px] break-all">
                {event.id}
              </span>
              <CopyButton value={event.id} what="Event ID" />
            </div>
          </Row>

          <Row label="User agent" stacked>
            {event.userAgent ? (
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-xs break-all text-muted-foreground">
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
      </div>
    </>
  );
}
