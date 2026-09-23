"use client";

import { CircleAlert } from "lucide-react";

import * as React from "react";

import { ModalNotice } from "@/components/shared/modal-notice";
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
import type { TeamMember } from "@/features/team/types/team";

interface RemoveMemberModalProps {
  member: TeamMember | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (member: TeamMember) => void;
}

export function RemoveMemberModal({
  member,
  isPending,
  onOpenChange,
  onConfirm,
}: RemoveMemberModalProps) {
  // Radix animates the dialog closed after the table has already dropped the
  // target, so reading straight off `member` swapped the copy to its fallback
  // ("this member", and invite wording back to removal wording) for the length
  // of the exit. Hold the last target and animate out on that.
  const [shown, setShown] = React.useState<TeamMember | null>(null);

  if (member && member !== shown) {
    setShown(member);
  }
  const isInvite = shown?.status === "Invited";
  const who = shown ? shown.email || shown.name : "this member";

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent className={`gap-3 sm:max-w-115 ${TEAM_DIALOG_CONTENT}`}>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            {isInvite ? "Revoke invitation" : "Remove member"}
          </DialogTitle>
          <DialogDescription>
            {isInvite
              ? `Revoke the invitation for ${who}?`
              : `Remove ${who} from this workspace?`}
          </DialogDescription>
        </DialogHeader>

        <ModalNotice icon={CircleAlert} tone="danger" title="What happens next">
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-[1.5]">
            {isInvite ? (
              <>
                <li>The invitation link will stop working.</li>
                <li>The reserved seat will be released.</li>
                <li>You can invite them again later.</li>
              </>
            ) : (
              <>
                <li>They will immediately lose access to the workspace.</li>
                <li>Their tickets, comments and other data will remain.</li>
                <li>You can invite them again later.</li>
              </>
            )}
          </ul>
        </ModalNotice>

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
            disabled={isPending || !member}
            onClick={() => member && onConfirm(member)}
            className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_DANGER}`}
          >
            {isPending
              ? "Removing…"
              : isInvite
                ? "Revoke invitation"
                : "Remove member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
