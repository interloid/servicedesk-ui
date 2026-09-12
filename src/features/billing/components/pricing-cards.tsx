"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Info,
  Layers,
  Loader2,
  Settings,
  Users,
  X,
  Zap,
} from "lucide-react";
import { FormattedPlan } from "../types";
import { toast } from "sonner";
import { changeTenantPlanAction } from "../billing-actions";
import type { BillingDashboardData } from "../services/billing-dashboard.service";
import { tenantPath } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { DowngradeDialog } from "./downgrade-dialog";
import { MODAL_BUTTON, MODAL_BUTTON_PRIMARY } from "./modal-buttons";
import { ModalNotice } from "./modal-notice";

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

        // A deferred downgrade changes nothing today, so reloading would just
        // show the old plan and look like the request failed. Say when it
        // takes effect instead.
        if (res.scheduled) {
          announceScheduled(plan.name, res.effectiveAt ?? null);
          setSelectedPlanForSwitch(null);
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

  const activeTarget = (currentPlanCode || "").trim().toLowerCase();

  const currentPlan =
    plans.find(
      (p) =>
        (p.id || "").trim().toLowerCase() === activeTarget ||
        (p.code || "").trim().toLowerCase() === activeTarget,
    ) ?? null;

  // plans.code holds PayPal plan ids (P-.. / F-..), so rank plans by monthly
  // price rather than by matching names inside the code.
  const currentPrice = currentPlan?.priceValue ?? null;

  const freePlan = plans.find((p) => p.priceValue === 0);

  const canCancelCurrent =
    currentPlan !== null &&
    currentPlan.priceValue > 0 &&
    freePlan !== undefined &&
    freePlan.id !== currentPlan.id;

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
    router.push(`/${tenantSlug}/account/billing/cancel?from=plans`);
  };

  const usedSeats = billingData?.seats?.used ?? 0;
  const totalSeats = billingData?.seats?.total ?? 0;
  const renewalDate =
    billingData?.renewalDate && billingData.renewalDate !== "N/A"
      ? billingData.renewalDate
      : null;

  // Calculate prorated credit for upgrades based on remaining days in current billing period
  const renewalDateRaw = billingData?.renewalDateRaw;
  const currentPlanRate = billingData?.plan?.rateValue ?? 0;
  const proratedCredit = (() => {
    if (!renewalDateRaw || currentPlanRate <= 0) return 0;
    const periodEnd = new Date(renewalDateRaw);
    const now = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000,
    );
    const totalDays = Math.max(
      1,
      Math.ceil(
        (periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000),
      ),
    );
    const remainingDays = Math.max(
      0,
      Math.ceil((periodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
    );
    return (
      Math.round((currentPlanRate * remainingDays * 100) / totalDays) / 100
    );
  })();

  const target = selectedPlanForSwitch;
  const isUpgradeTarget =
    currentPrice !== null &&
    target !== null &&
    target.priceValue > currentPrice;

  // Calculate the actual amount user will pay after prorated credit
  const upgradeAmount =
    isUpgradeTarget && target
      ? Math.round(Math.max(0, target.priceValue - proratedCredit) * 100) / 100
      : 0;

  const dialogTiming = (() => {
    if (!target) return { headline: "", body: "", deferred: false };

    const hasCredit = proratedCredit > 0;
    return {
      headline: "As soon as PayPal checkout is approved",
      body: hasCredit
        ? `You'll pay $${upgradeAmount.toFixed(2)} today ($${target.priceValue.toFixed(2)} minus your $${proratedCredit.toFixed(2)} credit for unused ${currentPlan?.name ?? "current plan"} time). This one-time payment unlocks ${target.name} now, and from next month you'll be billed the full ${target.price}${target.priceSuffix}.`
        : `You'll be redirected to PayPal to approve the new ${target.name} subscription. Your current plan stays active until it's live, then you'll be billed ${target.price}${target.priceSuffix}.`,
      deferred: false,
    };
  })();

  const manageBillingHref = tenantPath(tenantSlug, "/account/billing");

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6 items-stretch">
        {plans.map((plan, planIdx) => {
          const planId = (plan.id || "").trim().toLowerCase();
          const planCode = (plan.code || "").trim().toLowerCase();

          const isCurrent =
            Boolean(activeTarget) &&
            (planId === activeTarget || planCode === activeTarget);

          const isLoadingThis =
            isPending && loadingPlanCode?.toLowerCase() === planId;

          const isDowngrade =
            currentPrice !== null && plan.priceValue < currentPrice;
          const previousPlan = planIdx > 0 ? plans[planIdx - 1] : null;

          const prevFeatureMap = new Map<string, string | number | undefined>();
          plans.slice(0, planIdx).forEach((p) => {
            p.features?.forEach((f) => {
              const key = f.label.toLowerCase().split(":")[0].trim();
              prevFeatureMap.set(key, f.value as string | number | undefined);
            });
          });

          const rawFeatures = plan.features || [];

          const additionalFeatures = rawFeatures.filter((feature) => {
            const key = feature.label.toLowerCase().split(":")[0].trim();
            if (!prevFeatureMap.has(key)) return true;

            const prevVal = prevFeatureMap.get(key);
            if (feature.value !== undefined && feature.value !== prevVal) {
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
              className={`relative flex h-full flex-col rounded-2xl p-5 sm:p-7 transition-all ${
                isCurrent
                  ? "border-brand-accent ring-1 ring-brand-accent shadow-xl shadow-brand-accent/5"
                  : "border-border shadow-sm hover:border-brand-accent/40 hover:shadow-md"
              }`}
            >
              <div className="flex h-full flex-1 flex-col">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base sm:text-lg font-bold tracking-tight text-foreground">
                    {plan.name}
                  </h3>

                  {isCurrent && (
                    <Badge className="shrink-0 bg-brand-accent text-primary-foreground hover:bg-brand-accent shadow-none">
                      Current plan
                    </Badge>
                  )}
                </div>

                <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-muted-foreground">
                  {plan.description}
                </p>

                <div className="mt-5 flex items-end gap-1.5">
                  <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                    {plan.price}
                  </span>
                  <span className="pb-1.5 text-xs sm:text-sm font-normal text-muted-foreground">
                    {plan.priceSuffix}
                  </span>
                </div>

                <div
                  className={`mt-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 ${
                    isCurrent
                      ? "border-brand-accent/30 bg-brand-accent/5"
                      : "border-border bg-muted/40"
                  }`}
                >
                  <Users
                    className={`h-4 w-4 shrink-0 ${
                      isCurrent ? "text-brand-accent" : "text-muted-foreground"
                    }`}
                  />
                  <span className="text-xs font-semibold text-foreground">
                    {plan.seatLimitText} agent seats included
                  </span>
                </div>

                <div className="mt-5 flex-1 border-t border-border pt-5">
                  {previousPlan ? (
                    <>
                      <div className="flex items-start gap-2.5 rounded-lg bg-muted/40 px-3 py-2.5">
                        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <p className="text-xs font-medium leading-relaxed text-foreground">
                          Everything in {previousPlan.name}, plus:
                        </p>
                      </div>

                      <ul className="mt-3 space-y-2.5">
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
                            <span className="text-xs leading-relaxed text-muted-foreground">
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
                    <ul className="space-y-2.5">
                      {rawFeatures.map((feature, index) => (
                        <li key={index} className="flex items-start gap-2.5">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent stroke-[2.5]" />
                          <span className="text-xs leading-relaxed text-muted-foreground">
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
                      <Button
                        asChild
                        className="h-11 w-full gap-2 whitespace-nowrap bg-brand-accent text-primary-foreground shadow-none hover:bg-brand-accent/90"
                      >
                        <Link href={manageBillingHref}>
                          <Settings className="h-4 w-4" />
                          Manage plan
                        </Link>
                      </Button>
                      {canCancelCurrent && (
                        <Button
                          variant="ghost"
                          disabled={isPending}
                          onClick={openCancelDialog}
                          className="h-10 w-full border border-red-200 bg-background text-red-600 shadow-none transition-colors hover:bg-red-50 hover:text-red-700 dark:border-red-900/50 dark:hover:bg-red-950/30"
                        >
                          Cancel subscription
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button
                      variant={isDowngrade ? "outline" : "default"}
                      disabled={isPending}
                      onClick={() => openSwitchDialog(plan)}
                      className={`h-11 w-full gap-2 whitespace-nowrap font-semibold shadow-none transition-colors ${
                        isDowngrade
                          ? ""
                          : "bg-brand-accent text-primary-foreground hover:bg-brand-accent/90"
                      }`}
                    >
                      {isLoadingThis && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {ctaLabel}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <AlertDialog
        open={Boolean(selectedPlanForSwitch)}
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setSelectedPlanForSwitch(null);
          }
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
          <AlertDialogHeader className="block px-6 pt-5 pb-4 text-left">
            <div className="flex items-center justify-between gap-4">
              <AlertDialogTitle className="text-xl font-bold text-foreground">
                {selectedSwitchLabel}?
              </AlertDialogTitle>

              <button
                type="button"
                onClick={() => {
                  if (!isPending) {
                    setSelectedPlanForSwitch(null);
                  }
                }}
                disabled={isPending}
                className="-mr-1.5 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors duration-200 ease-out hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-[0.98]"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <AlertDialogDescription asChild>
              <div className="mt-4 space-y-3">
                <ModalNotice
                  icon={Zap}
                  title={`Takes effect: ${dialogTiming.headline}`}
                >
                  {dialogTiming.body}
                </ModalNotice>

                {isUpgradeTarget && (
                  <>
                    {proratedCredit > 0 && (
                      <div className="w-full rounded-xl border border-border px-4 py-3.5 text-left">
                        <p className="text-sm font-semibold text-foreground">
                          Price breakdown
                        </p>
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              {target?.name} plan
                            </span>
                            <span className="font-semibold text-foreground">
                              ${target?.priceValue.toFixed(2)}/mo
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-emerald-600">
                              {currentPlan?.name} remaining credit
                            </span>
                            <span className="font-semibold text-emerald-600">
                              -${proratedCredit.toFixed(2)}
                            </span>
                          </div>
                          <div className="border-t border-border pt-2 flex items-center justify-between text-sm">
                            <span className="font-semibold text-foreground">
                              Amount due today (one-time)
                            </span>
                            <span className="font-bold text-foreground">
                              ${upgradeAmount.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>From next month</span>
                            <span>${target?.priceValue.toFixed(2)}/mo</span>
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

          <AlertDialogFooter className="mx-0 mb-0 gap-3 border-t border-border px-4 py-4 sm:justify-end">
            <AlertDialogCancel
              disabled={isPending}
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
              className={cn(MODAL_BUTTON, MODAL_BUTTON_PRIMARY)}
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
    </>
  );
}
