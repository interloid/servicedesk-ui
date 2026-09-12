"use client";

import React, { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, X, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { FormattedPlan } from "../types";
import { changeTenantPlanAction } from "../billing-actions";
import { cn } from "@/lib/utils";
import { MODAL_BUTTON } from "./modal-buttons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Confirm/dismiss tones only -- the size comes from MODAL_BUTTON, shared with
// every other billing popup. Outlined rather than solid, following the
// cancel-subscription flow.
const CONFIRM_DANGER =
  "border-red-600 bg-background text-red-600 hover:border-red-600 hover:bg-red-50 hover:text-red-600 disabled:border-red-300 disabled:bg-background disabled:text-red-300 disabled:opacity-100 dark:hover:bg-red-950/30";
const CONFIRM_ACCENT =
  "border-brand-accent bg-background text-brand-accent hover:border-brand-accent hover:bg-brand-accent/5 hover:text-brand-accent disabled:border-brand-accent/40 disabled:bg-background disabled:text-brand-accent/40 disabled:opacity-100";

interface DowngradeDialogProps {
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetPlan: FormattedPlan | null;
  currentPlan: FormattedPlan | null;
  usedSeats: number;
  totalSeats: number;
  renewalDate: string | null;
  scheduledToPlan?: string | null;
}

export function DowngradeDialog({
  tenantSlug,
  open,
  onOpenChange,
  targetPlan,
  currentPlan,
  usedSeats,
  totalSeats,
  renewalDate,
  scheduledToPlan,
}: DowngradeDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isFreeTarget = targetPlan?.priceValue === 0;
  const targetSeatLimit = targetPlan?.seatLimit ?? 0;
  const seatsAtRisk = targetPlan ? Math.max(0, usedSeats - targetSeatLimit) : 0;

  const currentPlanLabel = currentPlan?.name ?? "your current plan";
  const targetName = targetPlan?.name ?? "";
  const targetPrice = targetPlan?.price ?? "";
  const targetSuffix = targetPlan?.priceSuffix ?? "";

  const timing = (() => {
    if (!targetPlan) return { headline: "", body: "", deferred: false };

    return renewalDate
      ? {
          headline: "End of billing period",
          body: isFreeTarget
            ? `You keep ${currentPlanLabel} — including its features and agent seats — until ${renewalDate}. No further charges are made, and the switch to the Free plan applies when your billing period ends.`
            : `You keep ${currentPlanLabel} — including its features and agent seats — until ${renewalDate}. From the next billing cycle you'll be billed the ${targetName} rate of ${targetPrice}${targetSuffix}.`,
          deferred: true,
        }
      : {
          headline: "Immediately",
          body: isFreeTarget
            ? "It takes effect right now, and no further charges will be made."
            : `It takes effect right now. From your next billing cycle you'll be billed the ${targetName} rate of ${targetPrice}${targetSuffix}.`,
          deferred: false,
        };
  })();

  const handleConfirm = () => {
    if (!targetPlan) return;

    if (
      scheduledToPlan &&
      targetPlan.name.trim().toLowerCase() ===
        scheduledToPlan.trim().toLowerCase()
    ) {
      toast.info(
        `You've already scheduled the downgrade to ${targetPlan.name}.`,
      );
      onOpenChange(false);
      return;
    }

    startTransition(async () => {
      try {
        const res = await changeTenantPlanAction(tenantSlug, targetPlan.id);

        if (!res.success) {
          toast.error(res.error || "Failed to switch plan.");
          return;
        }

        if (res.approvalUrl) {
          window.location.assign(res.approvalUrl);
          return;
        }

        if (res.scheduled) {
          const when = res.effectiveAt
            ? new Date(res.effectiveAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : (renewalDate ?? "the end of your billing period");
          toast.success(
            `Downgrade to ${targetPlan.name} scheduled for ${when}. You keep your current plan until then.`,
          );
          onOpenChange(false);
          return;
        }

        onOpenChange(false);
        router.refresh();
      } catch (error) {
        console.error("Downgrade error:", error);
        toast.error(
          error instanceof Error
            ? error.message
            : "Something went wrong while downgrading the plan.",
        );
      }
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isPending) onOpenChange(false);
      }}
    >
      <AlertDialogContent
        className="
            w-[calc(100%-2rem)]
            data-[size=default]:max-w-110
            data-[size=default]:sm:max-w-125
            rounded-2xl
            border
            border-border
            bg-background
            p-0
            shadow-xl
            overflow-hidden
          "
      >
        <AlertDialogHeader className="relative px-6 pt-5 pb-4">
          <button
            type="button"
            onClick={() => {
              if (!isPending) onOpenChange(false);
            }}
            disabled={isPending}
            className="absolute right-5 top-5 rounded-md p-1.5 text-muted-foreground transition-colors duration-200 ease-out hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-[0.98]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          <AlertDialogTitle className="pr-10 text-xl font-bold text-foreground">
            Downgrade to {targetName}?
          </AlertDialogTitle>

          <AlertDialogDescription asChild>
            <div className="mt-4 space-y-3">
              <div className="w-full rounded-xl border border-brand-accent/20 bg-brand-accent/3 px-4 py-3.5">
                <div className="flex items-start gap-3">
                  {timing.deferred ? (
                    <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-brand-accent" />
                  ) : (
                    <Zap className="mt-0.5 h-5 w-5 shrink-0 text-brand-accent" />
                  )}

                  <div className="space-y-1 text-sm leading-5 text-foreground">
                    <p className="font-semibold">
                      Takes effect: {timing.headline}
                    </p>
                    <p className="font-normal text-muted-foreground">
                      {timing.body}
                    </p>
                  </div>
                </div>
              </div>

              {targetPlan && seatsAtRisk > 0 && (
                <div className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <div className="flex items-start gap-3">
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="space-y-1 text-sm leading-5">
                      <p className="font-semibold text-amber-900 dark:text-amber-200">
                        Agent seat usage: {usedSeats} of {totalSeats} seats
                      </p>
                      <p className="font-normal text-amber-800/90 dark:text-amber-300/90">
                        {targetPlan.name} includes {targetSeatLimit} agent
                        seats. You&apos;ll need to free up {seatsAtRisk} seat
                        {seatsAtRisk === 1 ? "" : "s"} before this change
                        applies.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="mx-0 mb-0 gap-3 border-t border-border px-4 py-4 sm:justify-end">
          <AlertDialogCancel
            disabled={isPending}
            className={cn(MODAL_BUTTON, "mt-0")}
          >
            Keep my plan
          </AlertDialogCancel>

          {/* Outlined rather than solid, matching the confirm button on the
              cancel-subscription flow: red when the downgrade drops the tenant
              to Free, brand-accent for a paid-to-paid downgrade. */}
          <AlertDialogAction
            variant="outline"
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            className={cn(
              MODAL_BUTTON,
              isFreeTarget ? CONFIRM_DANGER : CONFIRM_ACCENT,
            )}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm downgrade
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
