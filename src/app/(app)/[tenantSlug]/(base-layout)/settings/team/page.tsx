import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InviteMemberModal } from "@/features/team/components/invite-member-modal";
import { PermissionMatrixModal } from "@/features/team/components/permission-matrix-modal";
import { SeatUsage } from "@/features/team/components/seat-usage";
import { TeamTable } from "@/features/team/components/team-table";
import {
  canPerformTeamAction,
  countByStatus,
} from "@/features/team/types/team";
import {
  getCallerRole,
  getTeamSeats,
  listTeamMembers,
  serverNow,
} from "@/features/team/services/team.service";

// No canonical: every route lives under /[tenantSlug]/, so a bare
// "/settings/team" pointed browsers and crawlers at a 404.
export const metadata: Metadata = {
  title: "Team & roles",
};

export default async function TeamAndRolesPage() {
  // Gate on the server, before anything is read. The only other guard is
  // RoleRouteGuard, which runs in a useEffect after the page has rendered --
  // by then the whole roster has already been sent to the browser.
  const callerRole = await getCallerRole();

  if (callerRole !== "Tenant Admin" && callerRole !== "Manager") {
    notFound();
  }

  const [members, seats, now] = await Promise.all([
    listTeamMembers(),
    getTeamSeats(),
    serverNow(),
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
            {canInvite && (
              <InviteMemberModal seats={seats} callerRole={callerRole} />
            )}
            <PermissionMatrixModal />
          </div>
        </div>

        <SeatUsage seats={seats} counts={counts} />

        <TeamTable
          members={members}
          callerRole={callerRole}
          seats={seats}
          now={now}
        />
      </div>
    </div>
  );
}
