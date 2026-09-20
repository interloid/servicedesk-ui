"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Clock,
  Crown,
  Info,
  Layers,
  Loader2,
  RotateCcw,
  Users,
  X,
  Zap,
} from "lucide-react";

import { FormattedPlan } from "../types";
import { toast } from "sonner";
import { changeTenantPlanAction } from "../billing-actions";
import type { BillingDashboardData } from "../services/billing-dashboard.service";
import { cn } from "@/lib/utils";

import { CancelSubscriptionDialog } from "./cancel-subscription";
import { DowngradeDialog } from "./downgrade-dialog";
import { MODAL_BUTTON } from "./modal-buttons";
import { ModalNotice } from "./modal-notice";
import { UndoScheduledChangeButton } from "./undo-scheduled-change-button";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

interface PricingCardsProps {
  tenantSlug: string;
  currentPlanCode: string;
  plans: FormattedPlan[];
  billingData?: BillingDashboardData | null;
}

export function PricingCards({
  tenantSlug,
  currentPlanCode,
  plans,
  billingData,
}: PricingCardsProps) {
  const router = useRouter();

  const [isPending, startTransition] = useTransition();

  const [loadingPlanCode, setLoadingPlanCode] = useState<string | null>(null);

  const [selectedPlanForSwitch, setSelectedPlanForSwitch] =
    useState<FormattedPlan | null>(null);

  const [downgradeTarget, setDowngradeTarget] = useState<FormattedPlan | null>(
    null,
  );

  const [isCancelOpen, setIsCancelOpen] = useState(false);

  // The scheduled-change confirmation below is a controlled dialog: it has no
  // AlertDialogTrigger, because the button that opens it lives in a different
  // part of the tree (the plan card), not next to the dialog.
  const [isUndoConfirmOpen, setIsUndoConfirmOpen] = useState(false);

  const announceScheduled = (planName: string, effectiveAt: string | null) => {
    const when = effectiveAt
      ? new Date(effectiveAt).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "the end of your billing period";

    toast.success(
      `Switch to ${planName} scheduled for ${when}. You keep your current plan until then.`,
    );
  };
  const executePlanSwitch = (plan: FormattedPlan) => {
    const scheduledToName = billingData?.scheduledChange?.planName
      ? billingData.scheduledChange.planName.trim().toLowerCase()
      : "";

    if (scheduledToName && plan.name.trim().toLowerCase() === scheduledToName) {
      toast.info(`You've already scheduled the switch to ${plan.name}.`);

      setSelectedPlanForSwitch(null);
      setDowngradeTarget(null);

      return;
    }

    setLoadingPlanCode(plan.id);

    startTransition(async () => {
      try {
        const res = await changeTenantPlanAction(tenantSlug, plan.id);

        if (!res.success) {
          toast.error(res.error || "Failed to switch plan.");
          return;
        }

        if (res.approvalUrl) {
          window.location.assign(res.approvalUrl);
          return;
        }

        if (res.scheduled) {
          announceScheduled(plan.name, res.effectiveAt ?? null);

          setSelectedPlanForSwitch(null);

          router.refresh();

          return;
        }

        setSelectedPlanForSwitch(null);

        router.refresh();
      } catch (error) {
        console.error("Plan switch error:", error);

        toast.error(
          error instanceof Error
            ? error.message
            : "Something went wrong while switching the plan.",
        );
      } finally {
        setLoadingPlanCode(null);
      }
    });
  };

  const [isOpen, setIsOpen] = useState(false);

  // 2. Sync open state whenever selectedPlanForSwitch changes.
  //
  // Adjusting state during render rather than in an effect: React finishes
  // this render with the new value instead of painting once and re-rendering,
  // so the dialog cannot flash a frame in the wrong state. Same pattern as
  // downgrade-dialog.tsx. Closing here matters too -- executePlanSwitch clears
  // the selection on success while the dialog is still open.
  const [prevSelectedPlan, setPrevSelectedPlan] = useState(
    selectedPlanForSwitch,
  );

  if (selectedPlanForSwitch !== prevSelectedPlan) {
    setPrevSelectedPlan(selectedPlanForSwitch);
    setIsOpen(Boolean(selectedPlanForSwitch));
  }

  // 3. Helper function to handle closing gracefully
  const handleClose = () => {
    if (isPending) return;
    setIsOpen(false); // Triggers close animation while selectedPlanForSwitch stays intact
  };

  // 4. Reset selectedPlanForSwitch when animation completes
  const handleAnimationEnd = () => {
    if (!isOpen) {
      setSelectedPlanForSwitch(null);
    }
  };
  const activeTarget = (currentPlanCode || "").trim().toLowerCase();

  const currentPlan =
    plans.find(
      (plan) =>
        (plan.id || "").trim().toLowerCase() === activeTarget ||
        (plan.code || "").trim().toLowerCase() === activeTarget,
    ) ?? null;

  const currentPrice = currentPlan?.priceValue ?? null;

  const freePlan = plans.find((plan) => plan.priceValue === 0);

  const canCancelCurrent =
    Boolean(billingData) &&
    currentPlan !== null &&
    currentPlan.priceValue > 0 &&
    freePlan !== undefined &&
    freePlan.id !== currentPlan.id;

  const isPendingCancellation = billingData?.billingStatus === "cancelled";

  const scheduledChange = billingData?.scheduledChange ?? null;

  const hasScheduledDowngrade =
    Boolean(scheduledChange) && !isPendingCancellation;

  const scheduledChangeDate = scheduledChange?.effectiveAt
    ? new Date(scheduledChange.effectiveAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const scheduledPlanObj = billingData?.scheduledChange?.planName
    ? plans.find(
        (plan) =>
          (plan.name || "").trim().toLowerCase() ===
          billingData.scheduledChange?.planName?.trim().toLowerCase(),
      )
    : null;

  const scheduledTargetIdentifier = (
    billingData?.scheduledChange?.planName ||
    (scheduledPlanObj
      ? scheduledPlanObj.id || scheduledPlanObj.code || scheduledPlanObj.name
      : "") ||
    ""
  )
    .trim()
    .toLowerCase();

  const selectedSwitchLabel = !selectedPlanForSwitch
    ? ""
    : currentPrice === null
      ? `Switch to ${selectedPlanForSwitch.name}`
      : selectedPlanForSwitch.priceValue < currentPrice
        ? `Downgrade to ${selectedPlanForSwitch.name}`
        : `Upgrade to ${selectedPlanForSwitch.name}`;

  const openSwitchDialog = (plan: FormattedPlan) => {
    if (currentPrice !== null && plan.priceValue < currentPrice) {
      setDowngradeTarget(plan);
      return;
    }

    setSelectedPlanForSwitch(plan);
  };

  const openCancelDialog = () => {
    setIsCancelOpen(true);
  };

  const usedSeats = billingData?.seats?.used ?? 0;

  const totalSeats = billingData?.seats?.total ?? 0;

  const renewalDate =
    billingData?.renewalDate && billingData.renewalDate !== "N/A"
      ? billingData.renewalDate
      : null;

  const currentPlanRate = billingData?.plan?.rateValue ?? 0;

  const target = selectedPlanForSwitch;

  const isUpgradeTarget =
    currentPrice !== null &&
    target !== null &&
    target.priceValue > currentPrice;

  // An upgrade costs the DIFFERENCE, today: the current period is already
  // paid for at the old rate, so Pro $29 -> Business $59 is $30. No prorated
  // days, no credit for unused time. The recurring charge becomes the full
  // rate from the next cycle.
  const upgradeAmount =
    isUpgradeTarget && target
      ? Math.round(Math.max(0, target.priceValue - currentPlanRate) * 100) / 100
      : 0;

  const dialogTiming = (() => {
    if (!target) {
      return {
        headline: "",
        body: "",
        deferred: false,
      };
    }

    return {
      headline: "As soon as PayPal checkout is approved",

      body: isUpgradeTarget
        ? `You'll pay $${upgradeAmount.toFixed(
            2,
          )} today — the difference between ${
            currentPlan?.name ?? "your current plan"
          } ($${currentPlanRate.toFixed(2)}) and ${
            target.name
          } ($${target.priceValue.toFixed(2)}). This one-time payment unlocks ${
            target.name
          } now on your existing subscription, and from next month you'll be billed the full ${
            target.price
          }${target.priceSuffix}.`
        : `You'll be redirected to PayPal to approve the new ${
            target.name
          } subscription. Your current plan stays active until it's live, then you'll be billed ${
            target.price
          }${target.priceSuffix}.`,

      deferred: false,
    };
  })();

  return (
    <>
      <div className="flex flex-wrap items-stretch justify-center gap-5 xl:gap-6">
        {plans.map((plan, planIdx) => {
          const planId = (plan.id || "").trim().toLowerCase();

          const planCode = (plan.code || "").trim().toLowerCase();

          const planName = (plan.name || "").trim().toLowerCase();

          const isCurrent =
            Boolean(activeTarget) &&
            (planId === activeTarget || planCode === activeTarget);

          const isScheduledTarget =
            hasScheduledDowngrade &&
            scheduledTargetIdentifier !== "" &&
            (planId === scheduledTargetIdentifier ||
              planCode === scheduledTargetIdentifier ||
              planName === scheduledTargetIdentifier);

          const isLoadingThis =
            isPending && loadingPlanCode?.toLowerCase() === planId;

          const isDowngrade =
            currentPrice !== null && plan.priceValue < currentPrice;

          const previousPlan = planIdx > 0 ? plans[planIdx - 1] : null;

          const prevFeatureMap = new Map<string, string | number | undefined>();

          plans.slice(0, planIdx).forEach((previous) => {
            previous.features?.forEach((feature) => {
              const key = feature.label.toLowerCase().split(":")[0].trim();

              prevFeatureMap.set(
                key,
                feature.value as string | number | undefined,
              );
            });
          });

          const rawFeatures = plan.features || [];

          const additionalFeatures = rawFeatures.filter((feature) => {
            const key = feature.label.toLowerCase().split(":")[0].trim();

            if (!prevFeatureMap.has(key)) {
              return true;
            }

            const previousValue = prevFeatureMap.get(key);

            if (
              feature.value !== undefined &&
              feature.value !== previousValue
            ) {
              return true;
            }

            return false;
          });

          const ctaLabel = isCurrent
            ? "Manage plan"
            : currentPrice === null
              ? `Choose ${plan.name}`
              : isDowngrade
                ? `Downgrade to ${plan.name}`
                : `Upgrade to ${plan.name}`;

          return (
            <Card
              key={plan.id}
              className={cn(
                "relative flex min-h-136 w-full flex-col rounded-2xl border! border-border! bg-card p-6 shadow-sm transition-all sm:w-[calc(50%-0.625rem)] xl:w-[calc(33.333%-1rem)]",
                isCurrent
                  ? "border-2! border-brand-accent! bg-brand-accent/5 shadow-sm"
                  : isScheduledTarget
                    ? "border-2! border-amber-500! bg-amber-500/5 shadow-sm"
                    : "bg-white hover:border-gray-300! hover:shadow-md dark:hover:border-neutral-700!",
              )}
            >
              {isCurrent && (
                <div className="absolute right-4 top-4 z-10 sm:right-5 sm:top-5">
                  <Badge className="gap-1 rounded-full bg-brand-accent px-3 py-2 text-[11px] font-semibold text-white shadow-none hover:bg-brand-accent/90 sm:px-4 sm:py-3 sm:text-xs">
                    <Crown className="h-3.5 w-3.5 fill-current" />
                    <span>Current plan</span>
                  </Badge>
                </div>
              )}

              {isScheduledTarget && !isCurrent && (
                <div className="absolute right-4 top-4 z-10 sm:right-5 sm:top-5">
                  <Badge className="gap-1 rounded-full bg-amber-500 px-3 py-2 text-[11px] font-semibold text-white shadow-none hover:bg-amber-600 sm:px-4 sm:py-3 sm:text-xs">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Upcoming plan</span>
                  </Badge>
                </div>
              )}

              <div className="flex h-full flex-1 flex-col">
                <div className="min-h-25">
                  <div className="flex items-start justify-between gap-3 pr-24 sm:pr-28">
                    <h3 className="text-xl font-bold tracking-tight text-foreground">
                      {plan.name}
                    </h3>
                  </div>

                  <p className="mt-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
                    {plan.description}
                  </p>
                </div>

                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold tracking-tight text-foreground">
                    {plan.price}
                  </span>

                  <span className="text-sm font-medium text-muted-foreground">
                    {plan.priceSuffix}
                  </span>
                </div>

                <div className="mt-5 flex min-h-11.5 items-center gap-2.5 rounded-xl border border-border/80 bg-white px-3.5 py-2.5 dark:bg-background">
                  <Users className="h-4 w-4 shrink-0 text-muted-foreground" />

                  <span className="text-xs font-semibold text-foreground">
                    {plan.seatLimitText} agent seats included
                  </span>
                </div>

                <div
                  className={cn(
                    "mt-6 flex-1 border-t pt-5",
                    isCurrent
                      ? "border-t-brand-accent/50!"
                      : isScheduledTarget
                        ? "border-t-amber-500/50!"
                        : "border-t-border",
                  )}
                >
                  {previousPlan ? (
                    <>
                      <div className="flex items-start gap-2.5 rounded-lg px-1 py-2">
                        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />

                        <p className="text-xs font-medium text-foreground">
                          Everything in {previousPlan.name}, plus:
                        </p>
                      </div>

                      <ul className="mt-3.5 space-y-3">
                        {(additionalFeatures.length > 0
                          ? additionalFeatures
                          : [
                              {
                                label: "Additional capabilities included",
                                value: "",
                              },
                            ]
                        ).map((feature, index) => (
                          <li key={index} className="flex items-start gap-2.5">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent stroke-[2.5]" />

                            <span className="text-xs font-medium text-muted-foreground">
                              {feature.label}

                              {typeof feature.value === "string" ||
                              typeof feature.value === "number"
                                ? `: ${feature.value}`
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <ul className="space-y-3">
                      {rawFeatures.map((feature, index) => (
                        <li key={index} className="flex items-start gap-2.5">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 stroke-[2.5]" />

                          <span className="text-xs font-medium text-muted-foreground">
                            {feature.label}

                            {typeof feature.value === "string" ||
                            typeof feature.value === "number"
                              ? `: ${feature.value}`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="mt-6 flex flex-col gap-2.5">
                  {isCurrent ? (
                    <>
                      {isPendingCancellation || hasScheduledDowngrade ? (
                        <>
                          <div className="flex min-h-11.5 items-center justify-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-3 text-center text-xs font-medium text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
                            <Clock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />

                            <span>
                              {isPendingCancellation
                                ? renewalDate
                                  ? `Ends on ${renewalDate}`
                                  : "Ends at the end of this period"
                                : `Changes to ${scheduledChange?.planName} on ${
                                    scheduledChangeDate ??
                                    renewalDate ??
                                    "your renewal date"
                                  }`}
                            </span>
                          </div>

                          <Button
                            variant="outline"
                            onClick={() => setIsUndoConfirmOpen(true)}
                            className="h-11 w-full gap-2 rounded-xl border border-emerald-600 bg-background text-sm font-medium text-emerald-700 shadow-none hover:bg-emerald-50/50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                          >
                            <RotateCcw className="h-4 w-4" />

                            {isPendingCancellation
                              ? "Reactivate my plan"
                              : "Keep my current plan"}
                          </Button>
                        </>
                      ) : (
                        canCancelCurrent && (
                          <Button
                            variant="ghost"
                            disabled={isPending}
                            onClick={openCancelDialog}
                            className="h-11 w-full rounded-xl border border-red-200 bg-background text-sm font-medium text-red-600 shadow-none hover:bg-red-50 hover:text-red-700 dark:border-red-900/50 dark:hover:bg-red-950/30"
                          >
                            Cancel subscription
                          </Button>
                        )
                      )}
                    </>
                  ) : isScheduledTarget ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled
                      className="h-11 w-full gap-2 rounded-xl border-amber-500! bg-amber-50/70 text-sm font-semibold text-amber-800 shadow-none dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                      <Clock className="h-4 w-4 shrink-0" />

                      <span>
                        Effective on{" "}
                        {scheduledChangeDate ??
                          renewalDate ??
                          "your renewal date"}
                      </span>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant={isDowngrade ? "outline" : "default"}
                      disabled={isPending}
                      onClick={() => openSwitchDialog(plan)}
                      className={cn(
                        "h-11 w-full gap-2 rounded-xl text-sm font-semibold shadow-none transition-colors",
                        isDowngrade
                          ? "border-border text-emerald-700 hover:border-emerald-600 hover:bg-emerald-50/30 dark:text-emerald-400 dark:hover:bg-emerald-950/20"
                          : "bg-brand-accent text-white hover:bg-brand-accent/90",
                      )}
                    >
                      {isLoadingThis && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}

                      <span>{ctaLabel}</span>
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <AlertDialog
        open={isOpen}
        onOpenChange={(open) => !open && handleClose()}
      >
        <AlertDialogContent
          onAnimationEnd={handleAnimationEnd}
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
      max-h-[calc(100dvh-2rem)]
      overflow-y-auto
    "
        >
          <AlertDialogHeader className="block px-6 pt-5 pb-4 text-left">
            <div className="flex items-center justify-between gap-4">
              <AlertDialogTitle className="text-xl font-bold text-foreground">
                {selectedSwitchLabel
                  ? `${selectedSwitchLabel}?`
                  : "Switch Plan"}
              </AlertDialogTitle>

              <AlertDialogCancel
                disabled={isPending}
                onClick={handleClose}
                className="
            absolute
            right-4
            top-4
            z-20
            flex
            size-8
            items-center
            justify-center
            rounded-md
            border-0
            bg-transparent
            p-0
            text-muted-foreground
            shadow-none
            hover:bg-transparent
            hover:text-foreground
            focus:outline-none
            focus:ring-2
            focus:ring-current/20
            disabled:pointer-events-none
          "
                aria-label="Close"
              >
                <X className="size-4" />
              </AlertDialogCancel>
            </div>

            <AlertDialogDescription asChild>
              <div className="mt-4 space-y-3">
                {dialogTiming?.headline && (
                  <ModalNotice
                    icon={Zap}
                    title={`Takes effect: ${dialogTiming.headline}`}
                  >
                    {dialogTiming.body}
                  </ModalNotice>
                )}

                {isUpgradeTarget && (
                  <>
                    {upgradeAmount > 0 && target && (
                      <div className="w-full rounded-xl border border-border px-4 py-3.5 text-left">
                        <p className="text-sm font-semibold text-foreground">
                          Price breakdown
                        </p>

                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between gap-4 text-sm">
                            <span className="text-muted-foreground">
                              {target.name} plan
                            </span>

                            <span className="font-semibold text-foreground">
                              ${target.priceValue?.toFixed(2)}/mo
                            </span>
                          </div>

                          {currentPlan && (
                            <div className="flex items-center justify-between gap-4 text-sm">
                              <span className="text-emerald-600">
                                {currentPlan.name} already paid this period
                              </span>

                              <span className="font-semibold text-emerald-600">
                                -${currentPlanRate.toFixed(2)}
                              </span>
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-4 border-t border-border pt-2 text-sm">
                            <span className="font-semibold text-foreground">
                              Amount due today
                            </span>

                            <span className="font-bold text-foreground">
                              ${upgradeAmount?.toFixed(2)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
                            <span>From next month</span>

                            <span>${target.priceValue?.toFixed(2)}/mo</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <ModalNotice icon={Info} tone="neutral">
                      You&apos;ll be taken to PayPal to approve the new
                      subscription. Nothing changes until you complete that
                      step.
                    </ModalNotice>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="mx-0 mb-0 gap-3 px-4 py-4 sm:justify-end">
            <AlertDialogCancel
              disabled={isPending}
              onClick={handleClose}
              className={cn(MODAL_BUTTON, "mt-0")}
            >
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                if (selectedPlanForSwitch) {
                  executePlanSwitch(selectedPlanForSwitch);
                }
              }}
              className={cn(
                MODAL_BUTTON,
                "bg-brand-accent hover:bg-brand-accent/90",
              )}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DowngradeDialog
        tenantSlug={tenantSlug}
        open={Boolean(downgradeTarget)}
        onOpenChange={(open) => {
          if (!open) setDowngradeTarget(null);
        }}
        targetPlan={downgradeTarget}
        currentPlan={currentPlan}
        usedSeats={usedSeats}
        totalSeats={totalSeats}
        renewalDate={renewalDate}
        scheduledToPlan={billingData?.scheduledChange?.planName ?? null}
      />

      {billingData && (
        <CancelSubscriptionDialog
          tenantSlug={tenantSlug}
          open={isCancelOpen}
          onOpenChange={setIsCancelOpen}
          billingData={billingData}
          freePlan={freePlan ?? null}
        />
      )}
      {(isPendingCancellation || hasScheduledDowngrade) && (
        <AlertDialog
          open={isUndoConfirmOpen}
          onOpenChange={setIsUndoConfirmOpen}
        >
          <AlertDialogContent
            className="
              w-[calc(100%-2rem)]
              max-w-md
              rounded-2xl
              border
              border-border
              bg-background
              p-6
              shadow-xl
            "
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-bold text-foreground">
                {isPendingCancellation
                  ? "Reactivate Subscription?"
                  : "Cancel Scheduled Plan Switch?"}
              </AlertDialogTitle>

              <AlertDialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {isPendingCancellation
                  ? `This will reactivate your subscription so it stays active past ${
                      renewalDate ?? "your current billing period"
                    }. You will continue to be billed on your normal renewal schedule.`
                  : `This will cancel your scheduled change to ${
                      scheduledChange?.planName ?? "the new plan"
                    }. You will remain on your current ${
                      currentPlan?.name ?? ""
                    } plan.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogCancel
              disabled={isPending}
              className=" absolute right-4 top-4 h-8 w-8 rounded-full border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent
              hover:text-foreground focus:ring-0 focus:ring-offset-0 "
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </AlertDialogCancel>

            <AlertDialogFooter className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogCancel
                disabled={isPending}
                className={cn(MODAL_BUTTON, "mt-0 w-full sm:w-auto")}
              >
                Go back
              </AlertDialogCancel>

              <AlertDialogAction asChild disabled={isPending}>
                <UndoScheduledChangeButton
                  tenantSlug={tenantSlug}
                  onDone={() => setIsUndoConfirmOpen(false)}
                  label={
                    isPendingCancellation
                      ? "Confirm reactivation"
                      : "Keep current plan"
                  }
                  className={cn(
                    MODAL_BUTTON,
                    "w-full sm:w-auto hover:text-white",
                  )}
                />
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
