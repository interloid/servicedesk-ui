"use client";

import { use, useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BillingDashboardData } from "../services/billing-dashboard.service";
import InvoiceModal from "./invoice-model";
import { UpdatePaymentModal } from "./payment-method";
import { abortPlanSwitchAction } from "../billing-actions";

interface BillingDashboardProps {
  params: Promise<{ tenantSlug: string }>;
  initialData?: BillingDashboardData | null;
  isLoading?: boolean;
}

interface SummaryCardProps {
  label: string;
  value?: ReactNode;
  subtext?: ReactNode;
  isLoading?: boolean;
  action?: ReactNode;
  extra?: ReactNode;
}

function SummaryCard({
  label,
  value,
  subtext,
  isLoading,
  action,
  extra,
}: SummaryCardProps) {
  if (isLoading) {
    return (
      <Card className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-none">
        <div className="space-y-2.5">
          <Skeleton className="h-3 w-20 bg-slate-100" />
          <Skeleton className="h-5 w-32 bg-slate-100" />
          <Skeleton className="h-3 w-24 bg-slate-100" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-none drop-shadow-none flex flex-col justify-between ring-0">
      <CardHeader className="p-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        <CardTitle className="mt-1 text-base font-bold tracking-tight text-slate-900">
          {value}
        </CardTitle>
      </CardHeader>
      {subtext && (
        <CardContent className="p-0 pt-1">
          <p className="text-xs text-slate-500">{subtext}</p>
        </CardContent>
      )}
      {action && <div className="pt-2.5">{action}</div>}
      {extra && <div>{extra}</div>}
    </Card>
  );
}

function StatusBanner({
  data,
  tenantSlug,
}: {
  data: BillingDashboardData;
  tenantSlug: string;
}) {
  const router = useRouter();
  const { billingStatus } = data;

  if (billingStatus === "past_due" || data.isSuspended) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/60 p-5 space-y-4">
        <div className="flex items-start space-x-3">
          <div className="rounded-md bg-red-500 p-1.5 text-white shrink-0 mt-0.5">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-red-950">Payment failed</h3>
            <p className="text-xs text-red-800/90 mt-0.5">
              We couldn&apos;t process your {data.amountDue.next} payment.
              Update your payment method to keep your subscription active.
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-1">
          <Button
            className="bg-teal-800 hover:bg-teal-900 text-white text-xs font-semibold h-9 px-4 rounded-lg shadow-none"
            onClick={() =>
              router.push(`/${tenantSlug}/account/billing/payment`)
            }
          >
            Update payment method
          </Button>
          <Button
            variant="outline"
            className="bg-white text-xs font-semibold h-9 px-4 rounded-lg shadow-none"
          >
            Retry charge
          </Button>
        </div>
      </div>
    );
  }

  if (billingStatus === "cancelled") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="rounded-md bg-amber-500 p-1.5 text-white shrink-0 mt-0.5">
              <Clock className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-amber-950">
                Cancels on {data.renewalDate}
              </h3>
              <p className="text-xs text-amber-800/90 mt-0.5">
                Your subscription will end on {data.renewalDate}. You can
                reactivate or change your plan before then.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/${tenantSlug}/account/plans`)}
            className="shrink-0 text-xs font-semibold bg-white h-9 px-3.5 rounded-lg shadow-none w-full sm:w-auto"
          >
            Reactivate
          </Button>
        </div>
      </div>
    );
  }
}

export default function BillingDashboard({
  params,
  initialData,
  isLoading = false,
}: BillingDashboardProps) {
  const router = useRouter();
  const { tenantSlug } = use(params);
  const [selectedInvoice, setSelectedInvoice] = useState<
    BillingDashboardData["invoices"][number] | null
  >(null);
  const [isUpdatePaymentOpen, setIsUpdatePaymentOpen] = useState(false);
  const [isAborting, startAbort] = useTransition();

  if (isLoading) {
    return (
      <div className="h-full p-4 sm:p-8 font-sans text-slate-900">
        <div className="mx-auto space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <Skeleton className="h-7 w-24 bg-slate-200" />
              <Skeleton className="h-4 w-48 bg-slate-200" />
            </div>
            <Skeleton className="h-9 w-full sm:w-28 rounded-lg bg-slate-200" />
          </div>
          {initialData &&
            (initialData.billingStatus === "past_due" ||
              initialData.billingStatus === "cancelled" ||
              initialData.isSuspended ||
              !!initialData.scheduledChange) && (
              <Skeleton className="h-20 w-full rounded-xl bg-slate-100" />
            )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SummaryCard key={i} label="" isLoading={true} />
            ))}
          </div>
          <Card className="rounded-xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-none ring-0">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
              <div className="w-full min-w-0 space-y-2 sm:w-auto">
                <Skeleton className="h-3 w-28 bg-slate-100" />
                <Skeleton className="h-4 w-40 bg-slate-100" />
              </div>
              <Skeleton className="h-8 w-full sm:w-28 rounded-lg bg-slate-100" />
            </div>
            <div className="pt-4 space-y-2">
              <Skeleton className="h-2 w-full rounded-full bg-slate-100" />
              <Skeleton className="h-3 w-72 max-w-full bg-slate-100" />
            </div>
          </Card>
          <Card className="rounded-xl border border-slate-200/80 bg-white shadow-none ring-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 px-6 pt-4">
              <Skeleton className="h-4 w-28 bg-slate-100" />
            </div>
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-4 px-6 py-3.5"
                >
                  <Skeleton className="h-3 w-24 bg-slate-100" />
                  <Skeleton className="h-3 w-20 bg-slate-100" />
                  <Skeleton className="h-3 w-28 bg-slate-100" />
                  <Skeleton className="h-5 w-16 rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!initialData) {
    return (
      <div className="p-8 text-center text-slate-500 font-sans">
        <p className="text-sm font-semibold">
          We couldn&apos;t load your billing details.
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Billing isn&apos;t set up yet for {tenantSlug}. Try again in a moment,
          or contact support if this keeps happening.
        </p>
      </div>
    );
  }

  const data = initialData;
  const usedSeats = data?.seats?.used ?? 0;
  const totalSeats = data?.seats?.total ?? 0;
  const unusedSeats = data?.seats?.unused ?? 0;
  const seatPercentage = totalSeats > 0 ? (usedSeats / totalSeats) * 100 : 0;
  const pendingUpgrade = data.pendingUpgrade ?? null;

  // The payment source comes straight from what PayPal reported.
  const paymentSourceType = data?.paymentMethod?.sourceType ?? "none";
  const paypalEmail = data?.paymentMethod?.email;
  const paypalPayerName = data?.paymentMethod?.payerName;
  const hasPayPalWallet = paymentSourceType === "paypal";
  const isFreeTier = (data?.plan?.rateValue ?? 0) === 0;

  const scheduledChange = data.scheduledChange;

  const planStatus =
    data.isSuspended || data.billingStatus === "past_due"
      ? { label: "Payment failed", dot: "bg-red-500" }
      : data.billingStatus === "cancelled"
        ? { label: `Ends ${data.renewalDate}`, dot: "bg-amber-500" }
        : data.billingStatus === "trialing"
          ? { label: "Trial", dot: "bg-sky-500" }
          : { label: "Active", dot: "bg-emerald-500" };

  const handleAbort = () => {
    startAbort(async () => {
      const res = await abortPlanSwitchAction(tenantSlug);
      if (!res.success) {
        toast.error(res.error || "Failed to cancel the scheduled change.");
        return;
      }
      toast.success("Plan change cancelled.");
      router.refresh();
    });
  };

  const effectiveDateLabel = scheduledChange
    ? new Date(scheduledChange.effectiveAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  const daysLabel = (d: number) =>
    d <= 0 ? "today" : d === 1 ? "in 1 day" : `in ${d} days`;

  return (
    <div className="h-full font-sans text-slate-900 p-4 sm:p-8 overflow-y-auto">
      <div className="mx-auto space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Billing
            </h1>
            <p className="text-xs font-medium text-slate-500 mt-1">
              {data.accountName}
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full sm:w-fit text-xs font-semibold bg-brand-accent text-primary-foreground hover:bg-brand-accent/80 hover:text-primary-foreground rounded-lg px-4 h-9"
            onClick={() => router.push(`/${tenantSlug}/account/plans`)}
          >
            Change plan
          </Button>
        </div>

        <StatusBanner data={data} tenantSlug={tenantSlug} />

        {scheduledChange && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="rounded-md bg-amber-500 p-1.5 text-white shrink-0 mt-0.5">
                  <CalendarClock className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-amber-950">
                    Your plan will change to {scheduledChange.planName}
                  </h3>
                  <p className="text-xs text-amber-800/90 mt-0.5">
                    On {effectiveDateLabel} (
                    {daysLabel(scheduledChange.daysRemaining)}), your
                    subscription will switch to {scheduledChange.planName} at{" "}
                    {scheduledChange.planRate}. You keep{" "}
                    {data.plan?.name ?? "your current plan"} and all of its
                    features until then.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={isAborting}
                onClick={handleAbort}
                className="shrink-0 text-xs font-semibold bg-white border-amber-300 text-amber-900 hover:bg-amber-100 h-9 px-3.5 rounded-lg shadow-none w-full sm:w-auto"
              >
                {isAborting && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Cancel change
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <SummaryCard
            label="Current plan"
            value={
              <>
                {data.plan?.name ?? "N/A"}
                <span className="text-sm font-medium text-slate-500 ml-2">
                  · {data.plan?.rate ?? ""}
                </span>
              </>
            }
            subtext={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${planStatus.dot}`}
                />
                {planStatus.label}
                <span>·</span>
                <span>Auto-renew is {data.autoRenew ? "on" : "off"}</span>
              </span>
            }
            extra={
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <div className="flex items-center justify-between gap-2">
                  <span>Seat limit</span>
                  <span className="font-semibold text-slate-700">
                    {data.seats?.total ?? 0} seats
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Next payment</span>
                  <span className="font-semibold text-slate-700">
                    {data.amountDue?.next ?? "$0.00"} on {data.renewalDate}
                  </span>
                </div>
              </div>
            }
          />

          <SummaryCard
            label="User seats"
            value={
              <>
                {usedSeats}{" "}
                <span className="text-base font-medium text-slate-500">
                  / {totalSeats} seats used
                </span>
              </>
            }
            subtext={
              <>
                {unusedSeats} seat{unusedSeats === 1 ? "" : "s"} available ·{" "}
                {data.agents?.admins ?? 0} admin
                {data.agents?.admins === 1 ? "" : "s"} ·{" "}
                {data.agents?.regular ?? 0} agent
                {data.agents?.regular === 1 ? "" : "s"}
              </>
            }
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/${tenantSlug}/settings/team`)}
                className="w-full sm:w-auto text-xs font-semibold h-8 px-3.5 rounded-lg shadow-none"
              >
                Manage team
              </Button>
            }
          />

          <SummaryCard
            label="Next payment"
            value={
              pendingUpgrade ? (
                <>
                  ${pendingUpgrade.amountDue.toFixed(2)}
                  <span className="text-sm font-medium text-slate-500 ml-2">
                    one-time upgrade
                  </span>
                </>
              ) : (
                <>
                  {data.amountDue?.next ?? "$0.00"}
                  <span className="text-sm font-medium text-slate-500 ml-2">
                    on {data.renewalDate}
                  </span>
                </>
              )
            }
            subtext={
              pendingUpgrade ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Awaiting payment for your upgrade to {pendingUpgrade.planName}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  {data.autoRenew ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Auto-renew is on
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      Auto-renew is off
                    </>
                  )}
                </span>
              )
            }
            action={
              pendingUpgrade ? (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">
                    Then ${pendingUpgrade.planRate.toFixed(2)}/mo, starting with
                    your next billing cycle.
                  </span>
                  {pendingUpgrade.proratedCredit > 0 && (
                    <span className="text-xs text-emerald-700">
                      Includes ${pendingUpgrade.proratedCredit.toFixed(2)}{" "}
                      credit for the unused time on your{" "}
                      {data.plan?.name ?? "current"} plan.
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">
                    {data.lastPayment ? (
                      <>
                        Last payment: {data.lastPayment.amount} · Paid{" "}
                        {data.lastPayment.date}
                      </>
                    ) : null}
                  </span>
                </div>
              )
            }
          />

          <SummaryCard
            label="Payment method"
            value={
              hasPayPalWallet ? (
                <>
                  PayPal
                  <span className="text-sm font-medium text-slate-500 ml-2">
                    {paypalPayerName ?? "PayPal Wallet"}
                  </span>
                </>
              ) : isFreeTier ? (
                "Free Tier"
              ) : (
                "No payment method on file"
              )
            }
            subtext={
              hasPayPalWallet
                ? (paypalEmail ??
                  (paypalPayerName
                    ? "Billed through this PayPal account"
                    : "Billed through your PayPal account"))
                : isFreeTier
                  ? "No charges for this plan"
                  : "Add a payment method to avoid service interruptions."
            }
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsUpdatePaymentOpen(true)}
                className="text-xs font-semibold h-8 px-3.5 rounded-lg shadow-none"
              >
                {hasPayPalWallet ? "Manage PayPal" : "Change payment method"}
              </Button>
            }
          />
        </div>

        <Card className="rounded-xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-none drop-shadow-none ring-0">
          <CardHeader className="p-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 space-y-0">
            <div className="min-w-0 w-full sm:w-auto">
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                User seat usage
              </span>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-slate-900">
                  {usedSeats} / {totalSeats} seats used
                </span>
                <span className="text-xs text-slate-400 font-normal">
                  {Math.round(seatPercentage)}%
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/${tenantSlug}/settings/team`)}
              className="w-full sm:w-auto justify-center text-xs font-semibold h-8 px-3.5 rounded-lg shadow-none shrink-0"
            >
              Manage team
            </Button>
          </CardHeader>
          <CardContent className="p-0 pt-3 sm:pt-4">
            <Progress
              value={seatPercentage}
              className="h-2 bg-slate-100 [&>div]:bg-teal-700 rounded-full"
            />
            <p className="text-xs text-slate-500 leading-relaxed mt-3">
              {unusedSeats > 0 ? (
                <>
                  {unusedSeats} seat{unusedSeats === 1 ? "" : "s"} available.
                  Each seat is one team member who can sign in.
                </>
              ) : (
                `No seats available — all ${totalSeats} are in use.`
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-xl border border-slate-200/80 bg-white shadow-none overflow-hidden ring-0">
          <CardHeader className="border-b border-slate-100 pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold text-slate-900">
              Billing history
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!data.invoices || data.invoices.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No invoices found for this account.
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <Table className="min-w-150">
                  <TableHeader className="bg-slate-50/50">
                    <TableRow className="border-slate-100">
                      <TableHead className="px-6 py-3 text-[10px] uppercase font-bold text-slate-400 text-left">
                        Invoice
                      </TableHead>
                      <TableHead className="px-6 py-3 text-[10px] uppercase font-bold text-slate-400 text-left">
                        Date
                      </TableHead>
                      <TableHead className="px-6 py-3 text-[10px] uppercase font-bold text-slate-400 text-left">
                        Description
                      </TableHead>
                      <TableHead className="px-6 py-3 text-[10px] uppercase font-bold text-slate-400 text-right">
                        Amount
                      </TableHead>
                      <TableHead className="px-6 py-3 text-[10px] uppercase font-bold text-slate-400 text-center">
                        Status
                      </TableHead>
                      <TableHead className="px-6 py-3 text-[10px] uppercase font-bold text-slate-400 text-right">
                        PDF
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="text-xs">
                    {data.invoices.map((inv) => (
                      <TableRow
                        key={inv.id}
                        className="hover:bg-slate-50/50 border-slate-100"
                      >
                        <TableCell className="px-6 py-3.5 font-semibold text-slate-900 text-left whitespace-nowrap">
                          {inv.id}
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-slate-500 text-left whitespace-nowrap">
                          {inv.date}
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-slate-500 text-left whitespace-nowrap">
                          {inv.description}
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-right font-semibold text-slate-900 whitespace-nowrap">
                          {inv.amount}
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-center whitespace-nowrap">
                          <Badge
                            variant="secondary"
                            className={`inline-flex items-center justify-center font-medium px-2 py-0.5 text-[11px] rounded-full shadow-none ${
                              inv.status === "Paid"
                                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                                : "bg-red-50 text-red-700 hover:bg-red-50"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${
                                inv.status === "Paid"
                                  ? "bg-emerald-600"
                                  : "bg-red-600"
                              }`}
                            />
                            {inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-right font-semibold whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedInvoice(inv)}
                            className="text-teal-800 hover:underline focus:outline-none cursor-pointer"
                          >
                            View PDF
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedInvoice && (
        <InvoiceModal
          isOpen={!!selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          invoice={selectedInvoice}
        />
      )}
      <UpdatePaymentModal
        open={isUpdatePaymentOpen}
        onOpenChange={setIsUpdatePaymentOpen}
        sourceType={paymentSourceType}
        paypalEmail={paypalEmail}
        paypalPayerName={paypalPayerName}
        invoiceId={data.suspensionReason?.invoiceId}
        tenantSlug={tenantSlug}
        onSynced={() => router.refresh()}
      />
    </div>
  );
}
