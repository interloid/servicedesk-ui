"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  Loader2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cancelSubscriptionAction } from "../billing-actions";
import type { BillingDashboardData } from "../services/billing-dashboard.service";
import type { FormattedPlan } from "../types";

interface CancelSubscriptionProps {
  tenantSlug: string;
  billingData: BillingDashboardData;
  freePlan?: FormattedPlan | null;
}

const CANCEL_REASONS = [
  "Too expensive",
  "Missing features",
  "Found a better alternative",
  "Too difficult to use",
  "Technical issues",
  "No longer needed",
  "Other",
] as const;

const OTHER_REASON = "Other";

export default function CancelSubscription({
  tenantSlug,
  billingData,
  freePlan = null,
}: CancelSubscriptionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"confirm" | "final">("confirm");
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [otherReason, setOtherReason] = useState<string>("");

  const plan = billingData.plan;
  const renewalDate = billingData.renewalDate;
  const seats = billingData.seats;
  const scheduledChange = billingData.scheduledChange;

  const isFreePlan = plan.rateValue === 0;

  // A cancellation is itself stored as a scheduled switch to the $0 plan, which
  // is why billingStatus reads "cancelled" while one is pending. Treating that
  // as a generic "plan change" told a user who had just cancelled to cancel
  // their cancellation first, which read as the button not working.
  const alreadyCancelled = billingData.billingStatus === "cancelled";
  const hasScheduledPlanChange = scheduledChange !== null && !alreadyCancelled;

  const endsOn = renewalDate !== "N/A" ? renewalDate : null;

  const freeSeatLimit = freePlan?.seatLimit ?? null;
  const seatsOverFreeLimit =
    freeSeatLimit !== null && seats.used > freeSeatLimit
      ? seats.used - freeSeatLimit
      : 0;

  const backToBilling = () => router.push(`/${tenantSlug}/account/billing`);

  const handleCancel = () => {
    startTransition(async () => {
      setError(null);

      // Free text only matters when "Other" is the choice, and it stays
      // optional either way.
      const reason =
        cancelReason === OTHER_REASON
          ? otherReason.trim() || OTHER_REASON
          : cancelReason;

      try {
        const result = await cancelSubscriptionAction(
          tenantSlug,
          reason || undefined,
        );

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
      <Shell tenantSlug={tenantSlug} onBack={backToBilling}>
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
      </Shell>
    );
  }

  if (alreadyCancelled) {
    return (
      <Shell tenantSlug={tenantSlug} onBack={backToBilling}>
        <Card className="border-amber-200 bg-amber-50/60 p-5">
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <h2 className="text-base font-bold text-amber-950">
                Your subscription is already cancelled
              </h2>
              <p className="mt-1.5 text-sm text-amber-900/90">
                {endsOn ? (
                  <>
                    You keep full access to your {plan.name} plan until{" "}
                    <strong className="font-semibold">{endsOn}</strong>. After
                    that, your account moves to the Free plan. You will not be
                    charged again.
                  </>
                ) : (
                  <>
                    Your account will move to the Free plan at the end of the
                    current period. You will not be charged again.
                  </>
                )}
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button size="sm" onClick={backToBilling}>
                  Back to billing
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(`/${tenantSlug}/account/plans`)}
                >
                  Reactivate my plan
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </Shell>
    );
  }

  if (hasScheduledPlanChange && scheduledChange) {
    return (
      <Shell tenantSlug={tenantSlug} onBack={backToBilling}>
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <h2 className="text-base font-bold text-foreground">
                Plan change already scheduled
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                You have a pending switch to {scheduledChange.planName}{" "}
                effective{" "}
                {new Date(scheduledChange.effectiveAt).toLocaleDateString(
                  "en-US",
                  { month: "long", day: "numeric", year: "numeric" },
                )}
                . Cancel that change first, then cancel your subscription.
              </p>
              <Button size="sm" onClick={backToBilling} className="mt-4">
                Go to billing
              </Button>
            </div>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell tenantSlug={tenantSlug} onBack={backToBilling} disabled={isPending}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Cancel subscription
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review what happens when you cancel your subscription.
        </p>
      </div>

      {/* Current plan — what you have today */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {plan.name} plan
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {plan.rate} · Renews {renewalDate}
            </p>
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5 shrink-0" />
              {seats.used} of {seats.total} user seats used
            </p>
          </div>
          <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
            Active
          </Badge>
        </div>
      </Card>

      {step === "confirm" && (
        <>
          {/* What happens after cancellation */}
          <Card className="border-red-200 bg-red-50/50 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-red-950">
                  What happens after you cancel
                </h2>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-md bg-white px-2 py-1 font-semibold text-slate-900 ring-1 ring-red-200">
                    {plan.name}
                  </span>
                  <ArrowRight
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-red-400"
                  />
                  <span className="rounded-md bg-white px-2 py-1 font-semibold text-slate-900 ring-1 ring-red-200">
                    {freePlan?.name ?? "Free"}
                  </span>
                  {endsOn && (
                    <span className="text-xs text-red-800/80">
                      on <strong className="font-semibold">{endsOn}</strong>
                    </span>
                  )}
                </div>

                <ul className="mt-4 space-y-2.5 text-sm text-red-900/90">
                  <li className="flex items-start gap-2">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    {endsOn ? (
                      <span>
                        You keep your {plan.name} plan and everything in it
                        until{" "}
                        <strong className="font-semibold">{endsOn}</strong>.
                        Nothing changes before then.
                      </span>
                    ) : (
                      <span>
                        Your account moves to the {freePlan?.name ?? "Free"}{" "}
                        plan immediately.
                      </span>
                    )}
                  </li>

                  <li className="flex items-start gap-2">
                    <Users className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    {freeSeatLimit !== null ? (
                      <span>
                        Your seat limit drops from{" "}
                        <strong className="font-semibold">{seats.total}</strong>{" "}
                        to{" "}
                        <strong className="font-semibold">
                          {freeSeatLimit}
                        </strong>
                        .{" "}
                        {seatsOverFreeLimit > 0 ? (
                          <span className="font-semibold">
                            You have {seats.used} members, so{" "}
                            {seatsOverFreeLimit} will lose access unless you
                            remove them first.
                          </span>
                        ) : (
                          <>
                            Your {seats.used} current member
                            {seats.used === 1 ? "" : "s"} still fit.
                          </>
                        )}
                      </span>
                    ) : (
                      <span>
                        Your seat limit drops from {seats.total} to the Free
                        plan limit.
                      </span>
                    )}
                  </li>

                  <li className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <span>
                      {freePlan ? (
                        <>
                          The Free plan includes {freePlan.ticketLimitText}{" "}
                          tickets and {freePlan.storageLimitText} storage.
                          Paid-plan features such as SLA policies and priority
                          support are no longer available.
                        </>
                      ) : (
                        <>
                          Paid-plan features such as SLA policies and priority
                          support are no longer available.
                        </>
                      )}
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </Card>

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="outline"
              onClick={backToBilling}
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
                <h2 className="text-sm font-bold text-red-950">
                  Your subscription will be cancelled
                </h2>
                <p className="mt-1.5 text-sm text-red-900/90">
                  {endsOn ? (
                    <>
                      You&apos;ll keep access to your {plan.name} plan until{" "}
                      <strong className="font-semibold">{endsOn}</strong>. After
                      that, your account will move to the{" "}
                      {freePlan?.name ?? "Free"} plan.
                    </>
                  ) : (
                    <>
                      Your account will move to the {freePlan?.name ?? "Free"}{" "}
                      plan immediately.
                    </>
                  )}
                </p>
              </div>
            </div>
          </Card>

          {/* Reason — optional, never blocks the cancellation */}
          <Card className="p-5">
            <h2 className="text-sm font-bold text-foreground">
              What&apos;s the reason for cancelling?
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional — your feedback helps us improve.
            </p>

            <RadioGroup
              value={cancelReason}
              onValueChange={setCancelReason}
              className="mt-4"
            >
              {CANCEL_REASONS.map((reason) => (
                <div
                  key={reason}
                  data-state={cancelReason === reason ? "checked" : "unchecked"}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-slate-300 data-[state=checked]:border-brand-accent data-[state=checked]:bg-accent/50"
                >
                  <RadioGroupItem
                    value={reason}
                    id={`cancel-reason-${reason}`}
                  />
                  <Label
                    htmlFor={`cancel-reason-${reason}`}
                    className="flex-1 cursor-pointer text-sm font-normal text-foreground"
                  >
                    {reason}
                  </Label>
                </div>
              ))}
            </RadioGroup>

            {cancelReason === OTHER_REASON && (
              <div className="mt-3">
                <Label
                  htmlFor="cancel-reason-other-text"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Tell us more (optional)
                </Label>
                <Textarea
                  id="cancel-reason-other-text"
                  value={otherReason}
                  onChange={(event) => setOtherReason(event.target.value)}
                  placeholder="What made you decide to cancel?"
                  rows={3}
                  maxLength={500}
                  className="mt-1.5 resize-none"
                />
              </div>
            )}
          </Card>

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="space-y-3">
            {endsOn && (
              <p className="text-xs text-muted-foreground">
                You can continue using your {plan.name} plan until{" "}
                <strong className="font-semibold text-foreground">
                  {endsOn}
                </strong>
                .
              </p>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                  "Cancel subscription"
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({
  onBack,
  disabled,
  children,
}: {
  tenantSlug: string;
  onBack: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <Button
          variant="ghost"
          onClick={onBack}
          className="gap-2 px-2"
          disabled={disabled}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to billing
        </Button>

        {children}
      </div>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {children}
    </div>
  );
}
