"use client";

import { useState, useTransition } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ModalNotice } from "@/components/shared/modal-notice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_DANGER,
} from "@/features/team/components/modal-buttons";
import type { SavedView } from "../services/saved-views.service";
import { deleteSavedViewAction } from "../actions/saved-views.actions";

interface DeleteSavedViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: string;
  view: SavedView | null;
}

export default function DeleteSavedViewDialog({
  open,
  onOpenChange,
  tenant,
  view,
}: DeleteSavedViewDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  // Keep the last view so the dialog still shows its name while animating out.
  const [shown, setShown] = useState<SavedView | null>(view);
  if (view && view !== shown) {
    setShown(view);
    setError(undefined);
  }

  const handleDelete = () => {
    if (!shown) return;
    setError(undefined);

    startTransition(async () => {
      const res = await deleteSavedViewAction(tenant, shown.id);
      if (res.success) {
        toast.success(`Deleted "${shown.name}"`);
        onOpenChange(false);
        return;
      }
      setError(res.error);
    });
  };

  return (
    <Dialog
      open={open && shown !== null}
      onOpenChange={(next) => !isPending && onOpenChange(next)}
    >
      <DialogContent className={`gap-3 sm:max-w-115 ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>Delete view</DialogTitle>
          <DialogDescription>
            Delete{" "}
            <span className="font-semibold">&ldquo;{shown?.name}&rdquo;</span>?
          </DialogDescription>
        </DialogHeader>

        <ModalNotice icon={CircleAlert} tone="danger" title="What happens next">
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-[1.5]">
            <li>
              The view is removed for you
              {shown?.is_shared ? " and everyone it was shared with" : ""}.
            </li>
            <li>No tickets are changed or deleted.</li>
            <li>This can&apos;t be undone.</li>
          </ul>
        </ModalNotice>

        {error ? (
          <p role="alert" className="text-xs font-semibold text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
            className={TEAM_MODAL_BUTTON}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={handleDelete}
            className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_DANGER}`}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {isPending ? "Deleting…" : "Delete view"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
