"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { XCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { abortPlanSwitchAction } from "@/features/billing/billing-actions";

type CancelState = "checking" | "restored" | "noop" | "error";

export default function PaymentCancelPage() {
  const router = useRouter();
  const params = useParams();
  const [countdown, setCountdown] = useState(5);
  const [state, setState] = useState<CancelState>("checking");
  const [planName, setPlanName] = useState<string | null>(null);
  const tenantSlug = params.tenantSlug as string;
  const targetRedirectUrl = `/${tenantSlug}/account/plans`;

  useEffect(() => {
    let cancelled = false;

    abortPlanSwitchAction(tenantSlug)
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          if (res.restored) {
            setState("restored");
            setPlanName(res.planName ?? null);
          } else {
            setState("noop");
          }
        } else {
          setState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push(targetRedirectUrl);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [router, tenantSlug, targetRedirectUrl]);

  const title =
    state === "checking"
      ? "Checking Plan Status"
      : state === "restored"
        ? "Plan Change Cancelled"
        : state === "noop"
          ? "Payment Not Completed"
          : "Something Went Wrong";

  const description =
    state === "checking"
      ? "Making sure your previous plan is safe..."
      : state === "restored"
        ? `Your plan change was cancelled and your previous plan${planName ? ` (${planName})` : ""} has been restored. No charges were made and nothing was cancelled.`
        : state === "noop"
          ? "Your plan change was cancelled or could not be processed. No charges were made and your plan is unchanged."
          : "We couldn't confirm the plan status. Please check your account plans page — your current plan is safe.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="max-w-md w-full text-center shadow-lg border-border">
        <CardHeader className="flex flex-col items-center pb-4">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/50">
            {state === "checking" ? (
              <LoaderCircle className="h-10 w-10 text-red-600 dark:text-red-400 animate-spin" />
            ) : (
              <XCircle className="h-10 w-10 text-red-600 dark:text-red-400" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">{title}</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {description}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Redirecting to your account plan in{" "}
            <span className="font-bold text-foreground">{countdown}</span>{" "}
            seconds...
          </p>
        </CardContent>

        <CardFooter>
          <Button
            onClick={() => router.push(targetRedirectUrl)}
            className="h-9 w-full bg-brand-accent hover:bg-brand-accent/90"
          >
            Go to Account & Plan
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
