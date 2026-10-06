"use client";

import React from "react";
import { CircleAlert } from "lucide-react";
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
  TEAM_MODAL_BUTTON_DANGER,
} from "@/features/team/components/modal-buttons";

export function DeletePolicyDialog({
  policyName,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  /** Null while closed; the last name is held so the copy survives the exit. */
  policyName: string | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [shown, setShown] = React.useState(policyName);
  if (policyName && policyName !== shown) {
    setShown(policyName);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`gap-3 sm:max-w-115 ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            Delete SLA policy
          </DialogTitle>
          <DialogDescription>
            Delete &ldquo;{shown ?? "this policy"}&rdquo;?
          </DialogDescription>
        </DialogHeader>

        <ModalNotice icon={CircleAlert} tone="danger" title="What happens next">
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-normal">
            <li>Its response and resolution targets are removed.</li>
            <li>Business hours and holidays are kept.</li>
            <li>This can&apos;t be undone.</li>
          </ul>
        </ModalNotice>

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className={TEAM_MODAL_BUTTON}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={onConfirm}
            className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_DANGER}`}
          >
            {pending ? "Deleting…" : "Delete policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
