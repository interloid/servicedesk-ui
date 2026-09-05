"use client";

import { use, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
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

interface BillingDashboardProps {
  params: Promise<{ tenantSlug: string }>;
  initialData?: BillingDashboardData | null;
  isLoading?: boolean;
}

interface MetricCardProps {
  label: string;
  value?: ReactNode;
  subtext?: ReactNode;
  isLoading?: boolean;
}

function MetricCard({ label, value, subtext, isLoading }: MetricCardProps) {
  if (isLoading) {
    return (
      <Card className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-none">
        <div className="space-y-3">
          <Skeleton className="h-3 w-20 bg-slate-100" />
          <Skeleton className="h-6 w-32 bg-slate-100" />
          <Skeleton className="h-3 w-24 bg-slate-100" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border bg-white p-3.5 shadow-none drop-shadow-none transition-all hover:border-slate-300 ring-0">
      <CardHeader className="p-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        <CardTitle className="text-lg font-bold tracking-tight text-slate-900">
          {value}
        </CardTitle>
      </CardHeader>
      {subtext && (
        <CardContent className="p-0 pt-1">
          <p className="text-xs text-slate-500">{subtext}</p>
        </CardContent>
      )}
    </Card>
  );
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

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <MetricCard key={i} label="" isLoading={true} />
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

  const monthlyRate = parseFloat(
    (data?.amountDue?.total ?? "").replace(/[^0-9.]/g, ""),
  );
  const perSeatRate =
    totalSeats > 0 && Number.isFinite(monthlyRate) && monthlyRate > 0
      ? monthlyRate / totalSeats
      : null;
  const monthlySavings =
    perSeatRate !== null && unusedSeats > 0 ? unusedSeats * perSeatRate : null;

  const paymentType = data?.paymentMethod?.type;
  const cardLast4 = data?.paymentMethod?.last4;
  const cardExpiry = data?.paymentMethod?.expiry;
  const hasCardDetails = Boolean(
    paymentType && cardLast4 && cardLast4.trim() !== "" && cardLast4 !== "N/A",
  );

  // Wallet-funded PayPal subscriptions have no card on file, only the payer's
  // PayPal account. The funding instrument behind it is private to PayPal.
  const paypalEmail = data?.paymentMethod?.email;
  const hasPayPalWallet = Boolean(!hasCardDetails && paypalEmail);

  const suspensionReason = data?.suspensionReason;
  const attemptedCard = suspensionReason?.card;
  const failingInvoice = suspensionReason?.invoiceId;
  const failingAmount = suspensionReason?.amount;

  let suspensionMessage: string;
  if (attemptedCard && failingInvoice && failingAmount) {
    suspensionMessage = `We tried ${attemptedCard} three times for invoice ${failingInvoice} (${failingAmount}) and it was declined.`;
  } else if (failingInvoice && failingAmount) {
    suspensionMessage = `We tried three charges for invoice ${failingInvoice} (${failingAmount}) and they were declined.`;
  } else if (attemptedCard) {
    suspensionMessage = `We tried ${attemptedCard} three times and it was declined.`;
  } else {
    suspensionMessage = "Your last three payment attempts were declined.";
  }
  suspensionMessage +=
    " Agents can read tickets but can't reply until payment clears.";

  const metrics = [
    {
      label: "Current Plan",
      value: data.plan?.name ?? "N/A",
      subtext: data.plan?.rate,
    },
    {
      label: "Current Agents",
      value: (
        <>
          {data.agents?.active ?? 0}{" "}
          <span className="text-lg font-bold tracking-tight text-slate-900">
            active
          </span>
        </>
      ),
      subtext: `${data.agents?.admins ?? 0} admins · ${data.agents?.regular ?? 0} agents`,
    },
    {
      label: "Seats",
      value: (
        <>
          {usedSeats}{" "}
          <span className="text-lg font-bold tracking-tight text-slate-900">
            of {totalSeats}
          </span>
        </>
      ),
      subtext: `${data.seats?.unused ?? 0} unused`,
    },
    {
      label: "Next Renewal",
      value: data.renewalDate,
      subtext: "Auto-renews",
    },
    {
      label: "Amount Due",
      value: data.amountDue?.total ?? "$0.00",
      subtext: `Includes ${data.amountDue?.unusedSeats ?? 0} unused seats`,
    },
  ];

  return (
    <div className="h-full font-sans text-slate-900 p-8 overflow-y-auto ">
      <div className="mx-auto space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Billing
            </h1>
            <p className="text-xs font-medium text-slate-500 mt-1">
              {data.accountName} · {data.accountId}
            </p>
          </div>
          <Button
            variant="outline"
            className="w-fit text-xs font-semibold bg-brand-accent text-primary-foreground rounded-lg px-4 h-9"
            onClick={() => router.push(`/${tenantSlug}/account/plans`)}
          >
            Change plan
          </Button>
        </div>

        {data.isSuspended && (
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-5 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="rounded-md bg-red-500 p-1.5 text-white shrink-0 mt-0.5">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-red-950">
                  Your workspace is suspended
                </h3>
                <p className="text-xs text-red-800/90 mt-0.5">
                  {suspensionMessage}
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
              <button
                type="button"
                className="text-xs font-semibold text-teal-800 hover:underline px-2"
              >
                Contact billing support
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {metrics.map((metric, idx) => (
            <MetricCard
              key={idx}
              label={metric.label}
              value={metric.value}
              subtext={metric.subtext}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
          <Card className="md:col-span-7 rounded-xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-none drop-shadow-none flex flex-col justify-between ring-0">
            <CardHeader className="p-0 space-y-2">
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Seat Usage
              </span>
              <div className="flex justify-between items-baseline pt-1">
                <span className="text-sm font-semibold text-slate-900">
                  {usedSeats} agents active
                </span>
                <span className="text-xs text-slate-400 font-normal">
                  of{" "}
                  <strong className="text-slate-900 font-semibold">
                    {totalSeats}
                  </strong>{" "}
                  purchased
                </span>
              </div>
              <Progress
                value={seatPercentage}
                className="h-2 mt-2 bg-slate-100 [&>div]:bg-teal-700 rounded-full"
              />
            </CardHeader>
            <CardContent className="p-0 pt-3 sm:pt-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                {unusedSeats > 0 ? (
                  <>
                    You&apos;re paying for {unusedSeats}{" "}
                    {unusedSeats === 1 ? "seat" : "seats"} nobody is using.
                    {monthlySavings !== null
                      ? ` Drop to ${usedSeats} seats and save $${monthlySavings.toFixed(2)} a month.`
                      : ` Drop to ${usedSeats} seats to lower your monthly bill.`}
                  </>
                ) : (
                  "All seats are currently assigned to active team members."
                )}
              </p>
            </CardContent>
          </Card>

          <Card className="md:col-span-5 rounded-xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-none drop-shadow-none flex flex-col justify-between ring-0">
            <CardHeader className="p-0 space-y-3">
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Payment Method
              </span>
              <div className="flex items-center space-x-3 pt-1">
                {hasCardDetails ? (
                  <>
                    <Badge
                      variant="secondary"
                      className="bg-brand-accent text-primary-foreground font-bold px-2 py-1.5 rounded-md text-[10px] tracking-wider"
                    >
                      {(paymentType ?? "").toUpperCase()}
                    </Badge>
                    <div>
                      <p className="text-sm font-bold text-slate-900 leading-none">
                        {paymentType} ···· {cardLast4}
                      </p>
                      {cardExpiry && cardExpiry !== "N/A" && (
                        <p className="text-xs text-slate-400 mt-1">
                          Expires {cardExpiry}
                        </p>
                      )}
                    </div>
                  </>
                ) : hasPayPalWallet ? (
                  <>
                    <Badge
                      variant="secondary"
                      className="bg-brand-accent text-primary-foreground font-bold px-2 py-1.5 rounded-md text-[10px] tracking-wider"
                    >
                      PAYPAL
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 leading-none truncate">
                        {paypalEmail}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Billed through your PayPal account
                      </p>
                    </div>
                  </>
                ) : (
                  <div>
                    <p className="text-sm font-bold text-slate-900 leading-none">
                      No payment method on file
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Add a card to avoid service interruptions.
                    </p>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsUpdatePaymentOpen(true)}
                className="text-xs font-semibold bg-brand-accent text-primary-foreground h-9 px-3.5 rounded-lg shadow-none"
              >
                Update card
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-xl border border-slate-200/80 bg-white shadow-none overflow-hidden ring-0">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-sm font-bold text-slate-900">
              Invoices
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
                      <TableHead className="px-6 py-3 text-[10px] uppercase font-bold text-slate-400 text-center">
                        Agents
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
                          INV-{inv.id}
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-slate-500 text-left whitespace-nowrap">
                          {inv.date}
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-center text-slate-700 whitespace-nowrap">
                          {inv.agents}
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
                            PDF
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
        currentCardLast4={hasCardDetails ? cardLast4 : undefined}
        invoiceId={data.suspensionReason?.invoiceId}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
