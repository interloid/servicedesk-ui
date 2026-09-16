"use client";

import { use, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Crown,
  ExternalLink,
  Eye,
  FileText,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import { MdCurrencyExchange } from "react-icons/md";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { BillingDashboardData } from "../services/billing-dashboard.service";
import InvoiceModal from "./invoice-model";
import { UpdatePaymentModal } from "./payment-method";
import { ModalNotice } from "./modal-notice";
import { UndoScheduledChangeButton } from "./undo-scheduled-change-button";
import {
  DashboardCard,
  DetailRow,
  IconTile,
  LoadingState,
  NoticeBanner,
  PayPalMark,
  StatusPill,
  StatusText,
} from "./reuse";

export const MODAL_BUTTON =
  "h-10 w-full gap-2 rounded-lg px-5 text-sm font-semibold shadow-none duration-200 ease-out motion-safe:active:scale-[0.98] sm:w-auto";

/** The affirmative action in a dialog footer. */
export const MODAL_BUTTON_PRIMARY =
  "bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent/90";
type Invoice = BillingDashboardData["invoices"][number];
type PillTone = "emerald" | "sky" | "amber" | "red" | "slate";

// Billing history pages through invoices newest first, one page at a time.
const INVOICES_PER_PAGE = 5;

// Micro-interactions: every button gives a small press response, and its icon
// leans the way the action takes you. All motion sits behind `motion-safe`, so
// it disappears for anyone who asked their OS to reduce motion.
const BUTTON_MICRO = "duration-200 ease-out motion-safe:active:scale-[0.98]";
const MICRO_ICON = "transition-transform duration-200 ease-out";
const ICON_NUDGE_RIGHT = `${MICRO_ICON} motion-safe:group-hover/button:translate-x-0.5`;
const ICON_NUDGE_LEFT = `${MICRO_ICON} motion-safe:group-hover/button:-translate-x-0.5`;
const ICON_POP = `${MICRO_ICON} motion-safe:group-hover/button:scale-110`;

const PRIMARY_BUTTON = `h-10 gap-2 rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-accent-foreground shadow-none hover:bg-brand-accent/90 ${BUTTON_MICRO}`;
const OUTLINE_BUTTON = `h-10 gap-2 rounded-lg border-slate-200 px-4 text-sm font-medium ${BUTTON_MICRO}`;
const SECONDARY_BUTTON = `h-10 gap-2 rounded-lg px-4 text-sm font-semibold ${BUTTON_MICRO}`;
const PAGINATION_BUTTON = `size-10 shrink-0 rounded-lg border-slate-200 p-0 sm:size-9 ${BUTTON_MICRO}`;

/**
 * Page buttons for the billing history: first and last always, the current page
 * with one neighbour either side, and an ellipsis standing in for each gap. The
 * control keeps the same width whether there are three pages or three hundred.
 */
function pageWindow(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const wanted = [1, total, current, current - 1, current + 1];
  const pages = [...new Set(wanted)]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);

  const out: Array<number | "gap"> = [];

  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) out.push("gap");
    out.push(page);
  });

  return out;
}

interface BillingDashboardProps {
  params: Promise<{ tenantSlug: string }>;
  initialData?: BillingDashboardData | null;
  isLoading?: boolean;
}

// Invoice numbers are sequential per tenant ("INV-002"), so within one day the
// higher number is the newer invoice.
function newestFirst(invoices: Invoice[]): Invoice[] {
  const sequence = (id: string) => Number(id.replace(/\D/g, "")) || 0;

  return [...invoices].sort((a, b) => {
    const byDate = new Date(b.date).getTime() - new Date(a.date).getTime();
    return byDate !== 0 ? byDate : sequence(b.id) - sequence(a.id);
  });
}

