"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_DANGER,
} from "@/features/team/components/modal-buttons";

/**
 * "Leave without saving?" popup for useUnsavedChangesGuard. Same look as the
 * Branding page's discard confirm.
 */
export function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
  description = "Your changes haven't been saved. If you leave this page now, they will be lost.",
}: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onStay()}>
      <DialogContent className={`gap-3 sm:max-w-115 ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            Leave without saving?
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onStay}
            className={TEAM_MODAL_BUTTON}
          >
            Stay on page
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLeave}
            className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_DANGER}`}
          >
            Leave page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
