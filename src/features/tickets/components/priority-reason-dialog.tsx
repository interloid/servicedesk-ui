"use client";

import React, { useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ModalNotice } from "@/components/shared/modal-notice";
import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_PRIMARY,
} from "@/features/team/components/modal-buttons";
import { cn } from "@/lib/utils";
import {
  PRIORITY_REASON_MAX,
  TICKET_PRIORITY_LABELS,
  TicketPriority,
} from "../types/tickets.types";

/**
 * Asks why a priority is being lowered. change_ticket_priority refuses a
 * lowered priority without a reason and writes it to the audit log.
 */
export function PriorityReasonDialog({
  open,
  to,
  ticketCount = 1,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** The priority being lowered to. */
  to: TicketPriority | null;
  /** More than one for a bulk change. */
  ticketCount?: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // Start empty every time it opens.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason("");
      setError(null);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return setError("Give a reason for lowering the priority.");
    if (trimmed.length > PRIORITY_REASON_MAX) {
      return setError(
        `Keep the reason under ${PRIORITY_REASON_MAX} characters.`,
      );
    }
    setError(null);
    onConfirm(trimmed);
  };

  const label = to ? TICKET_PRIORITY_LABELS[to] : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <DialogContent
        className={cn(
          "w-[calc(100%-2rem)] max-w-lg min-w-0 overflow-hidden",
          TEAM_DIALOG_CONTENT,
        )}
      >
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            Lower priority to {label}?
          </DialogTitle>

          <DialogDescription className="wrap-break-word">
            {ticketCount > 1
              ? `Some of the ${ticketCount} selected tickets will drop in priority.`
              : "This ticket will drop in priority."}{" "}
            Say why; the reason is saved in the audit log.
          </DialogDescription>
        </DialogHeader>

        <form
          id="priority-reason-form"
          onSubmit={submit}
          className="w-full min-w-0 space-y-4"
        >
          <div className="w-full min-w-0">
            <ModalNotice icon={Info} tone="amber">
              <span className="block min-w-0 whitespace-normal wrap-break-word">
                An SLA timer that is due soon keeps its current deadline, and a
                breach already recorded stays on record.
              </span>
            </ModalNotice>
          </div>

          <div className="w-full min-w-0 space-y-1.5">
            <Label htmlFor="priority-reason" className="text-sm font-semibold">
              Reason <span className="text-red-500">*</span>
            </Label>

            <Textarea
              id="priority-reason"
              rows={3}
              autoFocus
              value={reason}
              maxLength={PRIORITY_REASON_MAX}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer confirmed the workaround is enough for now."
              className="block h-24 max-h-24 w-full min-w-0 resize-none overflow-y-auto whitespace-pre-wrap text-sm"
              style={{
                overflowWrap: "anywhere",
                wordBreak: "normal",
              }}
            />

            <div className="flex w-full min-w-0 items-start justify-between gap-3">
              <p
                className="min-w-0 flex-1 wrap-break-word text-xs text-destructive"
                role="alert"
              >
                {error}
              </p>

              <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {reason.length}/{PRIORITY_REASON_MAX}
              </p>
            </div>
          </div>
        </form>

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            className={TEAM_MODAL_BUTTON}
            onClick={onCancel}
          >
            Cancel
          </Button>

          <Button
            type="submit"
            form="priority-reason-form"
            disabled={pending}
            className={cn(TEAM_MODAL_BUTTON, TEAM_MODAL_BUTTON_PRIMARY)}
          >
            {pending ? "Saving…" : "Lower priority"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
