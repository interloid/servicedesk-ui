"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { XCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/shared/page-loader";
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

function PaymentCancelContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(5);
  const [state, setState] = useState<CancelState>("checking");
  const [planName, setPlanName] = useState<string | null>(null);
  const abortedRef = useRef(false);
  const tenantSlug = params.tenantSlug as string;
  const targetRedirectUrl = `/${tenantSlug}/account/plans`;
  // What PayPal appends to the cancel URL: the order id as `token` for an
  // upgrade payment, `ba_token` (and sometimes `subscription_id`) for an
  // agreement approval. Only the checkout these identify is dropped -- a
  // stale tab or bookmark must never undo a scheduled cancellation.
  const token = searchParams.get("token");
  const baToken = searchParams.get("ba_token");
  const paypalSubscriptionId = searchParams.get("subscription_id");

  useEffect(() => {
    if (abortedRef.current) return;
    abortedRef.current = true;

    abortPlanSwitchAction(tenantSlug, {
      checkoutOnly: true,
      token,
      baToken,
      paypalSubscriptionId,
    })
      .then((res) => {
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
        setState("error");
      });
  }, [tenantSlug, token, baToken, paypalSubscriptionId]);

  // One timeout per tick, so the redirect is a side effect of render and not
  // of a state updater, and leaving the page (the button) stops the timer.
  useEffect(() => {
    if (countdown <= 0) {
      router.push(targetRedirectUrl);
      return;
    }

    const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);

    return () => clearTimeout(timer);
  }, [countdown, router, targetRedirectUrl]);

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
          : "We couldn't confirm the plan status. Please check your account plans page - your current plan is safe.";

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
            className="h-10 w-full bg-brand-accent hover:bg-brand-accent/90"
          >
            Go to Account & Plan
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function PaymentCancelPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <PaymentCancelContent />
    </Suspense>
  );
}
