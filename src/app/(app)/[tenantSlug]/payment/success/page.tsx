"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { CheckCircle2, LoaderCircle } from "lucide-react";
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

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function PaymentSuccessContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(5);
  const [paypalCountdown, setPaypalCountdown] = useState(10);
  const [planName, setPlanName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscriptionId = searchParams.get("subscription_id");
  const token = searchParams.get("token");
  const paymentId = subscriptionId ?? token;
  const missingPaymentId = !paymentId;
  const [checking, setChecking] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);
  const [approval, setApproval] = useState<{
    url: string;
    planName: string;
    nextBilling: number;
  } | null>(null);
  const confirmedRef = useRef(false);
  const tenantSlug = params.tenantSlug as string;
  const targetRedirectUrl = `/${tenantSlug}/account/plans`;

  useEffect(() => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;

    // One-time upgrade payments arrive as PayPal order ids (token); recurring
    // ones as subscription ids. When the id is missing (PayPal sometimes lands
    // here without a token), the activation action resolves the tenant's
    // pending switch itself.
    const isOrderLike =
      paymentId !== null && paymentId.length > 0 && !paymentId.startsWith("I-");

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

        if (isOrderLike && "approvalUrl" in res && res.approvalUrl) {
          setAuthorizing(true);
          setApproval({
            url: res.approvalUrl,
            planName: res.planName ?? "your new plan",
            nextBilling: Number(res.nextBilling ?? 0),
          });
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
  }, [tenantSlug, missingPaymentId, paymentId]);

  useEffect(() => {
    if (checking || !authorizing || !approval) return;

    if (paypalCountdown <= 0) {
      window.location.assign(approval.url);
      return;
    }

    const timer = setTimeout(
      () => setPaypalCountdown((prev) => prev - 1),
      1000,
    );

    return () => clearTimeout(timer);
  }, [checking, authorizing, approval, paypalCountdown]);

  useEffect(() => {
    if (checking || authorizing) return;

    if (countdown <= 0) {
      router.push(targetRedirectUrl);
      return;
    }

    const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);

    return () => clearTimeout(timer);
  }, [checking, authorizing, countdown, router, targetRedirectUrl]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="max-w-md w-full text-center shadow-lg border-border">
        <CardHeader className="flex flex-col items-center pb-4">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/50">
            {checking || authorizing ? (
              <LoaderCircle className="h-10 w-10 text-emerald-600 animate-spin" />
            ) : (
              <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">
            {authorizing
              ? "Almost Done"
              : checking
                ? "Checking Payment"
                : error
                  ? "Payment Not Confirmed"
                  : missingPaymentId && !planName
                    ? "Payment Not Confirmed"
                    : "Payment Successful!"}
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {authorizing && approval
              ? `Your one-time payment is received. Your recurring ${approval.planName} subscription is ready — ${formatMoney(approval.nextBilling)}/month from your next cycle, nothing charged today. Complete one final step with PayPal.`
              : checking
                ? "Confirming with PayPal..."
                : error
                  ? error
                  : missingPaymentId && !planName
                    ? "We couldn't verify a pending payment or subscription on this device. Check your account page to see if your plan was already activated."
                    : `Your plan is now active on ${planName}.`}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/50 p-4 text-left space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">
                {authorizing
                  ? "Recurring (starting next month)"
                  : "Subscription ID"}
              </span>
              <span className="font-mono font-semibold text-foreground">
                {authorizing && approval
                  ? `${formatMoney(approval.nextBilling)}/month`
                  : paymentId
                    ? paymentId
                    : "—"}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">Status</span>
              {error || (missingPaymentId && !planName) ? (
                <Badge
                  variant="outline"
                  className="bg-amber-50 text-amber-700 border-amber-200"
                >
                  Unverified
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-700 border-emerald-200"
                >
                  {authorizing ? "Awaiting authorization" : "Active"}
                </Badge>
              )}
            </div>
          </div>

          {!checking && authorizing && paypalCountdown > 0 && (
            <p className="text-xs text-muted-foreground">
              Redirecting to PayPal in{" "}
              <span className="font-bold text-foreground">
                {paypalCountdown}
              </span>{" "}
              seconds...
            </p>
          )}

          {!checking && !authorizing && (
            <p className="text-xs text-muted-foreground">
              Redirecting to your account plan in{" "}
              <span className="font-bold text-foreground">{countdown}</span>{" "}
              seconds...
            </p>
          )}
        </CardContent>

        <CardFooter>
          <Button
            onClick={() =>
              authorizing && approval
                ? window.location.assign(approval.url)
                : router.push(targetRedirectUrl)
            }
            className="h-9 w-full bg-brand-accent hover:bg-brand-accent/90"
          >
            {authorizing
              ? `Continue to PayPal to confirm (${paypalCountdown}s)`
              : "Go to Account & Plan Immediately"}
          </Button>
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
