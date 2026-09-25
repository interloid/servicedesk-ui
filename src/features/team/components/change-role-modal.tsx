"use client";

import * as React from "react";
import { ArrowRight, Crown, Info, TriangleAlert } from "lucide-react";

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
} from "@/features/team/types/team";

interface ChangeRoleModalProps {
  member: TeamMember | null;
  /**
   * Role to open on. Set when the confirmation was triggered by picking a role
   * straight from the row select -- the dialog then confirms that choice
   * instead of making the admin pick it a second time.
   */
  initialRole?: TeamRole | null;
  primaryOnly?: boolean;
  /** The roles this caller may hand out. Defaults to all of them. */
  roles?: readonly TeamRole[];
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (member: TeamMember, role: TeamRole) => void;
  /**
   * Set only when the caller owns the workspace. Offers "Mark as primary"
   * while Tenant Admin is the chosen role, which hands ownership over.
   */
  onMakePrimary?: (member: TeamMember) => void;
}

export function ChangeRoleModal({
  member,
  initialRole,
  primaryOnly = false,
  roles = TEAM_ROLE_VALUES,
  isPending,
  onOpenChange,
  onConfirm,
  onMakePrimary,
}: ChangeRoleModalProps) {
  // Radix keeps the dialog mounted while it animates closed, but the table
  // drops the target the instant it closes. Rendering off `member` alone
  // therefore emptied the box mid-animation and it flashed out as a blank
  // white sheet with nothing but the close cross in it. Keeping the last
  // target lets the dialog animate out still showing what it was showing.
  const [shown, setShown] = React.useState<{
    member: TeamMember;
    role: TeamRole;
    primaryOnly: boolean;
  } | null>(null);

  const role = member ? (initialRole ?? member.role) : null;

  if (
    member &&
    role &&
    (shown?.member.id !== member.id ||
      shown.role !== role ||
      shown.primaryOnly !== primaryOnly)
  ) {
    setShown({ member, role, primaryOnly });
  }

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-115 ${TEAM_DIALOG_CONTENT}`}>
        {shown && (
          // Keyed by member AND opening role so the select starts on whoever
          // was just opened. One shared dialog otherwise keeps the previous
          // selection and "Update role" would quietly apply the wrong one.
          <ChangeRoleFields
            key={`${shown.member.id}:${shown.role}:${shown.primaryOnly ? "primary" : "role"}`}
            member={shown.member}
            initialRole={shown.role}
            primaryOnly={shown.primaryOnly}
            roles={roles}
            isPending={isPending}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
            onMakePrimary={onMakePrimary}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChangeRoleFields({
  member,
  initialRole,
  primaryOnly,
  roles,
  isPending,
  onCancel,
  onConfirm,
  onMakePrimary,
}: {
  member: TeamMember;
  initialRole: TeamRole;
  primaryOnly: boolean;
  roles: readonly TeamRole[];
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (member: TeamMember, role: TeamRole) => void;
  onMakePrimary?: (member: TeamMember) => void;
}) {
  const [role, setRole] = React.useState<TeamRole>(initialRole);
  // Second step of "Mark as primary": the footer asks before handing over.
  const [confirmingPrimary, setConfirmingPrimary] = React.useState(primaryOnly);
  const changed = role !== member.role;
  // Only an active member can own the workspace, and only as a Tenant Admin.
  const canMakePrimary =
    onMakePrimary !== undefined &&
    member.status === "Active" &&
    role === "Tenant Admin";
  const who = member.name || member.email;

  if (primaryOnly || confirmingPrimary) {
    return (
      <>
        <DialogHeader className="pr-6">
          <DialogTitle className={TEAM_DIALOG_TITLE}>
            Mark as primary
          </DialogTitle>
          <DialogDescription>
            {`Make ${who} the primary owner of this workspace?`}
          </DialogDescription>
        </DialogHeader>

        <ModalNotice
          icon={TriangleAlert}
          tone="amber"
          title="What happens next"
        >
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-normal">
            {member.role !== "Tenant Admin" && (
              <li>{who} will become a Tenant Admin.</li>
            )}
            <li>
              {who} will own the workspace. Nobody else can change, disable or
              remove them.
            </li>
            <li>
              You stay a Tenant Admin, but other admins will be able to change
              your role or remove you.
            </li>
            <li>Only {who} can move ownership again.</li>
          </ul>
        </ModalNotice>

        <DialogFooter className={TEAM_DIALOG_FOOTER}>
          {!primaryOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setConfirmingPrimary(false)}
              className={TEAM_MODAL_BUTTON}
            >
              Back
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={isPending || onMakePrimary === undefined}
            onClick={() => onMakePrimary?.(member)}
            className={`${TEAM_MODAL_BUTTON} ${TEAM_MODAL_BUTTON_PRIMARY}`}
          >
            {isPending ? "Updating…" : "Confirm"}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader className="pr-6">
        <DialogTitle className={TEAM_DIALOG_TITLE}>Change role</DialogTitle>
        <DialogDescription>
          {`Choose a new role for ${member.email || member.name}.`}
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
            className={`w-full min-h-10 ${TEAM_MODAL_CONTROL}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            side="bottom"
            align="start"
            position="popper"
            className="p-1"
          >
            {roles.map((value) => (
              <SelectItem
                key={value}
                value={value}
                className="p-2 cursor-pointer"
              >
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
        {canMakePrimary && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => setConfirmingPrimary(true)}
            className={TEAM_MODAL_BUTTON}
          >
            <Crown className="size-4" aria-hidden />
            Mark as primary
          </Button>
        )}
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
