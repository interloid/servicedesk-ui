"use client";

import { Suspense, useEffect, useState } from "react";
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
import { confirmSubscriptionActivationAction } from "@/features/billing/billing-actions";

function PaymentSuccessContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(5);
  const [planName, setPlanName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscriptionId = searchParams.get("subscription_id");
  const missingSubscriptionId = !subscriptionId;
  // Nothing to check without an id, so start settled rather than flipping the
  // flag inside the effect.
  const [checking, setChecking] = useState(Boolean(subscriptionId));
  const tenantSlug = params.tenantSlug as string;
  const targetRedirectUrl = `/${tenantSlug}/account/plans`;

  useEffect(() => {
    let cancelled = false;

    if (missingSubscriptionId) return;

    confirmSubscriptionActivationAction(tenantSlug, subscriptionId)
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setPlanName(res.planName ?? "your new plan");
        } else {
          setError(res.error ?? "Could not verify your subscription.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not verify your subscription.");
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenantSlug, missingSubscriptionId, subscriptionId]);

  // The countdown starts only once the check has settled. Running both at the
  // same time redirected slow checks away before the result was ever shown.
  useEffect(() => {
    if (checking) return;

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

    return () => clearInterval(timer);
  }, [checking, router, targetRedirectUrl]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="max-w-md w-full text-center shadow-lg border-border">
        <CardHeader className="flex flex-col items-center pb-4">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/50">
            {checking && !missingSubscriptionId ? (
              <LoaderCircle className="h-10 w-10 text-emerald-600 animate-spin" />
            ) : (
              <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">
            {checking && !missingSubscriptionId
              ? "Checking Subscription"
              : error || missingSubscriptionId
                ? "Payment Not Confirmed"
                : "Payment Successful!"}
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {checking && !missingSubscriptionId
              ? "Confirming your subscription with PayPal..."
              : error
                ? error
                : missingSubscriptionId
                  ? "We couldn't verify your subscription. Your plan was not changed. Please try again from your account plans page."
                  : `Your subscription is now active on ${planName}.`}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/50 p-4 text-left space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">
                Subscription ID
              </span>
              <span className="font-mono font-semibold text-foreground">
                {subscriptionId ?? "—"}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">Status</span>
              {error || missingSubscriptionId ? (
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
                  Active
                </Badge>
              )}
            </div>
          </div>

          {!checking && (
            <p className="text-xs text-muted-foreground">
              Redirecting to your account plan in{" "}
              <span className="font-bold text-foreground">{countdown}</span>{" "}
              seconds...
            </p>
          )}
        </CardContent>

        <CardFooter>
          <Button
            onClick={() => router.push(targetRedirectUrl)}
            className="h-9 w-full bg-brand-accent hover:bg-brand-accent/90"
          >
            Go to Account & Plan Immediately
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// useSearchParams() renders everything up to the nearest Suspense boundary on the
// client. Without this wrapper that was the whole page, so the user saw a blank
// screen on return from PayPal until the bundle loaded.
export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <PaymentSuccessContent />
    </Suspense>
  );
}
