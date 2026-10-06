import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { POLICY_STATUS_LABELS, PolicyStatus } from "../types/types";

interface StatusBadgeProps {
  status: PolicyStatus;
}

/**
 * Same palette as billing's pills (billing/components/reuse.tsx) and the
 * Team status badge: a -50 tint with -700 text, slate for neutral.
 */
export const BADGE_TONES = {
  emerald:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  sky: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground",
} as const;

/** Shared shape: shadcn Badge at the Team table's size. */
export const BADGE = "h-6 border px-2.5 text-xs font-semibold";

const TONES: Record<PolicyStatus, string> = {
  active: BADGE_TONES.emerald,
  paused: BADGE_TONES.slate,
  draft: BADGE_TONES.sky,
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => (
  <Badge className={cn(BADGE, TONES[status])}>
    {POLICY_STATUS_LABELS[status]}
  </Badge>
);
