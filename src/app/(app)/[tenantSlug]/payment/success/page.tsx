"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { confirmSubscriptionActivationAction } from "@/features/billing/billing-actions";

export default function PaymentSuccessPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(5);
  const [planName, setPlanName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const subscriptionId =
    searchParams.get("subscription_id") || "I-77C50RFRPR2K";
  const tenantSlug = params.tenantSlug as string;
  const targetRedirectUrl = `/${tenantSlug}/account/plans`;

  useEffect(() => {
    let cancelled = false;

    confirmSubscriptionActivationAction(tenantSlug)
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="max-w-md w-full text-center shadow-lg border-border">
        <CardHeader className="flex flex-col items-center pb-4">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/50">
            {checking ? (
              <LoaderCircle className="h-10 w-10 text-emerald-600 animate-spin" />
            ) : (
              <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">
            Payment Successful!
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {checking
              ? "Confirming your subscription..."
              : error
                ? error
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
                {subscriptionId}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">Status</span>
              {error ? (
                <Badge
                  variant="outline"
                  className="bg-amber-50 text-amber-700 border-amber-200"
                >
                  Pending
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
            Go to Account & Plan Immediately
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
