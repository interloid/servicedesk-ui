"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageLoader } from "@/components/shared/page-loader";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  confirmOrderPaymentAction,
  confirmSubscriptionActivationAction,
} from "@/features/billing/billing-actions";

function PaymentSuccessContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(5);
  const [planName, setPlanName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A confirmed downgrade: PayPal now bills the cheaper plan from the next
  // cycle, but nothing was charged today and the plan does not move yet.
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  // An upgrade whose difference is paid but whose NEW MONTHLY RATE PayPal
  // still needs the buyer to confirm. Holding the url here (instead of
  // redirecting from inside the confirm callback) keeps the hand-off visible:
  // the buyer reads what is about to happen before they are sent to PayPal.
  const [rateApprovalUrl, setRateApprovalUrl] = useState<string | null>(null);
  const subscriptionId = searchParams.get("subscription_id");
  const token = searchParams.get("token");
  const paymentId = subscriptionId ?? token;
  const missingPaymentId = !paymentId;
  // One-time upgrade payments arrive as PayPal order ids (token); recurring
  // ones as subscription ids, which PayPal prefixes with "I-".
  const isOrderLike =
    paymentId !== null && paymentId.length > 0 && !paymentId.startsWith("I-");
  const [checking, setChecking] = useState(true);
  const confirmedRef = useRef(false);
  const tenantSlug = params.tenantSlug as string;
  const targetRedirectUrl = `/${tenantSlug}/account/billing`;
  // Two ways to end up unverified, one meaning for the reader: the
  // confirmation failed, or PayPal returned the buyer with no id to confirm.
  const unverified = Boolean(error) || (missingPaymentId && !planName);
  const needsRateApproval = rateApprovalUrl !== null;
  const isSuccess = !checking && !unverified && !needsRateApproval;
  const isScheduled = scheduledFor !== null;

  const effectiveDate =
    scheduledFor && !Number.isNaN(new Date(scheduledFor).getTime())
      ? new Date(scheduledFor).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  useEffect(() => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;

    // When the id is missing (PayPal sometimes lands here without a token),
    // the activation action resolves the tenant's open checkout itself.
    const confirm = isOrderLike
      ? confirmOrderPaymentAction
      : confirmSubscriptionActivationAction;

    confirm(tenantSlug, paymentId ?? "")
      .then((res) => {
        if (!res.success) {
          if (missingPaymentId) return;
          setError(res.error ?? "Could not verify your payment.");
          return;
        }

        if ("scheduled" in res && res.scheduled) {
          setScheduledFor(res.effectiveAt ?? "");
        }

        // The difference is paid, but PayPal will not raise a recurring rate
        // on the merchant's word alone: a price increase always comes back
        // with an approve link, and the plan stays on the OLD rate until the
        // buyer confirms it. Sending them there is what finishes the upgrade
        // -- skipping it leaves a captured payment on an unchanged plan.
        if ("approvalUrl" in res && res.approvalUrl) {
          setPlanName(res.planName ?? "your new plan");
          setRateApprovalUrl(res.approvalUrl);
          return;
        }

        setPlanName(res.planName ?? "your new plan");
      })
      .catch(() => {
        if (!missingPaymentId) setError("Could not verify your payment.");
      })
      .finally(() => {
        setChecking(false);
      });
  }, [tenantSlug, missingPaymentId, paymentId, isOrderLike]);

  // The confirmation is not optional and is not deferred: the difference has
  // been charged, and until PayPal has the buyer's approval the agreement
  // keeps billing the OLD rate. So the hand-off happens on its own, straight
  // after the capture, rather than waiting behind a button the buyer can walk
  // past. The short pause is only so they can read why they are moving.
  useEffect(() => {
    if (!rateApprovalUrl) return;

    const handOff = setTimeout(() => {
      window.location.assign(rateApprovalUrl);
    }, 2500);

    return () => clearTimeout(handOff);
  }, [rateApprovalUrl]);

  useEffect(() => {
    if (checking || rateApprovalUrl) return;

    if (countdown <= 0) {
      router.push(targetRedirectUrl);
      return;
    }

    const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);

    return () => clearTimeout(timer);
  }, [checking, countdown, rateApprovalUrl, router, targetRedirectUrl]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="max-w-md w-full text-center shadow-lg border-border">
        <CardHeader className="flex flex-col items-center pb-4">
          <div
            className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full ${
              needsRateApproval
                ? "bg-amber-100 dark:bg-amber-950/50"
                : "bg-emerald-100 dark:bg-emerald-950/50"
            }`}
          >
            {checking ? (
              <LoaderCircle className="h-10 w-10 text-emerald-600 animate-spin" />
            ) : needsRateApproval ? (
              <ShieldCheck className="h-10 w-10 text-amber-600 dark:text-amber-400" />
            ) : (
              <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">
            {checking
              ? "Checking Payment"
              : unverified
                ? "Payment Not Confirmed"
                : needsRateApproval
                  ? "Confirming Your New Rate"
                  : isScheduled
                    ? "Plan Change Confirmed"
                    : "Payment Successful!"}
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {checking
              ? "Confirming with PayPal..."
              : (error ??
                (unverified
                  ? "We couldn't verify a pending payment or subscription on this device. Check your account page to see if your plan was already activated."
                  : needsRateApproval
                    ? `Your payment went through. We're taking you to PayPal now to confirm the new monthly rate for ${
                        planName ?? "your new plan"
                      } - this is the last step, and you won't be charged again today.`
                    : isScheduled
                      ? `Your switch to ${planName} is confirmed, and nothing was charged today. You keep your current plan${
                          effectiveDate ? ` until ${effectiveDate}` : ""
                        }.`
                      : "Thank you for your payment! You can manage your subscription and billing information in your account settings."))}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/50 p-4 text-left space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">
                Subscription ID
              </span>
              <span className="font-mono font-semibold text-foreground">
                {paymentId ? paymentId : "-"}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">Status</span>
              {unverified ? (
                <Badge
                  variant="outline"
                  className="bg-amber-50 text-amber-700 border-amber-200"
                >
                  Unverified
                </Badge>
              ) : needsRateApproval ? (
                <Badge
                  variant="outline"
                  className="bg-amber-50 text-amber-700 border-amber-200"
                >
                  Awaiting confirmation
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-700 border-emerald-200"
                >
                  {isScheduled ? "Scheduled" : "Active"}
                </Badge>
              )}
            </div>
          </div>

          {!checking && !needsRateApproval && (
            <p className="text-xs text-muted-foreground">
              Redirecting to your billing page in{" "}
              <span className="font-bold text-foreground">{countdown}</span>{" "}
              seconds...
            </p>
          )}
        </CardContent>

        <CardFooter className="flex-col gap-2">
          {needsRateApproval ? (
            /* One way on. The button is here for anyone whose redirect is
               blocked, not as an alternative to it. */
            <Button
              onClick={() => window.location.assign(rateApprovalUrl)}
              className="h-10 w-full bg-brand-accent hover:bg-brand-accent/90"
            >
              Continue to PayPal
            </Button>
          ) : (
            <Button
              onClick={() => router.push(targetRedirectUrl)}
              disabled={checking || isSuccess}
              className="h-10 w-full bg-brand-accent hover:bg-brand-accent/90 disabled:cursor-not-allowed"
            >
              {checking
                ? "Checking payment…"
                : isSuccess
                  ? "Redirecting automatically…"
                  : "Go to Account & Billing Immediately"}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <PaymentSuccessContent />
    </Suspense>
  );
}
