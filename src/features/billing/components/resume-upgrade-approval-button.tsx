"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resumeUpgradeApprovalAction } from "../billing-actions";

/**
 * Finishes an upgrade whose difference is already paid but whose new monthly
 * rate PayPal still needs the buyer to approve -- the state a buyer lands in
 * by closing the PayPal tab after paying.
 *
 * It never charges: the action asks PayPal for a fresh approve link against
 * the SAME agreement and the same pending plan, and refuses outright unless
 * the one-time order is already COMPLETED.
 */
export function ResumeUpgradeApprovalButton({
  tenantSlug,
}: {
  tenantSlug: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleResume = () => {
    startTransition(async () => {
      const result = await resumeUpgradeApprovalAction(tenantSlug);

      if (!result.success) {
        toast.error(result.error || "Could not reach PayPal.");
        return;
      }

      if (result.approvalUrl) {
        window.location.assign(result.approvalUrl);
        return;
      }

      // No approve link came back: PayPal was already on the new plan and the
      // action applied it, so the upgrade is simply done.
      toast.success(
        result.planName
          ? `You're on ${result.planName}.`
          : "Your new plan is active.",
      );

      router.refresh();
    });
  };

  return (
    <Button
      size="sm"
      onClick={handleResume}
      disabled={isPending}
      className="h-8"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ShieldCheck className="h-4 w-4" />
      )}
      {isPending ? "Working..." : "Confirm with PayPal"}
    </Button>
  );
}
