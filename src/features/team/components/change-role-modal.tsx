"use client";

import * as React from "react";
import { ArrowRight, Info } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  TEAM_DIALOG_CONTENT,
  TEAM_DIALOG_FOOTER,
  TEAM_DIALOG_TITLE,
  TEAM_MODAL_BUTTON,
  TEAM_MODAL_BUTTON_PRIMARY,
  TEAM_MODAL_CONTROL,
} from "@/features/team/components/modal-buttons";
import {
  TEAM_ROLE_DESCRIPTIONS,
  TEAM_ROLE_VALUES,
  type TeamMember,
  type TeamRole,
} from "@/features/team/team";

interface ChangeRoleModalProps {
  member: TeamMember | null;
  /**
   * Role to open on. Set when the confirmation was triggered by picking a role
   * straight from the row select -- the dialog then confirms that choice
   * instead of making the admin pick it a second time.
   */
  initialRole?: TeamRole | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (member: TeamMember, role: TeamRole) => void;
}

export function ChangeRoleModal({
  member,
  initialRole,
  isPending,
  onOpenChange,
  onConfirm,
}: ChangeRoleModalProps) {
  // Radix keeps the dialog mounted while it animates closed, but the table
  // drops the target the instant it closes. Rendering off `member` alone
  // therefore emptied the box mid-animation and it flashed out as a blank
  // white sheet with nothing but the close cross in it. Keeping the last
  // target lets the dialog animate out still showing what it was showing.
  const [shown, setShown] = React.useState<{
    member: TeamMember;
    role: TeamRole;
  } | null>(null);

  const role = member ? (initialRole ?? member.role) : null;

  if (
    member &&
    role &&
    (shown?.member.id !== member.id || shown.role !== role)
  ) {
    setShown({ member, role });
  }

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-115 ${TEAM_DIALOG_CONTENT}`}>
        {shown && (
          // Keyed by member AND opening role so the select starts on whoever
          // was just opened. One shared dialog otherwise keeps the previous
          // selection and "Update role" would quietly apply the wrong one.
          <ChangeRoleFields
            key={`${shown.member.id}:${shown.role}`}
            member={shown.member}
            initialRole={shown.role}
            isPending={isPending}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChangeRoleFields({
  member,
  initialRole,
  isPending,
  onCancel,
  onConfirm,
}: {
  member: TeamMember;
  initialRole: TeamRole;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (member: TeamMember, role: TeamRole) => void;
}) {
  const [role, setRole] = React.useState<TeamRole>(initialRole);
  const changed = role !== member.role;

  return (
    <>
      <DialogHeader className="pr-6">
        <DialogTitle className={TEAM_DIALOG_TITLE}>Change role</DialogTitle>
        <DialogDescription>
          {`Change the role for ${member.email || member.name}'s role.`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <span className="text-xs font-semibold text-muted-foreground">
          Current
        </span>
        <span className="text-sm font-semibold">{member.role}</span>
        <ArrowRight
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="text-xs font-semibold text-muted-foreground">New</span>
        <span
          className={`text-sm font-semibold ${
            changed ? "text-brand-accent" : "text-muted-foreground"
          }`}
        >
          {role}
        </span>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="change-role" className="text-sm font-semibold">
          Role
        </Label>
        <Select
          value={role}
          onValueChange={(value) => setRole(value as TeamRole)}
        >
          <SelectTrigger
            id="change-role"
            className={`w-full ${TEAM_MODAL_CONTROL}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            align="start"
            position="popper"
            className="p-1"
          >
            {TEAM_ROLE_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ModalNotice icon={Info} tone="neutral" title={role}>
        <span className="text-xs leading-[1.55]">
          {TEAM_ROLE_DESCRIPTIONS[role]}
        </span>
      </ModalNotice>

      <DialogFooter className={TEAM_DIALOG_FOOTER}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={onCancel}
          className={TEAM_MODAL_BUTTON}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isPending || !changed}
          onClick={() => onConfirm(member, role)}
          className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_PRIMARY}`}
        >
          {isPending ? "Updating…" : "Update role"}
        </Button>
      </DialogFooter>
    </>
  );
}
