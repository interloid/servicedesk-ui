"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  FilterX,
  MailPlus,
  MoreHorizontalIcon,
  Pause,
  Play,
  Search,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  TEAM_ROLE_VALUES,
  TEAM_STATUS_VALUES,
  assignableRoles,
  canEditMemberWithRole,
  canPerformTeamAction,
  formatAbsoluteDate,
  formatRelativeTime,
  hasSeatLeft,
  roleWithArticle,
  type TeamMember,
  type TeamRole,
  type TeamSeats,
  type TeamStatus,
} from "@/features/team/types/team";
import {
  changeMemberRoleAction,
  changeMemberStatusAction,
  removeMemberAction,
  resendInviteAction,
  transferOwnershipAction,
} from "@/features/team/team-actions";
import { ChangeRoleModal } from "@/features/team/components/change-role-modal";
import { RemoveMemberModal } from "@/features/team/components/remove-member-modal";

const PAGE_SIZE = 10;

const TH =
  "h-9 px-4 text-xs font-bold tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase";

const TEAM_STATUS_BADGE: Record<TeamStatus, string> = {
  Active:
    "border-none bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  Invited:
    "border-none bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  Disabled: "border-none bg-muted text-muted-foreground",
};

function getInitials(name: string, email: string): string {
  if (name && name.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  if (email) {
    return email.charAt(0).toUpperCase();
  }

  return "?";
}

/** The timestamp line under a status badge, or null when there is nothing to say. */
function statusDetail(member: TeamMember, now: number): string | null {
  if (member.status === "Invited") {
    const when = formatRelativeTime(member.invitedAt, now);
    return when ? `Invited ${when}` : null;
  }

  if (member.status === "Disabled") {
    const when = formatRelativeTime(member.disabledAt, now);
    return when ? `Deactivated ${when}` : null;
  }

  return null;
}

interface TeamTableProps {
  members: TeamMember[];
  callerRole: TeamRole | null;
  /** Used to block re-enabling a disabled member when every seat is taken. */
  seats: TeamSeats;
  /**
   * The server's clock at render time. Reading Date.now() here instead would
   * give the server render and the hydration that follows two different
   * answers, and a row that crosses a minute boundary between them trips a
   * hydration mismatch.
   */
  now: number;
}

/** Invited accounts start out named after their email prefix, so fall back to the address. */
function displayName(member: TeamMember): string {
  return member.name.trim() || member.email;
}

interface RowAction {
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  /** Why the action can't run. The item stays, greyed out, with this as its tooltip. */
  blockedReason?: string;
  run: () => void;
}

export function TeamTable({ members, callerRole, seats, now }: TeamTableProps) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<TeamStatus | "All">(
    "All",
  );
  const [roleFilter, setRoleFilter] = React.useState<TeamRole | "All">("All");
  const [page, setPage] = React.useState(1);
  const [roleTarget, setRoleTarget] = React.useState<{
    member: TeamMember;
    role: TeamRole | null;
    primaryOnly?: boolean;
  } | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<TeamMember | null>(
    null,
  );

  /**
   * `failure` is the "We couldn't …" line for this action. The server usually
   * sends a more specific reason, so it's only used when it doesn't, or when
   * the request never came back.
   */
  const run = (
    memberId: string,
    action: () => Promise<unknown>,
    { success, failure }: { success: string; failure: string },
    onDone?: () => void,
  ) => {
    setPendingId(memberId);
    startTransition(async () => {
      try {
        const result = await action();
        if (
          result &&
          typeof result === "object" &&
          "ok" in result &&
          !result.ok
        ) {
          const message =
            (result as { message?: string }).message ?? `${failure} Try again.`;
          toast.error(message);
        } else {
          toast.success(success);
          onDone?.();
        }
      } catch (error) {
        // A dropped connection or a deploy mid-request rejects the call
        // itself. Without this the row just went quiet: no toast either way.
        console.error("[team] action failed", error);
        toast.error(`${failure} Check your connection and try again.`);
      } finally {
        setPendingId(null);
      }
    });
  };

  const canRole = callerRole ? canPerformTeamAction("role", callerRole) : false;
  // A Manager may only hand out and edit the non-admin roles; the server
  // enforces the same rule.
  const rolesToOffer = assignableRoles(callerRole);
  const canEdit = (member: TeamMember) =>
    !member.isSelf &&
    !member.isPrimary &&
    canEditMemberWithRole(callerRole, member.role);
  const canRemove = callerRole
    ? canPerformTeamAction("remove", callerRole)
    : false;
  const canResend = callerRole
    ? canPerformTeamAction("resend", callerRole)
    : false;
  const canRevoke = callerRole
    ? canPerformTeamAction("revoke", callerRole)
    : false;
  const canStatus = callerRole
    ? canPerformTeamAction("status", callerRole)
    : false;
  // Only the owner can hand the workspace over; the database checks the same.
  const callerIsPrimary = members.some(
    (member) => member.isSelf && member.isPrimary,
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((member) => {
      if (statusFilter !== "All" && member.status !== statusFilter)
        return false;
      if (roleFilter !== "All" && member.role !== roleFilter) return false;
      if (
        q &&
        !member.name.toLowerCase().includes(q) &&
        !member.email.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [members, query, statusFilter, roleFilter]);

  const hasActiveFilters =
    query.trim() !== "" || statusFilter !== "All" || roleFilter !== "All";

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageMembers = filtered.slice(start, start + PAGE_SIZE);

  const isPaginated = filtered.length > PAGE_SIZE;

  const goTo = (target: number) =>
    setPage(Math.min(totalPages, Math.max(1, target)));

  const changeRole = (member: TeamMember, role: TeamRole) =>
    run(
      member.id,
      () => changeMemberRoleAction({ memberId: member.id, role }),
      {
        success: `${displayName(member)} is now ${roleWithArticle(role)}.`,
        failure: `We couldn't change ${displayName(member)}'s role.`,
      },
      () => setRoleTarget(null),
    );

  const removeMember = (member: TeamMember) =>
    run(
      member.id,
      () => removeMemberAction({ memberId: member.id }),
      member.status === "Invited"
        ? {
            success: `Invitation to ${member.email} revoked. Their invite link no longer works.`,
            failure: `We couldn't revoke the invitation to ${member.email}.`,
          }
        : {
            success: `${displayName(member)} was removed from the team and no longer has access.`,
            failure: `We couldn't remove ${displayName(member)}.`,
          },
      () => setRemoveTarget(null),
    );

  const transferOwnership = (member: TeamMember) =>
    run(
      member.id,
      () => transferOwnershipAction({ memberId: member.id }),
      {
        success: `${displayName(member)} now owns this workspace.`,
        failure: `We couldn't transfer ownership to ${displayName(member)}.`,
      },
      () => setRoleTarget(null),
    );

  const buildRowActions = (member: TeamMember): RowAction[] => {
    const actions: RowAction[] = [];

    if (member.status === "Invited") {
      if (canResend) {
        actions.push({
          label: "Resend invite",
          icon: MailPlus,
          run: () =>
            run(member.id, () => resendInviteAction({ memberId: member.id }), {
              success: `Invite resent to ${member.email}.`,
              failure: `We couldn't resend the invite to ${member.email}.`,
            }),
        });
      }
      if (canRevoke && canEdit(member)) {
        actions.push({
          label: "Revoke invitation",
          icon: Trash2,
          destructive: true,
          run: () => setRemoveTarget(member),
        });
      }

      return actions;
    }

    if (
      callerIsPrimary &&
      member.role === "Tenant Admin" &&
      member.status === "Active" &&
      canEdit(member)
    ) {
      actions.push({
        label: "Make primary",
        icon: Crown,
        run: () => setRoleTarget({ member, role: null, primaryOnly: true }),
      });
    }

    if (canStatus && canEdit(member)) {
      const disabled = member.status === "Disabled";
      actions.push({
        label: disabled ? "Activate member" : "Deactivate member",
        icon: disabled ? Play : Pause,
        // Disabled members don't hold a seat, so turning one back on takes
        // one. The server re-checks this; the menu only explains it.
        blockedReason:
          disabled && !hasSeatLeft(seats)
            ? "No seats available. Free a seat or upgrade."
            : undefined,
        run: () =>
          run(
            member.id,
            () =>
              changeMemberStatusAction({
                memberId: member.id,
                status: disabled ? "Active" : "Disabled",
              }),
            disabled
              ? {
                  success: `${displayName(member)} is active again.`,
                  failure: `We couldn't activate ${displayName(member)}.`,
                }
              : {
                  success: `${displayName(member)} was deactivated and has no access until you activate them again.`,
                  failure: `We couldn't deactivate ${displayName(member)}.`,
                },
          ),
      });
    }

    if (canRemove && canEdit(member)) {
      actions.push({
        label: "Remove member",
        icon: Trash2,
        destructive: true,
        run: () => setRemoveTarget(member),
      });
    }

    return actions;
  };

  /* ---- Cell contents, shared by the table and the narrow-screen cards ---- */

  const renderIdentity = (member: TeamMember) => (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-9 shrink-0">
        <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
        <AvatarFallback className="bg-brand-accent/10 text-xs font-semibold text-brand-accent">
          {getInitials(member.name, member.email)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
          <span className="truncate">{member.name}</span>
          {member.isPrimary && (
            <Badge className="h-5 shrink-0 gap-1 border-none bg-brand-accent/10 px-1.5 text-[11px] font-semibold text-brand-accent">
              <Crown className="size-3" aria-hidden />
              Owner
            </Badge>
          )}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {member.email}
        </span>
      </div>
    </div>
  );

  const renderStatus = (member: TeamMember) => {
    const detail = statusDetail(member, now);

    return (
      <div className="flex flex-col items-start gap-1">
        <Badge
          className={`h-6 px-2.5 text-xs font-semibold ${TEAM_STATUS_BADGE[member.status]}`}
        >
          {member.status}
        </Badge>
        {detail && (
          // The cell doesn't wrap by default; this line may need to.
          <span className="flex items-start gap-1 text-xs whitespace-normal text-muted-foreground">
            <Clock className="mt-0.5 size-3 shrink-0" aria-hidden />
            {detail}
          </span>
        )}
      </div>
    );
  };

  const renderRole = (member: TeamMember, busy: boolean) => {
    if (!canRole || !canEdit(member)) {
      return (
        <span className="text-sm font-semibold text-foreground">
          {member.role}
        </span>
      );
    }

    return (
      <Select
        value={member.role}
        onValueChange={(role) => {
          if (role === member.role) return;
          // Confirm first. The select stays on the server value until the
          // change actually lands, so a cancelled dialog leaves the row
          // untouched.
          setRoleTarget({ member, role: role as TeamRole });
        }}
      >
        <SelectTrigger
          aria-label={`Role for ${member.name}`}
          className="min-h-10 w-full max-w-52.5 min-w-0"
          disabled={busy}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          side="bottom"
          align="start"
          position="popper"
          className="p-1"
        >
          {rolesToOffer.map((role) => (
            <SelectItem key={role} value={role} className="p-2 cursor-pointer">
              {role}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  const renderJoined = (member: TeamMember) => {
    const joined = formatAbsoluteDate(member.joinedAt);

    if (!joined) {
      // An invite that has not been accepted has no join date yet. The owner
      // row has none either, and its bare dash reads better centred in the
      // column than hanging off the left edge.
      if (member.status === "Invited") {
        return (
          <span className="text-sm text-muted-foreground">Not yet joined</span>
        );
      }

      return (
        <span className="block text-center text-sm text-muted-foreground">
          —
        </span>
      );
    }

    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium whitespace-nowrap text-foreground">
          {joined}
        </span>
      </div>
    );
  };

  /**
   * Same menu button as every other row, switched off, with the reason on
   * hover -- so a locked row explains itself instead of reading as a missing
   * action.
   */
  const renderLockedActions = (member: TeamMember, reason: string) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button fires no pointer events, so the span
              carries the hover and keyboard focus for the tooltip. */}
          <span tabIndex={0} className="inline-flex rounded-lg">
            <Button
              variant="ghost"
              size="icon"
              disabled
              aria-label={`Actions for ${member.name} (${reason})`}
              className="size-9 cursor-pointer rounded-lg border border-none text-muted-foreground"
            >
              <MoreHorizontalIcon />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={0} className="translate-y-0">
          {reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const renderActions = (member: TeamMember, busy: boolean) => {
    if (member.isSelf) {
      return renderLockedActions(member, "You can't change your own role.");
    }

    if (member.isPrimary) {
      return renderLockedActions(member, "Tenant owner cannot be updated.");
    }

    const rowActions = buildRowActions(member);

    if (rowActions.length === 0) {
      return (
        <span
          className="inline-flex size-9 items-center justify-center text-sm text-muted-foreground"
          aria-label="No actions available"
        >
          Nil
        </span>
      );
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Actions for ${member.name}`}
            className="size-9 rounded-lg border border-none text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <TooltipProvider>
            {rowActions.map((action) => {
              const Icon = action.icon;

              if (!action.blockedReason) {
                return (
                  <DropdownMenuItem
                    key={action.label}
                    variant={action.destructive ? "destructive" : "default"}
                    disabled={busy}
                    onSelect={action.run}
                    className="p-2 cursor-pointer"
                  >
                    <Icon />
                    {action.label}
                  </DropdownMenuItem>
                );
              }

              // Not `disabled`: a disabled item takes no pointer events, so
              // its tooltip would never open. It looks and acts disabled
              // instead, and selecting it does nothing.
              return (
                <Tooltip key={action.label}>
                  <TooltipTrigger asChild>
                    <DropdownMenuItem
                      aria-disabled
                      onSelect={(event) => event.preventDefault()}
                      // Hovering focuses a menu item, which would light it
                      // up like a live action; `!` beats the base item's
                      // focus colours.
                      className="p-2 cursor-not-allowed opacity-50 focus:bg-transparent! focus:text-popover-foreground! focus:**:text-popover-foreground!"
                    >
                      <Icon />
                      {action.label}
                    </DropdownMenuItem>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {action.blockedReason}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("All");
    setRoleFilter("All");
    setPage(1);
  };

  const emptyMessage = hasActiveFilters
    ? "No members match your filters."
    : "No team members yet.";

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-start xl:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold">Team members</h2>
          <p className="text-sm text-muted-foreground">
            {members.length} {members.length === 1 ? "person" : "people"} on
            your workspace.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:w-65 xl:w-70">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search by name or email..."
              className="h-10 bg-card pl-9 text-sm sm:h-10"
              aria-label="Search members"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as TeamStatus | "All");
                setPage(1);
              }}
            >
              <SelectTrigger
                className="min-h-10 w-full min-w-0 bg-card sm:h-10 sm:w-37.5"
                aria-label="Filter by status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                side="bottom"
                align="start"
                position="popper"
                className="p-1"
              >
                <SelectItem value="All" className="p-2">
                  All statuses
                </SelectItem>
                {TEAM_STATUS_VALUES.map((status) => (
                  <SelectItem
                    key={status}
                    value={status}
                    className="p-2 cursor-pointer"
                  >
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={roleFilter}
              onValueChange={(value) => {
                setRoleFilter(value as TeamRole | "All");
                setPage(1);
              }}
            >
              <SelectTrigger
                className="min-h-10 w-full min-w-0 bg-card sm:h-10 sm:w-40"
                aria-label="Filter by role"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                side="bottom"
                align="start"
                position="popper"
                className="p-1"
              >
                <SelectItem value="All" className="p-2">
                  All roles
                </SelectItem>
                {TEAM_ROLE_VALUES.map((role) => (
                  <SelectItem
                    key={role}
                    value={role}
                    className="p-2 cursor-pointer"
                  >
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className="h-10 bg-card"
            >
              <FilterX className="size-4" />
              Clear filters
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-border bg-card">
        {/* Fixed columns (768px) plus room for a name and email in Member;
            narrower than that and the table scrolls instead of overlapping. */}
        <Table className="min-w-262 table-fixed">
          <TableHeader>
            <TableRow className="h-14 border-border bg-card hover:bg-card">
              {/* No width: Member takes whatever the fixed columns leave. */}
              <TableHead className={TH}>Member</TableHead>

              {/* Fits "Deactivated 3 minutes ago" on one line. */}
              <TableHead className={`${TH} w-62`}>Status</TableHead>

              <TableHead className={`${TH} w-64`}>Role</TableHead>

              <TableHead className={`${TH} w-36`}>Joined</TableHead>

              <TableHead className={`${TH} w-36 text-center`}>
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {pageMembers.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={5}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              pageMembers.map((member) => {
                const busy = isPending && pendingId === member.id;

                return (
                  <TableRow
                    key={member.id}
                    data-busy={busy || undefined}
                    className="border-muted transition-opacity data-busy:opacity-60"
                  >
                    <TableCell className="px-4 py-3.5">
                      {renderIdentity(member)}
                    </TableCell>

                    <TableCell className="px-4 py-3.5 align-middle">
                      {renderStatus(member)}
                    </TableCell>

                    <TableCell className="px-4 py-3.5 align-middle">
                      {renderRole(member, busy)}
                    </TableCell>

                    <TableCell className="px-4 py-3.5 align-middle">
                      {renderJoined(member)}
                    </TableCell>

                    <TableCell className="px-4 py-3.5 text-center align-middle">
                      <div className="flex justify-center">
                        {renderActions(member, busy)}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col items-center justify-between gap-3 px-1 text-sm text-muted-foreground sm:flex-row">
        <span className="text-center sm:text-left">
          Showing{" "}
          {filtered.length === 0
            ? 0
            : `${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)}`}{" "}
          of {filtered.length} {filtered.length === 1 ? "person" : "people"}
          {hasActiveFilters ? " matching your filters" : ""}.
        </span>
        {isPaginated && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => goTo(safePage - 1)}
            >
              <ChevronLeft />
              Previous
            </Button>
            <span className="min-w-18 text-center text-xs">
              Page {safePage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => goTo(safePage + 1)}
            >
              Next
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>

      <ChangeRoleModal
        member={roleTarget?.member ?? null}
        initialRole={roleTarget?.role ?? null}
        isPending={isPending && pendingId === roleTarget?.member.id}
        onOpenChange={(open) => !open && setRoleTarget(null)}
        roles={rolesToOffer}
        onConfirm={changeRole}
        primaryOnly={roleTarget?.primaryOnly}
        onMakePrimary={callerIsPrimary ? transferOwnership : undefined}
      />

      <RemoveMemberModal
        member={removeTarget}
        isPending={isPending && pendingId === removeTarget?.id}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        onConfirm={removeMember}
      />
    </div>
  );
}
