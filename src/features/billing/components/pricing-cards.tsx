"use client";

import React, { useState, useTransition } from "react";
import { Check, Loader2, AlertTriangle, X } from "lucide-react";
import { FormattedPlan } from "../types";
import { toast } from "sonner";
import { changeTenantPlanAction } from "../billing-actions";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
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

export function PricingCards({
  tenantSlug,
  currentPlanCode,
  plans,
}: {
  tenantSlug: string;
  currentPlanCode: string;
  plans: FormattedPlan[];
}) {
  const [isPending, startTransition] = useTransition();
  const [loadingPlanCode, setLoadingPlanCode] = useState<string | null>(null);
  const [selectedPlanForSwitch, setSelectedPlanForSwitch] =
    useState<FormattedPlan | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const executePlanSwitch = (plan: FormattedPlan) => {
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
          const when = res.effectiveAt
            ? new Date(res.effectiveAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "the end of your billing period";

          toast.success(
            `Switch to ${plan.name} scheduled for ${when}. You keep your current plan until then.`,
          );
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

  const currentPlanLabel =
    plans.find(
      (p) =>
        (p.id || "").trim().toLowerCase() === activeTarget ||
        (p.code || "").trim().toLowerCase() === activeTarget,
    )?.name ?? "your current plan";

  const currentPlan = plans.find(
    (p) =>
      (p.id || "").trim().toLowerCase() === activeTarget ||
      (p.code || "").trim().toLowerCase() === activeTarget,
  );

  // plans.code holds PayPal plan ids (P-1PL59890TT..., F-15e70eec-...), so rank
  // plans by monthly price rather than by matching names inside the code.
  const currentPrice = currentPlan?.priceValue ?? null;

  const freePlan = plans.find((p) => p.priceValue === 0);

  const canCancelCurrent =
    currentPlan !== undefined &&
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

  const openCancelDialog = () => {
    if (!freePlan) return;
    setConfirmingCancel(true);
    setSelectedPlanForSwitch(freePlan);
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 items-stretch max-w-6xl mx-auto pt-6 pb-12 px-2 sm:px-4">
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

          const filteredFeatures = rawFeatures.filter((feature) => {
            const key = feature.label.toLowerCase().split(":")[0].trim();
            if (!prevFeatureMap.has(key)) return true;

            const prevVal = prevFeatureMap.get(key);
            if (feature.value !== undefined && feature.value !== prevVal) {
              return true;
            }

            return false;
          });

          const displayFeatures = [...filteredFeatures];
          if (
            previousPlan &&
            !displayFeatures.some((f) =>
              f.label.toLowerCase().includes("everything in"),
            )
          ) {
            displayFeatures.unshift({
              label: `Everything in ${previousPlan.name}`,
              value: "",
            });
          }

          return (
            <Card
              key={plan.id}
              className={`flex flex-col justify-between h-full rounded-xl p-4 sm:p-5 md:p-6 transition-all shadow-none ring-0 ${
                isCurrent
                  ? "border-2 border-brand-accent ring-0"
                  : "border border-border ring-0"
              }`}
            >
              <div className="flex-1 flex flex-col">
                <CardHeader className="p-0 space-y-2.5 sm:space-y-3">
                  <div className="flex items-center gap-2.5">
                    <CardTitle className="text-sm sm:text-base font-bold text-card-foreground">
                      {plan.name}
                    </CardTitle>

                    {isCurrent && (
                      <Badge className="bg-primary/10 text-primary hover:bg-primary/10 font-medium px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs rounded-full shadow-none border-none">
                        Current plan
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-card-foreground">
                      {plan.price}
                    </span>

                    {plan.priceSuffix && (
                      <span className="text-[10px] sm:text-xs font-normal text-muted-foreground">
                        {plan.priceSuffix}
                      </span>
                    )}
                  </div>

                  <CardDescription className="text-[11px] sm:text-xs text-muted-foreground font-normal min-h-9 border-b border-border pb-3 sm:pb-4 leading-relaxed">
                    {plan.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="p-0 pt-3 sm:pt-4 flex-1">
                  <ul className="space-y-2 sm:space-y-2.5">
                    {displayFeatures.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary shrink-0 mt-0.5 stroke-[2.5]" />
                        <span
                          className={`text-[11px] sm:text-xs ${
                            feature.label
                              .toLowerCase()
                              .startsWith("everything in")
                              ? "font-semibold text-card-foreground"
                              : "font-normal text-muted-foreground"
                          }`}
                        >
                          {feature.label}
                          {typeof feature.value === "string" ||
                          typeof feature.value === "number"
                            ? `: ${feature.value}`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </div>

              <CardFooter className="py-4 sm:py-6 bg-transparent mt-auto">
                {isCurrent ? (
                  canCancelCurrent ? (
                    <Button
                      disabled={isPending}
                      onClick={openCancelDialog}
                      className="h-10 w-full gap-2 border border-red-200 text-red-600 bg-background hover:bg-red-50 hover:text-red-700 dark:border-red-900/50 dark:hover:bg-red-950/30 font-semibold text-xs rounded-lg shadow-none transition-colors whitespace-nowrap"
                    >
                      Cancel subscription
                    </Button>
                  ) : (
                    <Button
                      disabled
                      variant="outline"
                      className="h-10 w-full border border-border text-primary bg-background cursor-default disabled:opacity-100 font-semibold text-xs rounded-lg shadow-none hover:bg-background whitespace-nowrap"
                    >
                      Your current plan
                    </Button>
                  )
                ) : (
                  <Button
                    disabled={isPending}
                    onClick={() => setSelectedPlanForSwitch(plan)}
                    className={`h-10 w-full gap-2 font-semibold text-xs rounded-lg shadow-none transition-colors whitespace-nowrap ${
                      isDowngrade
                        ? "border border-border bg-background text-foreground hover:bg-muted"
                        : "bg-brand-accent text-primary-foreground hover:bg-brand-accent/90"
                    }`}
                  >
                    {isLoadingThis && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}

                    {currentPrice === null
                      ? `Choose ${plan.name}`
                      : isDowngrade
                        ? `Downgrade to ${plan.name}`
                        : `Upgrade to ${plan.name}`}
                  </Button>
                )}
              </CardFooter>
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
              {confirmingCancel
                ? "Are you sure you want to cancel your subscription?"
                : `${selectedSwitchLabel}?`}
            </AlertDialogTitle>

            <AlertDialogDescription asChild>
              <div className="mt-3 w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-900/50 dark:bg-orange-950/30">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600 dark:text-orange-400" />

                  <p className="text-sm font-medium leading-5 text-orange-900 dark:text-orange-200">
                    {confirmingCancel ? (
                      <>
                        Cancelling your {currentPlan?.name ?? currentPlanLabel}{" "}
                        subscription takes effect immediately — you&apos;ll be
                        moved to the Free plan, no further charges will be made,
                        and paid features and seats above the Free plan&apos;s
                        limits will stop working right away. Export anything you
                        need first.
                      </>
                    ) : selectedPlanForSwitch?.priceValue === 0 ? (
                      <>
                        Downgrading to Free takes effect immediately — your{" "}
                        {currentPlanLabel} subscription is cancelled right away
                        and won&apos;t be renewed. Features and seats above the
                        Free plan&apos;s limits will stop working immediately;
                        export anything you need first.
                      </>
                    ) : (
                      <>
                        Moving to {selectedPlanForSwitch?.name} takes effect as
                        soon as the new subscription is activated and the
                        payment is approved. Your current plan keeps working
                        until then — the existing subscription is only cancelled
                        once the new one is active.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="mx-0 mb-0 border-t border-border px-4 py-4">
            <AlertDialogCancel
              disabled={isPending}
              className="mt-0 h-10 rounded-xl border-border bg-background px-5 font-semibold text-foreground hover:bg-muted"
            >
              {confirmingCancel ? "Keep my plan" : "Cancel"}
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
                confirmingCancel
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-brand-accent text-primary-foreground hover:bg-brand-accent/90"
              }`}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmingCancel ? "Yes, cancel subscription" : "Confirm switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
