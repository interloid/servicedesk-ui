"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cancelSubscriptionAction } from "../billing-actions";
import type { BillingDashboardData } from "../services/billing-dashboard.service";

interface CancelSubscriptionProps {
  tenantSlug: string;
  billingData: BillingDashboardData;
}

export default function CancelSubscription({
  tenantSlug,
  billingData,
}: CancelSubscriptionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"confirm" | "final">("confirm");
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");

  const cancelReasons = [
    "Too expensive",
    "Missing features",
    "Found a better alternative",
    "Don't use it often enough",
    "Other",
  ];

  const plan = billingData.plan;
  const renewalDate = billingData.renewalDate;
  const seats = billingData.seats;
  const scheduledChange = billingData.scheduledChange;

  const isFreePlan = plan.rateValue === 0;
  const hasScheduledChange = scheduledChange !== null;

  const handleCancel = () => {
    startTransition(async () => {
      setError(null);

      try {
        const result = await cancelSubscriptionAction(tenantSlug);

        if (!result.success) {
          setError(result.error || "Failed to cancel subscription.");
          return;
        }

        if (result.scheduled) {
          toast.success(
            `Subscription cancelled. Your ${plan.name} plan stays active until ${renewalDate}.`,
          );
        } else {
          toast.success(
            "Subscription cancelled. You are now on the Free plan.",
          );
        }

        router.push(`/${tenantSlug}/account/billing`);
        router.refresh();
      } catch (err) {
        console.error("Cancel error:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
        );
      }
    });
  };

  if (isFreePlan) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <Button
            variant="ghost"
            onClick={() => router.push(`/${tenantSlug}/account/billing`)}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to billing
          </Button>

          <Card className="p-6 text-center">
            <Check className="mx-auto h-12 w-12 text-emerald-500" />
            <h2 className="mt-4 text-lg font-bold text-foreground">
              You are already on the Free plan
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              No subscription to cancel. You can upgrade anytime from the plans
              page.
            </p>
            <Button
              onClick={() => router.push(`/${tenantSlug}/account/plans`)}
              className="mt-6"
            >
              View plans
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  if (hasScheduledChange && scheduledChange) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <Button
            variant="ghost"
            onClick={() => router.push(`/${tenantSlug}/account/billing`)}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to billing
          </Button>

          <Card className="p-6">
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div>
                <h2 className="text-lg font-bold text-foreground">
                  Plan change already scheduled
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  You have a pending switch to {scheduledChange.planName}{" "}
                  effective{" "}
                  {new Date(scheduledChange.effectiveAt).toLocaleDateString(
                    "en-US",
                    {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    },
                  )}
                  . Cancel that change first before cancelling your
                  subscription.
                </p>
                <Button
                  onClick={() => router.push(`/${tenantSlug}/account/billing`)}
                  className="mt-4"
                >
                  Go to billing
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <Button
          variant="ghost"
          onClick={() => router.push(`/${tenantSlug}/account/billing`)}
          className="gap-2"
          disabled={isPending}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to billing
        </Button>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Cancel subscription
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Please review what you&apos;ll lose before confirming.
          </p>
        </div>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {plan.name} plan
              </p>
              <p className="text-xs text-muted-foreground">
                {plan.rate} · Renews {renewalDate}
              </p>
            </div>
            <Badge
              variant="secondary"
              className="bg-emerald-50 text-emerald-700"
            >
              Active
            </Badge>
          </div>
        </Card>

        {step === "confirm" && (
          <>
            <Card className="border-red-200 bg-red-50/50 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div>
                  <h3 className="text-sm font-bold text-red-900">
                    What you&apos;ll lose when your plan ends:
                  </h3>
                  <ul className="mt-3 space-y-2">
                    <li className="flex items-start gap-2 text-sm text-red-800/80">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                      Access to premium features
                    </li>
                    <li className="flex items-start gap-2 text-sm text-red-800/80">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                      {seats.total} agent seats (Free plan includes limited
                      seats)
                    </li>
                    <li className="flex items-start gap-2 text-sm text-red-800/80">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                      Priority support
                    </li>
                  </ul>
                </div>
              </div>
            </Card>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={() => router.push(`/${tenantSlug}/account/billing`)}
                disabled={isPending}
              >
                Keep my plan
              </Button>
              <Button
                onClick={() => setStep("final")}
                disabled={isPending}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                Continue to cancel
              </Button>
            </div>
          </>
        )}

        {step === "final" && (
          <>
            <Card className="border-red-200 bg-red-50/50 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div>
                  <h3 className="text-sm font-bold text-red-900">
                    Are you sure you want to cancel?
                  </h3>
                  <p className="mt-1 text-sm text-red-800/80">
                    Your {plan.name} subscription will be cancelled.{" "}
                    {renewalDate !== "N/A" ? (
                      <>
                        You&apos;ll keep access until{" "}
                        <strong>{renewalDate}</strong>, then your account will
                        move to the Free plan.
                      </>
                    ) : (
                      <>Your account will move to the Free plan immediately.</>
                    )}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-sm font-bold text-slate-900">
                What&apos;s the reason for cancelling?
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Optional — helps us improve. Not required to cancel.
              </p>
              <RadioGroup
                value={cancelReason}
                onValueChange={setCancelReason}
                className="mt-4"
              >
                {cancelReasons.map((reason) => (
                  <div
                    key={reason}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition-colors hover:border-slate-300 data-[state=checked]:border-teal-600"
                    data-state={
                      cancelReason === reason ? "checked" : "unchecked"
                    }
                  >
                    <RadioGroupItem
                      value={reason}
                      id={`cancel-reason-${reason}`}
                    />
                    <Label
                      htmlFor={`cancel-reason-${reason}`}
                      className="cursor-pointer text-sm text-slate-700"
                    >
                      {reason}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </Card>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={() => setStep("confirm")}
                disabled={isPending}
              >
                Go back
              </Button>
              <Button
                onClick={handleCancel}
                disabled={isPending}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  "Yes, cancel subscription"
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
