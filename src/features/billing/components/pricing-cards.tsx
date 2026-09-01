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

        setSelectedPlanForSwitch(null);
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

  const getPlanOrderIndex = (planCode: string) => {
    const code = planCode.toLowerCase();
    if (code.includes("free") || code.includes("starter")) return 0;
    if (code.includes("pro")) return 1;
    if (code.includes("business") || code.includes("enterprise")) return 2;
    return 1;
  };

  const currentOrderIndex = getPlanOrderIndex(activeTarget);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch max-w-6xl mx-auto pt-6 pb-12 px-4">
        {plans.map((plan, planIdx) => {
          const planId = (plan.id || "").trim().toLowerCase();
          const planCode = (plan.code || "").trim().toLowerCase();

          const isCurrent =
            Boolean(activeTarget) &&
            (planId === activeTarget || planCode === activeTarget);

          const isLoadingThis =
            isPending && loadingPlanCode?.toLowerCase() === planId;

          const planOrderIndex = getPlanOrderIndex(planCode);
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
              className={`flex flex-col justify-between h-full rounded-xl p-6 transition-all shadow-none ring-0 ${
                isCurrent
                  ? "border-2 border-brand-accent ring-0"
                  : "border border-border"
              }`}
            >
              <div className="flex-1 flex flex-col">
                <CardHeader className="p-0 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <CardTitle className="text-base font-bold text-card-foreground">
                      {plan.name}
                    </CardTitle>

                    {isCurrent && (
                      <Badge className="bg-primary/10 text-primary hover:bg-primary/10 font-medium px-2 py-0.5 text-xs rounded-full shadow-none border-none">
                        Current plan
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-extrabold tracking-tight text-card-foreground">
                      {plan.price}
                    </span>

                    {plan.priceSuffix && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {plan.priceSuffix}
                      </span>
                    )}
                  </div>

                  <CardDescription className="text-xs text-muted-foreground font-normal min-h-9 border-b border-border pb-4 leading-relaxed">
                    {plan.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="p-0 pt-4 flex-1">
                  <ul className="space-y-3">
                    {displayFeatures.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2.5">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5 stroke-[2.5]" />
                        <span
                          className={`text-xs ${
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

              <CardFooter className="py-6 bg-transparent mt-auto">
                {isCurrent ? (
                  <Button
                    disabled
                    variant="outline"
                    className="h-10 w-full border border-border text-primary bg-background cursor-default disabled:opacity-100 font-semibold text-xs rounded-lg shadow-none hover:bg-background"
                  >
                    Your current plan
                  </Button>
                ) : (
                  <Button
                    disabled={isPending}
                    onClick={() => setSelectedPlanForSwitch(plan)}
                    className="h-10 w-full gap-2 bg-brand-accent text-primary-foreground hover:bg-brand-accent/90 font-semibold text-xs rounded-lg shadow-none transition-colors"
                  >
                    {isLoadingThis && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}

                    {planOrderIndex < currentOrderIndex
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
          }
        }}
      >
        <AlertDialogContent
          className="
    w-[calc(100%-2rem)]
    max-w-225
    sm:max-w-225
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
                }
              }}
              disabled={isPending}
              className="absolute right-5 top-5 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            <AlertDialogTitle className="pr-10 text-xl font-bold text-foreground">
              Switch to {selectedPlanForSwitch?.name}?
            </AlertDialogTitle>

            <AlertDialogDescription asChild>
              <div className="mt-3 w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-900/50 dark:bg-orange-950/30">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600 dark:text-orange-400" />

                  <p className="text-sm font-medium leading-5 text-orange-900 dark:text-orange-200">
                    {selectedPlanForSwitch?.name?.toLowerCase() === "free" ? (
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

          <AlertDialogFooter className="border-t border-border px-6 py-3 pb-5 flex flex-row justify-end gap-3 sm:space-x-0">
            <AlertDialogCancel
              disabled={isPending}
              className="mt-0 h-10 rounded-xl border-border bg-background px-5 font-semibold text-foreground hover:bg-muted"
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
              className="h-10 rounded-xl bg-brand-accent px-5 font-semibold text-primary-foreground hover:bg-brand-accent/90"
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
