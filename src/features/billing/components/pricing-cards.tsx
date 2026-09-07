"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CreditCard,
  Info,
  Layers,
  Loader2,
  Settings,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { FormattedPlan } from "../types";
import { toast } from "sonner";
import { changeTenantPlanAction } from "../billing-actions";
import { BillingDashboardData } from "../services/billing-dashboard.service";
import {
  CardCheckoutDialog,
  type CardCheckoutTarget,
} from "./card-checkout-dialog";
import { tenantPath } from "@/lib/tenancy";
import { env } from "@/config/env";

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
  const [isPending, startTransition] = useTransition();
  const [loadingPlanCode, setLoadingPlanCode] = useState<string | null>(null);
  const [selectedPlanForSwitch, setSelectedPlanForSwitch] =
    useState<FormattedPlan | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // How the buyer wants to approve the new subscription. Both choices create
  // exactly one subscription through the same API call; "card" then confirms it
  // from hosted card fields on this page, "paypal" hands over to PayPal.
  const [fundingPreference, setFundingPreference] = useState<"paypal" | "card">(
    "paypal",
  );
  const [cardCheckout, setCardCheckout] = useState<CardCheckoutTarget | null>(
    null,
  );
  // In-app card fields need a PayPal capability that is granted per merchant.
  // Without it the fields render but never come alive, so the card option goes
  // to PayPal's own card page rather than a form the buyer cannot use.
  const cardFieldsEnabled = env.NEXT_PUBLIC_PAYPAL_CARD_FIELDS;

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
    setLoadingPlanCode(plan.id);

    startTransition(async () => {
      try {
        const res = await changeTenantPlanAction(
          tenantSlug,
          plan.id,
          fundingPreference,
        );

        if (!res.success) {
          toast.error(res.error || "Failed to switch plan.");
          return;
        }

        // The subscription now exists in APPROVAL_PENDING either way. With card
        // fields enabled the buyer confirms it here; otherwise both choices use
        // the redirect, which PayPal opens on its card form rather than its
        // sign-in because `fundingPreference` was sent as "card".
        if (
          cardFieldsEnabled &&
          fundingPreference === "card" &&
          res.subscriptionId
        ) {
          setCardCheckout({
            subscriptionId: res.subscriptionId,
            approvalUrl: res.approvalUrl ?? null,
            planName: plan.name,
            priceLabel: `${plan.price}${plan.priceSuffix}`,
          });
          setSelectedPlanForSwitch(null);
          setConfirmingCancel(false);
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
          setConfirmingCancel(false);
          return;
        }

        setSelectedPlanForSwitch(null);
        setConfirmingCancel(false);
        window.location.reload();
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

  const currentPlanLabel = currentPlan?.name ?? "your current plan";

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
    setFundingPreference("paypal");
    setSelectedPlanForSwitch(plan);
  };

  const openCancelDialog = () => {
    if (!freePlan) return;
    setConfirmingCancel(true);
    setSelectedPlanForSwitch(freePlan);
  };

  const usedSeats = billingData?.seats?.used ?? 0;
  const totalSeats = billingData?.seats?.total ?? 0;
  const renewalDate =
    billingData?.renewalDate && billingData.renewalDate !== "N/A"
      ? billingData.renewalDate
      : null;

  const target = selectedPlanForSwitch;
  const isFreeTarget = target?.priceValue === 0;
  const isUpgradeTarget =
    currentPrice !== null &&
    target !== null &&
    target.priceValue > currentPrice;
  const freeSeatLimit = freePlan?.seatLimit ?? 0;
  const targetSeatLimit = target?.seatLimit ?? 0;
  const seatsAtRisk = target ? Math.max(0, usedSeats - targetSeatLimit) : 0;
  const seatsAtRiskForFree = Math.max(0, usedSeats - freeSeatLimit);

  const dialogTiming = (() => {
    if (!target) return { headline: "", body: "", deferred: false };

    if (confirmingCancel || isFreeTarget) {
      return renewalDate
        ? {
            headline: "End of billing period",
            body: `You keep ${currentPlanLabel} — including its features and agent seats — until ${renewalDate}. No further charges are made, and the switch to the Free plan applies when your billing period ends.`,
            deferred: true,
          }
        : {
            headline: "Immediately",
            body: "It takes effect right now, and no further charges will be made.",
            deferred: false,
          };
    }

    if (isUpgradeTarget) {
      return {
        headline:
          fundingPreference === "card"
            ? "As soon as your card is confirmed"
            : "As soon as PayPal checkout is approved",
        body:
          fundingPreference === "card"
            ? `You'll enter your card details ${
                cardFieldsEnabled ? "on the next step" : "on PayPal's card form"
              }. Your current plan stays active until the card is confirmed, then you'll be billed ${target.price}${target.priceSuffix}.`
            : `You'll be redirected to PayPal to approve the new ${target.name} subscription. Your current plan stays active until it's live, then you'll be billed ${target.price}${target.priceSuffix}.`,
        deferred: false,
      };
    }

    // Downgrade to a paid (cheaper) plan.
    return renewalDate
      ? {
          headline: "End of billing period",
          body: `You keep ${currentPlanLabel} — including its features and agent seats — until ${renewalDate}. From the next billing cycle you'll be billed the ${target.name} rate of ${target.price}${target.priceSuffix}.`,
          deferred: true,
        }
      : {
          headline: "Immediately",
          body: `It takes effect right now. From your next billing cycle you'll be billed the ${target.name} rate of ${target.price}${target.priceSuffix}.`,
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
                      disabled={isPending}
                      onClick={() => openSwitchDialog(plan)}
                      className={`h-11 w-full gap-2 whitespace-nowrap font-semibold shadow-none transition-colors ${
                        isDowngrade
                          ? "border border-border bg-background text-foreground hover:bg-muted"
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
            setConfirmingCancel(false);
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
          <AlertDialogHeader className="relative px-6 pt-5 pb-4">
            <button
              type="button"
              onClick={() => {
                if (!isPending) {
                  setSelectedPlanForSwitch(null);
                  setConfirmingCancel(false);
                }
              }}
              disabled={isPending}
              className="absolute right-5 top-5 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            <AlertDialogTitle className="pr-10 text-xl font-bold text-foreground">
              {confirmingCancel || isFreeTarget
                ? `Cancel your subscription and move to the Free plan?`
                : `${selectedSwitchLabel}?`}
            </AlertDialogTitle>

            <AlertDialogDescription asChild>
              <div className="mt-4 space-y-3">
                <div className="w-full rounded-xl border border-brand-accent/20 bg-brand-accent/3 px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    {dialogTiming.deferred ? (
                      <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-brand-accent" />
                    ) : (
                      <Zap className="mt-0.5 h-5 w-5 shrink-0 text-brand-accent" />
                    )}

                    <div className="space-y-1 text-sm leading-5 text-foreground">
                      <p className="font-semibold">
                        Takes effect: {dialogTiming.headline}
                      </p>
                      <p className="font-normal text-muted-foreground">
                        {dialogTiming.body}
                      </p>
                    </div>
                  </div>
                </div>

                {(confirmingCancel || isFreeTarget) &&
                  seatsAtRiskForFree > 0 && (
                    <div className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 dark:border-amber-900/50 dark:bg-amber-950/30">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="space-y-1 text-sm leading-5">
                          <p className="font-semibold text-amber-900 dark:text-amber-200">
                            Agent seat usage: {usedSeats} of {totalSeats} seats
                          </p>
                          <p className="font-normal text-amber-800/90 dark:text-amber-300/90">
                            The Free plan includes {freeSeatLimit} agent seats.
                            You&apos;ll need to free up {seatsAtRiskForFree}{" "}
                            seat
                            {seatsAtRiskForFree === 1 ? "" : "s"} before this
                            change applies.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                {!confirmingCancel &&
                  !isFreeTarget &&
                  isDowngradeLike(target, currentPrice) &&
                  seatsAtRisk > 0 && (
                    <div className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 dark:border-amber-900/50 dark:bg-amber-950/30">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="space-y-1 text-sm leading-5">
                          <p className="font-semibold text-amber-900 dark:text-amber-200">
                            Agent seat usage: {usedSeats} of {totalSeats} seats
                          </p>
                          <p className="font-normal text-amber-800/90 dark:text-amber-300/90">
                            {target?.name} includes {targetSeatLimit} agent
                            seats. You&apos;ll need to free up {seatsAtRisk}{" "}
                            seat
                            {seatsAtRisk === 1 ? "" : "s"} before this change
                            applies.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                {!isFreeTarget && !confirmingCancel && isUpgradeTarget && (
                  <>
                    <div className="w-full rounded-xl border border-border px-4 py-3.5">
                      <p className="text-sm font-semibold text-foreground">
                        How do you want to pay?
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {(
                          [
                            {
                              value: "paypal" as const,
                              icon: Wallet,
                              label: "PayPal account",
                              hint: "Sign in and pay with your balance or a saved card.",
                            },
                            {
                              value: "card" as const,
                              icon: CreditCard,
                              label: "Debit or credit card",
                              hint: cardFieldsEnabled
                                ? "Enter your card here, without leaving this page."
                                : "Pay by card on PayPal's secure page.",
                            },
                          ] as const
                        ).map((option) => {
                          const OptionIcon = option.icon;
                          const isSelected = fundingPreference === option.value;

                          return (
                            <button
                              key={option.value}
                              type="button"
                              disabled={isPending}
                              aria-pressed={isSelected}
                              onClick={() => setFundingPreference(option.value)}
                              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                                isSelected
                                  ? "border-brand-accent bg-brand-accent/5"
                                  : "border-border bg-background hover:bg-muted/50"
                              }`}
                            >
                              <OptionIcon
                                className={`mt-0.5 h-4 w-4 shrink-0 ${
                                  isSelected
                                    ? "text-brand-accent"
                                    : "text-muted-foreground"
                                }`}
                              />
                              <span className="space-y-0.5">
                                <span className="block text-sm font-semibold text-foreground">
                                  {option.label}
                                </span>
                                <span className="block text-xs font-normal leading-4 text-muted-foreground">
                                  {option.hint}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm leading-5 text-muted-foreground">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
                      <p>
                        {fundingPreference === "card"
                          ? cardFieldsEnabled
                            ? "You'll enter your card on the next step without leaving this page. PayPal processes it and we only ever see the brand and last four digits. Nothing changes until the card is confirmed."
                            : "You'll be taken to PayPal's secure checkout to pay by card. Whether PayPal offers a card form or asks you to sign in first depends on your PayPal session and the merchant's guest-checkout setting. Nothing changes until you complete that step."
                          : "You'll be taken to PayPal to approve the new subscription. Nothing changes until you complete that step."}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="mx-0 mb-0 border-t border-border px-4 py-4">
            <AlertDialogCancel
              disabled={isPending}
              className="mt-0 h-10 rounded-xl border-border bg-background px-5 font-semibold text-foreground hover:bg-muted"
            >
              {confirmingCancel || isFreeTarget ? "Keep my plan" : "Cancel"}
            </AlertDialogCancel>

            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();

                if (selectedPlanForSwitch) {
                  executePlanSwitch(selectedPlanForSwitch);
                }
              }}
              className={`h-10 rounded-xl px-5 font-semibold shadow-none transition-colors ${
                confirmingCancel || isFreeTarget
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-brand-accent text-primary-foreground hover:bg-brand-accent/90"
              }`}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmingCancel || isFreeTarget
                ? "Yes, cancel subscription"
                : isUpgradeTarget && fundingPreference === "card"
                  ? cardFieldsEnabled
                    ? "Continue to card details"
                    : "Continue to card payment"
                  : "Confirm switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CardCheckoutDialog
        // Keyed so each checkout starts from a clean form rather than
        // inheriting the phase and errors of the one before it.
        key={cardCheckout?.subscriptionId ?? "idle"}
        open={cardCheckout !== null}
        onOpenChange={(open) => {
          if (!open) setCardCheckout(null);
        }}
        tenantSlug={tenantSlug}
        target={cardCheckout}
        onPaid={({ planName, scheduled, effectiveAt }) => {
          setCardCheckout(null);

          if (scheduled) {
            announceScheduled(planName, effectiveAt);
            return;
          }

          toast.success(`You're on ${planName}.`);
          window.location.reload();
        }}
      />
    </>
  );
}

function isDowngradeLike(
  target: FormattedPlan | null,
  currentPrice: number | null,
): boolean {
  return (
    target !== null &&
    target.priceValue > 0 &&
    currentPrice !== null &&
    target.priceValue < currentPrice
  );
}
