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
import { BillingDashboardData } from "../services/billing-dashboard.service";
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
        <div className="flex items-center space-x-3 pt-1">
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
            className="bg-white border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold h-9 px-4 rounded-lg shadow-none"
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
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="rounded-md bg-amber-500 p-1.5 text-white shrink-0 mt-0.5">
              <Clock className="h-4 w-4" />
            </div>
            <div>
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
            className="shrink-0 text-xs font-semibold bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50 h-9 px-3.5 rounded-lg shadow-none"
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
      <div className="h-full p-8 font-sans text-slate-900">
        <div className="mx-auto space-y-6">
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <Skeleton className="h-7 w-24 bg-slate-200" />
              <Skeleton className="h-4 w-48 bg-slate-200" />
            </div>
            <Skeleton className="h-9 w-28 rounded-lg bg-slate-200" />
          </div>
          <Skeleton className="h-20 w-full rounded-xl bg-slate-100" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SummaryCard key={i} label="" isLoading={true} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!initialData) {
    return (
      <div className="p-8 text-center text-slate-500 font-sans">
        <p className="text-sm font-semibold">Billing data unavailable.</p>
        <p className="text-xs text-slate-400 mt-1">
          Please make sure billing information is configured for tenant:{" "}
          {tenantSlug}
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
  const isFreeTier = (data?.plan?.rate ?? "") === "$0/mo";

  const scheduledChange = data.scheduledChange;

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
    <div className="h-full font-sans text-slate-900 p-8 overflow-y-auto ">
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
            className="w-fit text-xs font-semibold bg-brand-accent text-primary-foreground hover:bg-brand-accent/80 hover:text-primary-foreground rounded-lg px-4 h-9"
            onClick={() => router.push(`/${tenantSlug}/account/plans`)}
          >
            Change plan
          </Button>
          {!isFreeTier && data.billingStatus !== "cancelled" && (
            <Button
              variant="outline"
              className="w-fit text-xs font-semibold border-red-200 bg-background text-red-600 hover:bg-red-50 hover:text-red-700 rounded-lg px-4 h-9"
              onClick={() =>
                router.push(`/${tenantSlug}/account/billing/cancel`)
              }
            >
              Cancel subscription
            </Button>
          )}
        </div>

        <StatusBanner data={data} tenantSlug={tenantSlug} />

        {scheduledChange && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start space-x-3">
                <div className="rounded-md bg-amber-500 p-1.5 text-white shrink-0 mt-0.5">
                  <CalendarClock className="h-4 w-4" />
                </div>
                <div>
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
                className="shrink-0 text-xs font-semibold bg-white border-amber-300 text-amber-900 hover:bg-amber-100 h-9 px-3.5 rounded-lg shadow-none"
              >
                {isAborting && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Cancel change
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-4">
          <SummaryCard
            label="Current Plan"
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
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Active
                {data.autoRenew ? (
                  <>
                    <span>·</span>
                    <span>Auto-renew ON</span>
                  </>
                ) : (
                  <span className="text-xs text-slate-400">
                    · Auto-renew OFF
                  </span>
                )}
              </span>
            }
            extra={
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <div className="flex items-center justify-between gap-2">
                  <span>User seats</span>
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
                  / {totalSeats} used
                </span>
              </>
            }
            subtext={
              <>
                {data.agents?.admins ?? 0} admin
                {data.agents?.admins === 1 ? "" : "s"} ·{" "}
                {data.agents?.regular ?? 0} agent
                {data.agents?.regular === 1 ? "" : "s"} · {unusedSeats} seat
                {unusedSeats === 1 ? "" : "s"} available
              </>
            }
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/${tenantSlug}/settings/team`)}
                className="text-xs font-semibold text-teal-800 border-slate-200 hover:bg-teal-50 h-8 px-3.5 rounded-lg shadow-none"
              >
                Manage members
              </Button>
            }
          />

          <SummaryCard
            label="Next Payment"
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
                  Upgrade to {pendingUpgrade.planName} awaits payment
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  {data.autoRenew ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Auto-renew is ON
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      Auto-renew is OFF
                    </>
                  )}
                </span>
              )
            }
            action={
              pendingUpgrade ? (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">
                    ${pendingUpgrade.planRate.toFixed(2)}/mo from your next
                    billing cycle after this one-time payment.
                  </span>
                  {pendingUpgrade.proratedCredit > 0 && (
                    <span className="text-xs text-emerald-700">
                      Includes ${pendingUpgrade.proratedCredit.toFixed(2)}{" "}
                      credit from your remaining{" "}
                      {data.plan?.name ?? "current plan"} time.
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-400">
                    Current billing
                  </span>
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
            label="Payment Method"
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
                    ? "Billed through their PayPal account"
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
                className="text-xs font-semibold text-teal-800 border-slate-200 hover:bg-teal-50 h-8 px-3.5 rounded-lg shadow-none"
              >
                {hasPayPalWallet ? "Manage PayPal" : "Change payment method"}
              </Button>
            }
          />
        </div>

        {/* Seat usage */}
        <Card className="rounded-xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-none drop-shadow-none ring-0">
          <CardHeader className="p-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 space-y-0">
            <div className="min-w-0 w-full sm:w-auto">
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                User seat usage
              </span>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-slate-900">
                  {usedSeats} of {totalSeats} User seats used
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
              className="w-full sm:w-auto justify-center text-xs font-semibold text-teal-800 border-slate-200 hover:bg-teal-50 h-8 px-3.5 rounded-lg shadow-none shrink-0"
            >
              Manage seats
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
                  You&apos;re currently using {usedSeats} of {totalSeats} user
                  seats. {unusedSeats} user seat
                  {unusedSeats === 1 ? "" : "s"} available.
                </>
              ) : (
                "All user seats are currently assigned to active team members."
              )}
            </p>
          </CardContent>
        </Card>

        {/* Billing history */}
        <Card className="rounded-xl border border-slate-200/80 bg-white shadow-none overflow-hidden ring-0">
          <CardHeader className="border-b border-slate-100 pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold text-slate-900">
              Billing History
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
                      <TableHead className="px-6 py-3 text-[10px] uppercase font-bold text-slate-400 text-center">
                        User Seats
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
                        <TableCell className="px-6 py-3.5 text-center text-slate-700 whitespace-nowrap">
                          {inv.seats}
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