export default function BillingDashboard({
  params,
  initialData,
  isLoading = false,
}: BillingDashboardProps) {
  const router = useRouter();
  const { tenantSlug } = use(params);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isUpdatePaymentOpen, setIsUpdatePaymentOpen] = useState(false);
  const [isPlanDetailsOpen, setIsPlanDetailsOpen] = useState(false);
  const [invoicePage, setInvoicePage] = useState(1);
  const [dismissedBanners, setDismissedBanners] = useState<string[]>([]);

  const dismissBanner = (id: string) =>
    setDismissedBanners((current) =>
      current.includes(id) ? current : [...current, id],
    );

  if (isLoading) {
    return (
      <LoadingState
        showBanner={
          !!initialData &&
          (initialData.billingStatus === "past_due" ||
            initialData.billingStatus === "cancelled" ||
            !!initialData.isSuspended ||
            !!initialData.scheduledChange)
        }
      />
    );
  }

  if (!initialData) {
    return (
      <div className="p-8 text-center font-sans text-slate-500">
        <p className="text-sm font-semibold">
          We couldn&apos;t load your billing details.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Billing isn&apos;t set up yet for {tenantSlug}. Try again in a moment,
          or contact support if this keeps happening.
        </p>
      </div>
    );
  }

  const data = initialData;
  const plansHref = `/${tenantSlug}/account/plans`;

  const usedSeats = data.seats?.used ?? 0;
  const totalSeats = data.seats?.total ?? 0;
  const unusedSeats = data.seats?.unused ?? 0;
  const seatPercentage = totalSeats > 0 ? (usedSeats / totalSeats) * 100 : 0;
  const seatPercentageLabel =
    seatPercentage > 0 && seatPercentage < 1
      ? "<1%"
      : `${Math.round(seatPercentage)}%`;

  const pendingUpgrade = data.pendingUpgrade ?? null;
  const scheduledChange = data.scheduledChange;
  const hasRenewalDate = data.renewalDate !== "N/A";

  // The payment source comes straight from what PayPal reported.
  const paymentSourceType = data.paymentMethod?.sourceType ?? "none";
  const paypalEmail = data.paymentMethod?.email;
  const paypalPayerName = data.paymentMethod?.payerName;
  const hasPayPalWallet = paymentSourceType === "paypal";
  const isFreeTier = (data.plan?.rateValue ?? 0) === 0;

  const invoices = newestFirst(data.invoices ?? []);
  const pageCount = Math.max(1, Math.ceil(invoices.length / INVOICES_PER_PAGE));
  // A refresh can drop invoices out from under the page we're on, so clamp
  // while rendering rather than letting the table come up empty.
  const currentPage = Math.min(invoicePage, pageCount);
  const pageStart = (currentPage - 1) * INVOICES_PER_PAGE;
  const visibleInvoices = invoices.slice(
    pageStart,
    pageStart + INVOICES_PER_PAGE,
  );

  // The invoice behind "Last payment": the newest paid invoice for that amount.
  const lastPaymentInvoice = data.lastPayment
    ? (invoices.find(
        (inv) =>
          inv.status === "Paid" && inv.amount === data.lastPayment?.amount,
      ) ?? invoices.find((inv) => inv.status === "Paid"))
    : undefined;

  const isPaymentFailed = data.isSuspended || data.billingStatus === "past_due";

  const planStatus: { label: string; tone: PillTone } = isPaymentFailed
    ? { label: "Payment failed", tone: "red" }
    : data.billingStatus === "cancelled"
      ? { label: `Ends ${data.renewalDate}`, tone: "amber" }
      : data.billingStatus === "trialing"
        ? { label: "Trial", tone: "sky" }
        : { label: "Active", tone: "emerald" };

  const effectiveDateLabel = scheduledChange
    ? new Date(scheduledChange.effectiveAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

  // Cancelling books a downgrade to Free at period end, so the subscription is
  // both "cancelled" and carrying a scheduled change. That is one event, not
  // two: the cancellation notice owns it, and the downgrade detail rides along
  // in its hover hint instead of claiming a banner of its own.
  const isPendingCancellation = data.billingStatus === "cancelled";
  const currentPlanName = data.plan?.name ?? "your plan";
  const showScheduledChangeBanner =
    Boolean(scheduledChange) && !isPendingCancellation;

  const planDetails: Array<{ label: string; value: ReactNode }> = [
    {
      label: "Price",
      value: `$${(data.plan?.rateValue ?? 0).toFixed(2)} / month`,
    },
    { label: "Seat limit", value: `${totalSeats} seats` },
    { label: "Seats in use", value: `${usedSeats} of ${totalSeats}` },
    {
      label: "Next billing date",
      value: hasRenewalDate ? data.renewalDate : "—",
    },
    {
      label: "Next payment",
      value: data.amountDue?.next ?? "$0.00",
    },
    {
      label: "Auto-renew",
      value: (
        <StatusText tone={data.autoRenew ? "emerald" : "slate"}>
          {data.autoRenew ? "On" : "Off"}
        </StatusText>
      ),
    },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 font-sans text-slate-900 sm:p-8">
      <div className="mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Billing
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage your subscription, seats and payment details.
            </p>
          </div>
          <Button
            className={cn(PRIMARY_BUTTON, "w-full sm:w-fit")}
            onClick={() => router.push(plansHref)}
          >
            <MdCurrencyExchange />
            Change plan
          </Button>
        </div>

        {isPaymentFailed && !dismissedBanners.includes("payment-failed") ? (
          <NoticeBanner
            tone="red"
            icon={AlertTriangle}
            title="Payment failed"
            description={
              <>
                We couldn&apos;t process your {data.amountDue.next} payment.
                Update your payment method to keep your subscription active.
              </>
            }
            action={
              <Button
                className={cn(PRIMARY_BUTTON, "h-9 w-full text-xs sm:w-auto")}
                onClick={() => setIsUpdatePaymentOpen(true)}
              >
                Update payment method
              </Button>
            }
            onDismiss={() => dismissBanner("payment-failed")}
          />
        ) : isPendingCancellation &&
          !dismissedBanners.includes("pending-cancellation") ? (
          <NoticeBanner
            tone="amber"
            icon={Clock}
            title={
              <span className="inline-flex flex-wrap items-center gap-1.5">
                Your {currentPlanName} plan ends on {data.renewalDate}
              </span>
            }
            description={`You'll keep ${currentPlanName} and all its features until then.`}
            action={
              <UndoScheduledChangeButton
                tenantSlug={tenantSlug}
                label="Reactivate"
                className={cn(
                  OUTLINE_BUTTON,
                  "h-9 w-full border-amber-300 text-xs text-amber-900 hover:bg-amber-100 sm:w-auto",
                )}
              />
            }
            onDismiss={() => dismissBanner("pending-cancellation")}
          />
        ) : null}

        {showScheduledChangeBanner &&
          scheduledChange &&
          !dismissedBanners.includes("scheduled-change") && (
            <NoticeBanner
              tone="amber"
              icon={CalendarClock}
              title={
                <>
                  Your plan will change to{" "}
                  <span className="text-orange-700">
                    {scheduledChange.planName}
                  </span>{" "}
                  on{" "}
                  <span className="text-orange-700">{effectiveDateLabel}</span>.
                </>
              }
              description={
                <>
                  Your subscription will switch to {scheduledChange.planName} at{" "}
                  {scheduledChange.planRate}. You keep{" "}
                  {data.plan?.name ?? "your current plan"} and all of its
                  features until then.
                </>
              }
              action={
                <UndoScheduledChangeButton
                  tenantSlug={tenantSlug}
                  label="Cancel change"
                  showIcon={false}
                  className={cn(
                    OUTLINE_BUTTON,
                    "h-9 w-full border-amber-300 text-xs text-amber-900 hover:bg-amber-100 sm:w-auto",
                  )}
                />
              }
              onDismiss={() => dismissBanner("scheduled-change")}
            />
          )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardCard
            icon={Crown}
            iconTone="teal"
            label="Current plan"
            footer={
              <Button
                variant="outline"
                className={OUTLINE_BUTTON}
                onClick={() => setIsPlanDetailsOpen(true)}
              >
                View plan details
              </Button>
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-2xl font-bold tracking-tight text-slate-900">
                  {data.plan?.name ?? "N/A"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  <span className="text-2xl font-bold tracking-tight text-slate-900">
                    ${(data.plan?.rateValue ?? 0).toFixed(2)}
                  </span>{" "}
                  / month
                </p>
              </div>
              <StatusPill tone={planStatus.tone} label={planStatus.label} />
            </div>
            {data.plan?.description && (
              <p className="mt-2 text-xs text-slate-500">
                {data.plan.description}
              </p>
            )}
            <dl className="mt-5 space-y-3 border-t border-slate-100 pt-5 text-sm">
              <DetailRow
                icon={UserRound}
                label="Seat limit"
                value={`${totalSeats} seats`}
              />
              <DetailRow
                icon={CalendarDays}
                label="Next billing date"
                value={hasRenewalDate ? data.renewalDate : "—"}
              />
            </dl>
          </DashboardCard>

          <DashboardCard
            icon={CalendarDays}
            iconTone="blue"
            label="Next payment"
            footer={
              lastPaymentInvoice && (
                <Button
                  variant="outline"
                  className={SECONDARY_BUTTON}
                  onClick={() => setSelectedInvoice(lastPaymentInvoice)}
                >
                  <Eye className={ICON_POP} />
                  View invoice
                </Button>
              )
            }
          >
            {pendingUpgrade ? (
              <>
                <p className="text-2xl font-bold tracking-tight text-slate-900">
                  ${pendingUpgrade.amountDue.toFixed(2)}
                </p>
                <p className="mt-0.5 text-sm text-slate-500 sm:text-base">
                  one-time upgrade
                </p>
                <div className="mt-4 space-y-1 text-sm">
                  <StatusText tone="amber">
                    Awaiting payment for your upgrade to{" "}
                    {pendingUpgrade.planName}
                  </StatusText>
                  <p className="pl-4 text-xs text-slate-500">
                    Then ${pendingUpgrade.planRate.toFixed(2)}/mo, starting with
                    your next billing cycle.
                  </p>
                  {pendingUpgrade.proratedCredit > 0 && (
                    <p className="pl-4 text-xs text-emerald-700">
                      Includes ${pendingUpgrade.proratedCredit.toFixed(2)}{" "}
                      credit for the unused time on your{" "}
                      {data.plan?.name ?? "current"} plan.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold tracking-tight text-slate-900">
                  {data.amountDue?.next ?? "$0.00"}
                </p>
                {hasRenewalDate && (
                  <p className="mt-0.5 text-sm text-slate-500 sm:text-base">
                    Renews {data.renewalDate}
                  </p>
                )}
                <div className="mt-4 space-y-1 text-sm">
                  <StatusText tone={data.autoRenew ? "emerald" : "slate"}>
                    Auto-renew is {data.autoRenew ? "on" : "off"}
                  </StatusText>
                  <p className="pl-4 text-xs text-slate-500">
                    {data.autoRenew
                      ? "Your subscription will automatically renew using your saved payment method."
                      : isFreeTier
                        ? "Your plan is free, so nothing will be charged."
                        : "No further payments will be taken."}
                  </p>
                </div>
              </>
            )}
            <div className="mt-5 border-t border-slate-100 pt-5 text-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                <p className="font-semibold text-slate-900 whitespace-nowrap">
                  Last payment
                </p>

                <p className="text-slate-600">
                  {data.lastPayment
                    ? `${data.lastPayment.amount} · Paid ${data.lastPayment.date}`
                    : "No payments yet."}
                </p>
              </div>
            </div>
          </DashboardCard>

          <DashboardCard
            icon={CreditCard}
            iconTone="blue"
            label="Payment method"
            footer={
              <Button
                variant="outline"
                disabled={isFreeTier}
                className={OUTLINE_BUTTON}
                onClick={() => setIsUpdatePaymentOpen(true)}
              >
                {hasPayPalWallet ? "Manage PayPal" : "Update payment method"}
                {hasPayPalWallet && (
                  <ExternalLink className={ICON_NUDGE_RIGHT} />
                )}
              </Button>
            }
          >
            {hasPayPalWallet ? (
              <>
                <p className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
                  <PayPalMark className="size-7" />
                  PayPal
                </p>
                <div className="mt-3 space-y-0.5 text-sm text-slate-700">
                  {paypalPayerName && <p>{paypalPayerName}</p>}
                  <p className="break-all">
                    {paypalEmail ?? "Billed through your PayPal account"}
                  </p>
                </div>

                <p className="mt-5 border-t border-slate-100 pt-5 text-xs text-slate-500">
                  Used for subscription billing and automatic payments.
                </p>
              </>
            ) : isFreeTier ? (
              <>
                <p className="text-2xl font-bold tracking-tight text-slate-900">
                  Free plan
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  No charges for this plan, so no payment method is needed.
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold tracking-tight text-slate-900">
                  No payment method on file
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Add a payment method to avoid service interruptions.
                </p>
              </>
            )}
          </DashboardCard>

          <DashboardCard
            icon={Users}
            iconTone="blue"
            label="Team members"
            footer={
              <Button
                variant="outline"
                className={OUTLINE_BUTTON}
                onClick={() => router.push(`/${tenantSlug}/settings/team`)}
              >
                <UsersRound className={ICON_POP} />
                Manage team
              </Button>
            }
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-2xl font-bold tracking-tight text-slate-900">
                {usedSeats} / {totalSeats} seats used
              </p>
              <span className="text-sm text-slate-500">
                {unusedSeats} available
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Progress
                value={seatPercentage}
                aria-label="Seats used"
                className="h-2 flex-1 rounded-full bg-slate-100 [&>div]:rounded-full [&>div]:bg-teal-700"
              />
              <span className="w-9 text-right text-xs text-slate-500">
                {seatPercentageLabel}
              </span>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <DetailRow
                icon={UserRound}
                label="Admins"
                value={data.agents?.admins ?? 0}
              />
              <DetailRow
                icon={UserRound}
                label="Agents"
                value={data.agents?.regular ?? 0}
              />
              <DetailRow
                icon={UsersRound}
                label="Available seats"
                value={unusedSeats}
              />
            </dl>
            <p className="border-t border-slate-100 mt-4 text-xs text-slate-500"></p>
          </DashboardCard>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <header className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-3">
              <IconTile icon={FileText} tone="teal" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Billing history
                </h2>
                <p className="text-xs text-slate-500">
                  {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </header>

          {invoices.length === 0 ? (
            <div className="border-t border-slate-100 p-5 text-center text-sm text-slate-500 sm:p-6">
              No invoices yet. They&apos;ll appear here after your first
              payment.
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <Table className="min-w-240 table-fixed">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[30%]" />
                  <col className="w-[12%]" />
                  <col className="w-[13%]" />
                  <col className="w-[17%]" />
                </colgroup>
                <TableHeader>
                  <TableRow className="border-slate-100 bg-slate-50 hover:bg-slate-50">
                    {[
                      "Invoice ID",
                      "Date",
                      "Plan details",
                      "Amount",
                      "Status",
                    ].map((heading) => (
                      <TableHead
                        key={heading}
                        className="h-10 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:px-6"
                      >
                        {heading}
                      </TableHead>
                    ))}
                    <TableHead className="h-10 px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:px-6">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-sm">
                  {visibleInvoices.map((inv) => (
                    <TableRow
                      key={inv.id}
                      className="border-slate-100 hover:bg-slate-50/60"
                    >
                      <TableCell className="whitespace-nowrap px-4 py-3.5 font-mono text-xs font-semibold tracking-tight text-slate-900 sm:px-6 sm:py-4">
                        {inv.id}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3.5 text-slate-600 sm:px-6 sm:py-4">
                        {inv.date}
                      </TableCell>
                      <TableCell className="px-4 py-3.5 sm:px-6 sm:py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">
                            {inv.planName}
                          </span>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                            {inv.invoiceType === "one_time"
                              ? "One-time"
                              : "Monthly"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {inv.invoiceType === "one_time"
                            ? inv.periodStart
                            : `${inv.periodStart} \u2013 ${inv.periodEnd}`}
                          {inv.seats > 0 && (
                            <>
                              {" · "}
                              {inv.seats} seat{inv.seats === 1 ? "" : "s"}
                            </>
                          )}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3.5 sm:px-6 sm:py-4 font-semibold text-slate-900">
                        {inv.amount}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3.5 sm:px-6 sm:py-4">
                        <StatusPill
                          tone={
                            inv.status === "Paid"
                              ? "emerald"
                              : inv.status === "Failed"
                                ? "red"
                                : inv.status === "Refunded"
                                  ? "slate"
                                  : "amber"
                          }
                          label={inv.status}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3.5 sm:px-6 sm:py-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(inv)}
                          className="group/view inline-flex cursor-pointer items-center gap-1.5 rounded-md font-semibold text-teal-700 transition-colors duration-200 ease-out hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 motion-safe:active:scale-[0.98]"
                        >
                          View details
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {pageCount > 1 &&
                    Array.from({
                      length: INVOICES_PER_PAGE - visibleInvoices.length,
                    }).map((_, index) => (
                      <TableRow
                        key={`filler-${index}`}
                        aria-hidden
                        className="border-transparent hover:bg-transparent"
                      >
                        <TableCell
                          colSpan={6}
                          className="px-4 py-3.5 sm:px-6 sm:py-4"
                        >
                          <div className="invisible flex items-center gap-2">
                            <span className="font-medium">&nbsp;</span>
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold">
                              &nbsp;
                            </span>
                          </div>
                          <p className="invisible mt-0.5 text-xs">&nbsp;</p>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
          {invoices.length > 0 && (
            <nav
              aria-label="Billing history pages"
              className="flex flex-col gap-3 border-t border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
            >
              <p className="text-center text-xs text-slate-500 sm:text-left">
                Showing{" "}
                <span className="font-semibold text-slate-700">
                  {pageStart + 1}&ndash;{pageStart + visibleInvoices.length}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-slate-700">
                  {invoices.length}
                </span>{" "}
                invoice{invoices.length === 1 ? "" : "s"}
              </p>

              {pageCount > 1 && (
                <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-2">
                  <Button
                    variant="outline"
                    aria-label="Previous page"
                    disabled={currentPage === 1}
                    onClick={() => setInvoicePage(currentPage - 1)}
                    className={PAGINATION_BUTTON}
                  >
                    <ChevronLeft className={cn("size-4", ICON_NUDGE_LEFT)} />
                  </Button>
                  <span
                    aria-live="polite"
                    className="flex-1 whitespace-nowrap text-center text-xs font-semibold text-slate-600 sm:hidden"
                  >
                    Page {currentPage} of {pageCount}
                  </span>

                  <ul className="hidden items-center gap-1 sm:flex">
                    {pageWindow(currentPage, pageCount).map((page, index) =>
                      page === "gap" ? (
                        <li
                          key={`gap-${index}`}
                          aria-hidden
                          className="px-1 text-xs text-slate-400"
                        >
                          &hellip;
                        </li>
                      ) : (
                        <li key={page}>
                          <Button
                            variant={page === currentPage ? "default" : "ghost"}
                            aria-label={`Page ${page}`}
                            aria-current={
                              page === currentPage ? "page" : undefined
                            }
                            onClick={() => setInvoicePage(page)}
                            className={cn(
                              "size-9 shrink-0 rounded-lg p-0 text-xs font-semibold",
                              BUTTON_MICRO,
                              page === currentPage
                                ? "bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent/90"
                                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                            )}
                          >
                            {page}
                          </Button>
                        </li>
                      ),
                    )}
                  </ul>

                  <Button
                    variant="outline"
                    aria-label="Next page"
                    disabled={currentPage === pageCount}
                    onClick={() => setInvoicePage(currentPage + 1)}
                    className={PAGINATION_BUTTON}
                  >
                    <ChevronRight className={cn("size-4", ICON_NUDGE_RIGHT)} />
                  </Button>
                </div>
              )}
            </nav>
          )}
        </section>
      </div>

      <Dialog open={isPlanDetailsOpen} onOpenChange={setIsPlanDetailsOpen}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)] sm:max-w-md rounded-2xl p-6">
          {" "}
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl font-bold text-slate-900">
              {data.plan?.name ?? "Current plan"}
              <StatusPill tone={planStatus.tone} label={planStatus.label} />
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              {data.plan?.description}
            </DialogDescription>
          </DialogHeader>
          <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {planDetails.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <dt className="text-slate-500">{row.label}</dt>
                <dd className="text-right font-semibold text-slate-900">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {scheduledChange && (
            <ModalNotice icon={CalendarClock} tone="amber">
              Changes to {scheduledChange.planName} ({scheduledChange.planRate})
              on {effectiveDateLabel}.
            </ModalNotice>
          )}
          <DialogFooter className="gap-3 sm:justify-end">
            <Button
              variant="outline"
              className={cn(MODAL_BUTTON, "border-slate-200")}
              onClick={() => setIsPlanDetailsOpen(false)}
            >
              Close
            </Button>
            <Button
              className={cn(MODAL_BUTTON, MODAL_BUTTON_PRIMARY)}
              onClick={() => router.push(plansHref)}
            >
              <MdCurrencyExchange className={ICON_POP} />
              Change plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedInvoice && (
        <InvoiceModal
          isOpen={!!selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          invoice={selectedInvoice}
          account={{ name: data.accountName, tenantId: data.tenantId }}
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
