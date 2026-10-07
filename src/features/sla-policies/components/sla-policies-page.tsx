"use client";
import React from "react";
import { CalendarDays, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BADGE_TONES, StatusBadge } from "./status-badge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { NewPolicyButton } from "./new-policy-button";
import {
  formatUpdatedDate,
  formatWorkingDays,
  formatWorkingHours,
} from "../format";
import { formatDurationShort } from "../duration";
import {
  SlaPolicy,
  SlaPolicyQuota,
  describePolicyLimit,
  hasPolicyRoom,
} from "../types/types";
import { useRouter } from "next/navigation";

interface SlaPoliciesPageProps {
  tenant: string;
  initialPolicies: SlaPolicy[];
  /** The plan's cap, so the create button can be gated before it's pressed. */
  policyQuota: SlaPolicyQuota;
  /** Agents may look at policies but not create them. */
  canManage: boolean;
}

const COLUMNS = [
  "Policy name",
  "Business hours",
  "SLA targets",
  "Applied to",
  "Updated at",
  "Status",
];

interface ClickablePolicyRowProps {
  href: string;
  children: React.ReactNode;
}

export function ClickablePolicyRow({
  href,
  children,
}: ClickablePolicyRowProps) {
  const router = useRouter();

  const navigate = () => {
    router.push(href);
  };

  return (
    <TableRow
      tabIndex={0}
      role="link"
      onClick={navigate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate();
        }
      }}
      className={cn(
        "cursor-pointer border-gray-100 align-middle",
        "hover:bg-gray-50/70",
        "focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-brand-accent focus-visible:ring-inset",
      )}
    >
      {children}
    </TableRow>
  );
}
/**
 * A Server Component: the list has no client state, so it renders straight
 * from the server's rows and a refresh always shows the latest ones.
 */
export const SlaPoliciesPage: React.FC<SlaPoliciesPageProps> = ({
  tenant,
  initialPolicies: policies,
  policyQuota,
  canManage,
}) => {
  // createSlaPolicy enforces the same cap on the server.
  const canCreate = hasPolicyRoom(policyQuota, policies.length);

  return (
    <div className="h-full overflow-y-auto p-4 font-sans text-slate-900 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full flex-col gap-6 sm:gap-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">SLA policies</h1>

            <p className="text-sm text-muted-foreground">
              Manage response and resolution targets for your support team.
            </p>
          </div>

          {canManage && (
            <NewPolicyButton
              href={`/${tenant}/sla/new`}
              disabledReason={
                canCreate ? null : describePolicyLimit(policyQuota)
              }
            />
          )}
        </div>

        <Card className="gap-0 border border-gray-200/80 bg-white py-0 shadow-xs ring-0">
          <Table className="rounded-none border-0">
            <TableHeader>
              <TableRow className="h-14 border-slate-100 bg-slate-50 hover:bg-slate-50">
                {COLUMNS.map((c) => (
                  <TableHead
                    key={c}
                    className="h-10 px-4 text-[11px] font-bold tracking-wider text-slate-500 uppercase"
                  >
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {policies.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={COLUMNS.length}
                    className="p-8 text-center text-sm text-gray-400"
                  >
                    No SLA policies yet. Create one to start tracking targets.
                  </TableCell>
                </TableRow>
              ) : (
                policies.map((policy) => (
                  <PolicyRow key={policy.id} tenant={tenant} policy={policy} />
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
};

function PolicyRow({ tenant, policy }: { tenant: string; policy: SlaPolicy }) {
  const href = `/${tenant}/sla/${policy.id}`;

  const urgent = policy.targets.find((t) => t.priority_scope === "urgent");

  const low = policy.targets.find((t) => t.priority_scope === "low");

  const calendar = policy.business_hours;

  return (
    <ClickablePolicyRow href={href}>
      <TableCell className="max-w-60 px-4 py-4 align-middle whitespace-normal">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold capitalize text-gray-900 transition-colors group-hover:text-brand-accent">
            {policy.name}
          </span>

          {policy.is_default && (
            <Badge
              className={cn(
                BADGE_TONES.slate,
                "inline-flex h-5 shrink-0 items-center border-none px-2 text-[10px] font-semibold leading-none tracking-wide uppercase",
              )}
            >
              Default
            </Badge>
          )}
        </div>

        <p className="mt-1 line-clamp-2 text-xs text-gray-500">
          {policy.description}
        </p>
      </TableCell>

      <TableCell className="px-4 py-4 align-middle whitespace-normal">
        <div className="flex items-center gap-2.5">
          {calendar ? (
            <CalendarDays
              className="size-5 shrink-0 text-gray-500"
              aria-hidden
            />
          ) : (
            <Clock className="size-5 shrink-0 text-gray-500" aria-hidden />
          )}

          <div>
            <p className="font-medium text-gray-900">
              {calendar ? "Business Hours" : "24/7"}
            </p>

            <p className="text-xs text-gray-500">
              {calendar
                ? `${formatWorkingDays(calendar.workingDays)}, ${formatWorkingHours(calendar)}`
                : "All days, 24 hours"}
            </p>
          </div>
        </div>
      </TableCell>

      <TableCell className="px-4 py-4 align-middle">
        <div className="flex flex-col gap-1.5">
          {[
            {
              target: urgent,
              label: "Urgent",
              className: "bg-red-50 text-red-600 border-0 ring-0",
              dot: "bg-red-500",
            },
            {
              target: low,
              label: "Low",
              className: "bg-emerald-50 text-emerald-600 border-0 ring-0",
              dot: "bg-emerald-500",
            },
          ].map(
            ({ target, label, className, dot }) =>
              target && (
                <div
                  key={label}
                  className="flex items-center gap-2 whitespace-nowrap"
                >
                  <span className="font-semibold tabular-nums text-gray-900">
                    {formatDurationShort(target.first_response_mins)} /{" "}
                    {formatDurationShort(target.resolution_mins)}
                  </span>

                  <Badge
                    className={cn(
                      "h-5 gap-1.5 rounded-full border-0 px-2 text-[10px] font-semibold",
                      "ring-1 ring-inset",
                      className,
                    )}
                  >
                    <span className={cn("size-1.5 rounded-full", dot)} />
                    {label}
                  </Badge>
                </div>
              ),
          )}
        </div>
      </TableCell>

      <TableCell className="px-4 py-4 align-middle whitespace-normal">
        <p className="text-gray-900">
          {policy.applies_to === "Selected customers"
            ? `${policy.selected_customer_count} selected customer${
                policy.selected_customer_count === 1 ? "" : "s"
              }`
            : "All customers"}
        </p>

        <p className="text-xs text-gray-500">
          {policy.appliedTickets.toLocaleString("en-US")} ticket
          {policy.appliedTickets === 1 ? "" : "s"}
        </p>
      </TableCell>

      <TableCell className="px-4 py-4 align-middle">
        <p className="whitespace-nowrap text-gray-900">
          {formatUpdatedDate(policy.updated_at)}
        </p>

        {policy.updated_by_name && (
          <p className="mt-0.5 whitespace-nowrap text-xs text-gray-500">
            by {policy.updated_by_name}
          </p>
        )}
      </TableCell>
      <TableCell className="px-4 py-4 align-middle">
        <StatusBadge status={policy.status} />
      </TableCell>
    </ClickablePolicyRow>
  );
}

export default SlaPoliciesPage;
