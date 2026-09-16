"use client";

import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, X, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";

import { FormattedPlan } from "../types";
import { changeTenantPlanAction } from "../billing-actions";
import { cn } from "@/lib/utils";
import { MODAL_BUTTON } from "./modal-buttons";
import { ModalNotice } from "./modal-notice";

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

  // Controls the fade-out before closing the dialog.
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setIsClosing(false);
    }
  }, [open]);

  const isFreeTarget = targetPlan?.priceValue === 0;
  const targetSeatLimit = targetPlan?.seatLimit ?? 0;

  const seatsAtRisk = targetPlan ? Math.max(0, usedSeats - targetSeatLimit) : 0;

  const currentPlanLabel = currentPlan?.name ?? "your current plan";
  const targetName = targetPlan?.name ?? "";
  const targetPrice = targetPlan?.price ?? "";
  const targetSuffix = targetPlan?.priceSuffix ?? "";

  const timing = (() => {
    if (!targetPlan) {
      return {
        headline: "",
        body: "",
        deferred: false,
      };
    }

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

  /**
   * Close animation:
   * 1. Fade the notice out.
   * 2. Close the dialog after 100ms.
   */
  const handleClose = () => {
    if (isPending || isClosing) return;

    setIsClosing(true);

    setTimeout(() => {
      onOpenChange(false);
    }, 100);
  };

  const handleConfirm = () => {
    if (!targetPlan || isPending) return;

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
        if (!next && !isPending) {
          handleClose();
        }
      }}
    >
      <AlertDialogContent
        className="
          w-[calc(100%-2rem)]
          data-[size=default]:max-w-110
          data-[size=default]:sm:max-w-125
          overflow-hidden
          rounded-2xl
          border
          border-border
          bg-background
          p-0
          shadow-xl
        "
      >
        <AlertDialogHeader className="block px-6 pb-4 pt-5 text-left">
          <div className="flex w-full items-center justify-between gap-4">
            <AlertDialogTitle className="text-xl font-bold text-foreground">
              Downgrade to {targetName}?
            </AlertDialogTitle>

            <button
              type="button"
              onClick={handleClose}
              disabled={isPending || isClosing}
              className="
                -mr-1.5
                shrink-0
                rounded-md
                p-1.5
                text-muted-foreground
                transition-colors
                duration-200
                ease-out
                hover:text-foreground
                disabled:pointer-events-none
                disabled:opacity-50
                motion-safe:active:scale-[0.98]
              "
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <AlertDialogDescription asChild>
            <div
              className={cn(
                "mt-4 space-y-3 transition-opacity duration-100",
                isClosing ? "opacity-0" : "opacity-100",
              )}
            >
              <ModalNotice
                icon={timing.deferred ? CalendarClock : Zap}
                title={`Takes effect: ${timing.headline}`}
              >
                {timing.body}
              </ModalNotice>

              {targetPlan && seatsAtRisk > 0 && (
                <ModalNotice
                  icon={XCircle}
                  tone="amber"
                  title={`Agent seat usage: ${usedSeats} of ${totalSeats} seats`}
                >
                  {targetPlan.name} includes {targetSeatLimit} agent seats.
                  You&apos;ll need to free up {seatsAtRisk} seat
                  {seatsAtRisk === 1 ? "" : "s"} before this change applies.
                </ModalNotice>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="mx-0 mb-0 gap-3 border-t border-border px-4 py-4 sm:justify-end">
          <AlertDialogCancel
            disabled={isPending || isClosing}
            onClick={(e) => {
              // Prevent Radix from closing immediately.
              e.preventDefault();

              handleClose();
            }}
            className={cn(MODAL_BUTTON, "mt-0")}
          >
            Keep my plan
          </AlertDialogCancel>

          <AlertDialogAction
            variant="outline"
            disabled={isPending || isClosing}
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

            {isPending ? "Processing..." : "Confirm downgrade"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
