"use client";

import React, { useState, useTransition } from "react";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import { FormattedPlan } from "../types";
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
          alert(res.error || "Failed to switch plan.");
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
        alert(
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

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        {plans.map((plan) => {
          const planId = (plan.id || "").trim().toLowerCase();
          const planCode = (plan.code || "").trim().toLowerCase();

          const isCurrent =
            Boolean(activeTarget) &&
            (planId === activeTarget || planCode === activeTarget);

          const isLoadingThis =
            isPending && loadingPlanCode?.toLowerCase() === planId;

          return (
            <Card
              key={plan.id}
              className={`flex flex-col justify-between rounded-2xl p-6 pb-8 transition-all ${
                isCurrent
                  ? "border-teal-700/60 ring-1 ring-teal-700/60 shadow-none drop-shadow-none"
                  : "border-slate-200/80 shadow-none drop-shadow-none"
              }`}
            >
              <div>
                <CardHeader className="p-0 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <CardTitle className="text-lg font-bold text-slate-900">
                      {plan.name}
                    </CardTitle>

                    {isCurrent && (
                      <Badge
                        variant="secondary"
                        className="bg-teal-50/80 text-teal-800 hover:bg-teal-50 font-medium px-2.5 py-0.5 text-xs rounded-full shadow-none"
                      >
                        Current plan
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-baseline gap-1.5 pt-1">
                    <span className="text-3xl font-extrabold tracking-tight text-slate-900">
                      {plan.price}
                    </span>

                    {plan.priceSuffix && (
                      <span className="text-xs font-normal text-slate-500">
                        {plan.priceSuffix}
                      </span>
                    )}
                  </div>

                  <CardDescription className="text-xs text-slate-500 font-normal min-h-12 border-b border-slate-100 pb-4">
                    {plan.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="p-0 pt-4">
                  <ul className="space-y-3">
                    {plan.features?.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2.5">
                        <Check className="h-4 w-4 text-teal-700 shrink-0 mt-0.5" />
                        <span className="text-xs font-normal text-slate-700">
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

              <CardFooter className="py-4 bg-transparent">
                {isCurrent ? (
                  <Button
                    disabled
                    variant="outline"
                    className="h-11 w-full border-teal-700/30 text-teal-800 bg-transparent cursor-default disabled:opacity-100 font-semibold text-xs rounded-lg shadow-none"
                  >
                    Your current plan
                  </Button>
                ) : (
                  <Button
                    disabled={isPending}
                    onClick={() => setSelectedPlanForSwitch(plan)}
                    className="h-10 w-full gap-2 bg-teal-800 hover:bg-teal-900 text-white font-semibold text-xs rounded-lg shadow-none"
                  >
                    {isLoadingThis && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}

                    {plan.name?.toLowerCase() === "free"
                      ? "Downgrade to Free"
                      : `Switch to ${plan.name}`}
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
        <AlertDialogContent className="sm:max-w-lg w-full rounded-2xl p-6">
          <AlertDialogHeader className="space-y-4">
            <AlertDialogTitle className="text-xl font-bold text-slate-900">
              Switch to {selectedPlanForSwitch?.name}?
            </AlertDialogTitle>

            <AlertDialogDescription asChild>
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-amber-900">
                <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                <p className="text-sm leading-relaxed text-amber-900 font-medium">
                  Moving to {selectedPlanForSwitch?.name} takes effect at the
                  end of the current billing period. Features and seats above
                  that plan&apos;s limits will stop working then — export
                  anything you need first.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="mt-6 flex flex-row items-center justify-end gap-3 sm:space-x-0">
            <AlertDialogCancel
              disabled={isPending}
              className="mt-0 h-10 px-3 rounded-xl border-slate-200 text-teal-800 hover:bg-slate-50 font-semibold"
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
              className="rounded-xl h-10 px-3  bg-teal-800 text-white hover:bg-teal-900 font-semibold"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirm switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
