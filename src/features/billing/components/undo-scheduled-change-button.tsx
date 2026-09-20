"use client";

import React, { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { abortPlanSwitchAction } from "../billing-actions";

/**
 * Undo whatever is scheduled against the subscription.
 *
 * A cancellation IS a scheduled switch to the Free plan, so "Reactivate" and
 * "Cancel change" were never two operations -- both close the tenant's one open
 * switch and put the previous plan back. They run through this single component
 * and the single `abort` action, so the two buttons cannot drift apart or fall
 * out of step with the backend. Only the label differs.
 *
 * No PayPal checkout: the plan is restored from the snapshot the switch row
 * carries, exactly as it was before the change was scheduled.
 */
export function UndoScheduledChangeButton({
  tenantSlug,
  label,
  className,
  variant = "outline",
  showIcon = true,
  onDone,
}: {
  tenantSlug: string;
  label: string;
  className?: string;
  variant?: "outline" | "default";
  showIcon?: boolean;
  /**
   * Called once the undo has actually succeeded. A caller that renders this
   * inside a confirmation dialog uses it to close that dialog, which is why
   * the click below is prevented from bubbling into AlertDialogAction's own
   * auto-close -- the dialog has to stay open, showing "Working...", until
   * the server answers.
   */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleUndo = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Keep an enclosing AlertDialogAction from closing the dialog the instant
    // it is clicked; onDone closes it when the work is really finished.
    event.preventDefault();

    startTransition(async () => {
      const result = await abortPlanSwitchAction(tenantSlug);

      if (!result.success) {
        toast.error(result.error || "Failed to undo the scheduled change.");
        return;
      }

      // Putting the plan back raises the price again, so PayPal asks the buyer
      // to confirm. The scheduled change stays until they do -- see the
      // `abort` action -- so there is nothing to announce yet.
      if ("approvalUrl" in result && result.approvalUrl) {
        window.location.assign(result.approvalUrl);
        return;
      }

      // `restored` is false when there was nothing open to undo -- a stale tab,
      // or a second click. Saying so beats a success message for work that did
      // not happen.
      toast.success(
        result.restored
          ? result.planName
            ? `You're back on ${result.planName}. Nothing is scheduled to change.`
            : "Your plan has been restored."
          : "There was no scheduled change left to undo.",
      );

      router.refresh();
      onDone?.();
    });
  };

  return (
    <Button
      variant={variant}
      onClick={handleUndo}
      disabled={isPending}
      className={cn(className)}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        showIcon && <RotateCcw className="h-4 w-4" />
      )}
      {isPending ? "Working..." : label}
    </Button>
  );
}
