"use client";

import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
} from "@/features/team/components/modal-buttons";
import {
  AUDIT_EXPORT_LIMIT,
  AUDIT_MODULE_LABELS,
  type AuditModule,
} from "@/features/audit/types/audit";

const TRACKED: { module: AuditModule; events: string }[] = [
  { module: "authentication", events: "Sign-ins and sign-outs" },
  {
    module: "security",
    events: "Failed sign-ins, ownership transfers, audit log exports",
  },
  {
    module: "team",
    events: "Invitations, role changes, deactivations, removals",
  },
  { module: "customers", events: "Customer invitations and removals" },
  {
    module: "sla",
    events: "SLA policies and business hours created, edited or deleted",
  },
  { module: "billing", events: "Plan changes, cancellations, seat changes" },
  { module: "settings", events: "Workspace name, address and portal branding" },
];

/**
 * How the audit log behaves. Read-only: retention and the tracked events are
 * fixed by the plan, and the time zone follows the workspace's business hours.
 */
export function AuditSettingsDialog({ timeZone }: { timeZone: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-10 gap-2 rounded-lg bg-card px-4 text-sm font-semibold shadow-none"
        >
          <Settings className="size-4" aria-hidden />
          Audit log settings
        </Button>
      </DialogTrigger>

      <DialogContent className={`sm:max-w-xl ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            Audit log settings
          </DialogTitle>
          <DialogDescription>
            What the audit log records and how long it keeps it.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "Retention", value: "12 months" },
            { label: "Time zone", value: timeZone },
            {
              label: "Export limit",
              value: `${AUDIT_EXPORT_LIMIT.toLocaleString("en-US")} events`,
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-border bg-muted/40 p-3"
            >
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-xs text-muted-foreground">
          Times are shown in the time zone of your business hours, which you can
          change under SLA policies.
        </p>

        <div className="overflow-hidden rounded-xl border border-border">
          {TRACKED.map((item) => (
            <div
              key={item.module}
              className="flex flex-col gap-0.5 border-b border-border px-4 py-2.5 last:border-b-0 sm:flex-row sm:gap-4"
            >
              <span className="w-36 shrink-0 text-sm font-medium">
                {AUDIT_MODULE_LABELS[item.module]}
              </span>
              <span className="text-sm text-muted-foreground">
                {item.events}
              </span>
            </div>
          ))}
        </div>

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          <DialogClose asChild>
            <Button variant="outline" className={TEAM_MODAL_BUTTON}>
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
