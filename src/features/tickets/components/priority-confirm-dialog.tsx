"use client";

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
import { ModalNotice } from "@/components/shared/modal-notice";
import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_PRIMARY,
} from "@/features/team/components/modal-buttons";
import { cn } from "@/lib/utils";
import { TICKET_PRIORITY_LABELS, TicketPriority } from "../types/tickets.types";

/**
 * Confirms a lowered priority before it is saved. No reason is asked for;
 * change_ticket_priority still keeps due-soon deadlines and audits the change.
 */
export function PriorityConfirmDialog({
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
  onConfirm: () => void;
}) {
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
          "w-[calc(100%-2rem)] max-w-lg min-w-0 overflow-hidden sm:max-w-lg",
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
              : "This ticket will drop in priority."}
          </DialogDescription>
        </DialogHeader>

        <div className="w-full min-w-0">
          <ModalNotice icon={Info} tone="amber">
            <span className="block min-w-0 whitespace-normal wrap-break-word">
              An SLA timer that is due soon keeps its current deadline, and a
              breach already recorded stays on record.
            </span>
          </ModalNotice>
        </div>

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
            type="button"
            autoFocus
            disabled={pending}
            className={cn(TEAM_MODAL_BUTTON, TEAM_MODAL_BUTTON_PRIMARY)}
            onClick={onConfirm}
          >
            {pending ? "Saving…" : "Lower priority"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
