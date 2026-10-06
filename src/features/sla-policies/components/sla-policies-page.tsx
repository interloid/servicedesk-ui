"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays,
  Clock,
  Copy,
  EllipsisVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { DeletePolicyDialog } from "./delete-policy-dialog";
import {
  formatWorkingDays,
  formatWorkingHours,
} from "./business-hours-dialogs";
import { useSlaActions } from "../hooks/use-sla-actions";
import { duplicateSlaPolicyAction } from "../action/sla.actions";
import { formatDurationShort } from "../duration";
import { SlaPolicy, SlaPolicyQuota, hasPolicyRoom } from "../types/types";

interface SlaPoliciesPageProps {
  tenant: string;
  initialPolicies: SlaPolicy[];
  /** The plan's cap, so the create button can be gated before it's pressed. */
  policyQuota: SlaPolicyQuota;
}

const COLUMNS = [
  "Policy name",
  "Business hours",
  "SLA targets",
  "Applied to",
  "Updated at",
  "Status",
  "Actions",
];

const NEW_POLICY_BUTTON =
  "inline-flex h-10 items-center gap-2 self-start rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-accent-foreground transition-colors hover:bg-brand-accent/90";

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

export const SlaPoliciesPage: React.FC<SlaPoliciesPageProps> = ({
  tenant,
  initialPolicies,
  policyQuota,
}) => {
  const router = useRouter();
  const { policies, handleToggleStatus, handleDeletePolicy } = useSlaActions(
    tenant,
    initialPolicies,
  );
  const [toDelete, setToDelete] = useState<SlaPolicy | null>(null);
  const [deleting, startDelete] = useTransition();
  const [, startDuplicate] = useTransition();

  // Counted off the rendered list rather than a second number from the server,
  // so deleting a row frees the slot without waiting for a refresh. The write
  // isn't gated server-side yet, so this is the only thing holding the line.
  const used = policies.length;
  const canCreate = hasPolicyRoom(policyQuota, used);
  const limitReason =
    policyQuota.limit === null
      ? ""
      : `Your ${policyQuota.planName} plan includes ${policyQuota.limit} SLA ${
          policyQuota.limit === 1 ? "policy" : "policies"
        }. Delete one, or upgrade your plan, to create another.`;

  const toggle = async (policy: SlaPolicy) => {
    const result = await handleToggleStatus(policy.id);
    if (!result.success) {
      toast.error(result.error ?? "Couldn't change the status.");
      return;
    }
    toast.success(
      policy.status === "active"
        ? `${policy.name} is now inactive.`
        : `${policy.name} is now active.`,
    );
  };

  const duplicate = (policy: SlaPolicy) => {
    if (!canCreate) {
      toast.error(limitReason);
      return;
    }
    startDuplicate(async () => {
      const result = await duplicateSlaPolicyAction(tenant, policy.id);
      if (!result.success || !("policyId" in result)) {
        toast.error(result.error ?? "Couldn't duplicate the policy.");
        return;
      }
      toast.success(`Created a copy of ${policy.name}. It starts inactive.`);
      router.push(`/${tenant}/sla/${result.policyId}`);
    });
  };

  const confirmDelete = () => {
    if (!toDelete) return;
    const policy = toDelete;
    startDelete(async () => {
      const result = await handleDeletePolicy(policy.id);
      if (!result.success) {
        toast.error(result.error ?? "Couldn't delete the policy.");
        return;
      }
      setToDelete(null);
      toast.success(`Deleted ${policy.name}.`);
      router.refresh();
    });
  };

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

          {canCreate ? (
            <Link href={`/${tenant}/sla/new`} className={NEW_POLICY_BUTTON}>
              <Plus className="size-4" aria-hidden />
              New policy
            </Link>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-disabled
                    onClick={(event) => event.preventDefault()}
                    className={`${NEW_POLICY_BUTTON} cursor-not-allowed opacity-60 hover:bg-brand-accent`}
                  >
                    <Plus className="size-4" aria-hidden />
                    New policy
                  </button>
                </TooltipTrigger>

                <TooltipContent side="bottom" className="max-w-xs">
                  {limitReason}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <Card className="gap-0 border border-gray-200/80 bg-white py-0 shadow-xs ring-0">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                {COLUMNS.map((c) => (
                  <TableHead
                    key={c}
                    className="px-4 text-xs font-semibold text-gray-600"
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
                  <PolicyRow
                    key={policy.id}
                    tenant={tenant}
                    policy={policy}
                    canCreate={canCreate}
                    limitReason={limitReason}
                    onToggle={() => toggle(policy)}
                    onDuplicate={() => duplicate(policy)}
                    onDelete={() => setToDelete(policy)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <DeletePolicyDialog
        policyName={toDelete?.name ?? null}
        open={toDelete !== null}
        pending={deleting}
        onOpenChange={(open) => !open && setToDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
};

function PolicyRow({
  tenant,
  policy,
  onToggle,
  onDelete,
}: {
  tenant: string;
  policy: SlaPolicy;
  canCreate: boolean;
  limitReason: string;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const href = `/${tenant}/sla/${policy.id}`;
  const urgent = policy.targets.find((t) => t.priority_scope === "urgent");
  const low = policy.targets.find((t) => t.priority_scope === "low");
  const calendar = policy.business_hours;

  return (
    <TableRow className="border-gray-100 align-top hover:bg-gray-50/50">
      <TableCell className="max-w-60 px-4 py-4 align-top whitespace-normal">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={href}
            className="font-semibold text-gray-900 hover:text-brand-accent hover:underline"
          >
            {policy.name}
          </Link>
          {policy.is_default && (
            <Badge
              className={cn(
                BADGE_TONES.slate,
                "h-5 border-none px-2 text-[10px] font-semibold tracking-wide uppercase",
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

      <TableCell className="px-4 py-4 align-top whitespace-normal">
        <div className="flex items-start gap-2.5">
          {calendar ? (
            <CalendarDays
              className="mt-0.5 size-5 shrink-0 text-gray-500"
              aria-hidden
            />
          ) : (
            <Clock
              className="mt-0.5 size-5 shrink-0 text-gray-500"
              aria-hidden
            />
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

      <TableCell className="px-4 py-4 align-top">
        {[
          { target: urgent, label: "Urgent" },
          { target: low, label: "Low" },
        ].map(
          ({ target, label }) =>
            target && (
              <p key={label} className="tabular-nums">
                <span className="font-semibold text-gray-900">
                  {formatDurationShort(target.first_response_mins)} /{" "}
                  {formatDurationShort(target.resolution_mins)}
                </span>{" "}
                <span className="text-gray-500">({label})</span>
              </p>
            ),
        )}
      </TableCell>

      <TableCell className="px-4 py-4 align-top whitespace-normal">
        <p className="text-gray-900">
          {policy.applies_to === "Selected customers"
            ? `${policy.selected_customer_count} selected customer${
                policy.selected_customer_count === 1 ? "" : "s"
              }`
            : "All customers"}
        </p>
        <p className="text-xs text-gray-500">
          {policy.appliedTickets.toLocaleString()} ticket
          {policy.appliedTickets === 1 ? "" : "s"}
        </p>
      </TableCell>

      <TableCell className="px-4 py-4 align-top">
        <p className="text-gray-900">{formatUpdated(policy.updated_at)}</p>
        {policy.updated_by_name && (
          <p className="text-xs text-gray-500">by {policy.updated_by_name}</p>
        )}
      </TableCell>

      <TableCell className="px-4 py-4 align-top whitespace-normal">
        <StatusBadge status={policy.status} />
      </TableCell>

      <TableCell className="px-4 py-4 align-top whitespace-normal">
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`More actions for ${policy.name}`}
              className="rounded-md p-1.5 text-gray-500 transition-colors outline-none hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-brand-accent/40"
            >
              <EllipsisVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <TooltipProvider>
                <DropdownMenuItem asChild>
                  <Link href={href}>
                    <Pencil className="size-4" /> Edit
                  </Link>
                </DropdownMenuItem>

                {!(policy.is_default && policy.status === "active") && (
                  <DropdownMenuItem onClick={onToggle}>
                    {policy.status === "active" ? (
                      <>
                        <Pause className="size-4" /> Deactivate
                      </>
                    ) : (
                      <>
                        <Play className="size-4" /> Activate
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {!policy.is_default && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onDelete}
                      className="text-red-600 focus:bg-red-50 focus:text-red-700"
                    >
                      <Trash2 className="size-4 text-current" /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </TooltipProvider>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default SlaPoliciesPage;
