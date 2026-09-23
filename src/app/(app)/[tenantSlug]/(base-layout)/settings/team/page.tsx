import type { Metadata } from "next";

import { Card } from "@/components/ui/card";

import { InviteMemberModal } from "@/features/team/components/invite-member-modal";
import { PermissionMatrixModal } from "@/features/team/components/permission-matrix-modal";
import { SeatUsage } from "@/features/team/components/seat-usage";
import { TeamTable } from "@/features/team/components/team-table";
import { canPerformTeamAction, countByStatus } from "@/features/team/team";
import {
  getCallerRole,
  getTeamSeats,
  listTeamMembers,
} from "@/features/team/services/team.service";

export const metadata: Metadata = {
  title: "Team & roles",
  alternates: {
    canonical: "/settings/team",
  },
};

export default async function TeamAndRolesPage() {
  const [members, seats, callerRole] = await Promise.all([
    listTeamMembers(),
    getTeamSeats(),
    getCallerRole(),
  ]);

  const canInvite = callerRole
    ? canPerformTeamAction("invite", callerRole)
    : false;
  const counts = countByStatus(members);

  return (
    <div className="h-full overflow-y-auto p-4 font-sans text-slate-900 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full flex-col gap-6 sm:gap-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">Team & roles</h1>
            <p className="text-sm text-muted-foreground">
              Manage your workspace members, roles, and access permissions.
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto *:flex-1 sm:*:flex-none">
            {canInvite && <InviteMemberModal seats={seats} />}
            <PermissionMatrixModal />
          </div>
        </div>

        <Card className="rounded-[14px] p-4 sm:p-5">
          <SeatUsage seats={seats} counts={counts} />
        </Card>

        <TeamTable members={members} callerRole={callerRole} />
      </div>
    </div>
  );
}
