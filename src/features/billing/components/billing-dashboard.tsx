"use client";

import {
  use,
  useState,
  useTransition,
  type ComponentType,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeftRight,
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
  Loader2,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
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
import { abortPlanSwitchAction } from "../billing-actions";
import { ModalNotice } from "./modal-notice";

export const MODAL_BUTTON =
  "h-10 w-full gap-2 rounded-lg px-5 text-sm font-semibold shadow-none duration-200 ease-out motion-safe:active:scale-[0.98] sm:w-auto";

/** The affirmative action in a dialog footer. */
export const MODAL_BUTTON_PRIMARY =
  "bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent/90";
type Invoice = BillingDashboardData["invoices"][number];
type IconType = ComponentType<{ className?: string }>;
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
const ICON_TURN = `${MICRO_ICON} motion-safe:group-hover/button:rotate-45`;

const PRIMARY_BUTTON = `h-10 gap-2 rounded-lg bg-brand-accent px-4 text-sm font-semibold text-brand-accent-foreground shadow-none hover:bg-brand-accent/90 ${BUTTON_MICRO}`;
const OUTLINE_BUTTON = `h-10 gap-2 rounded-lg border-slate-200 px-4 ${BUTTON_MICRO}`;
const SECONDARY_BUTTON = `h-10 gap-2 rounded-lg px-4 text-sm font-semibold ${BUTTON_MICRO}`;
const PAGINATION_BUTTON = `h-10 shrink-0 gap-1.5 rounded-lg border-slate-200 px-3 text-xs sm:h-9 ${BUTTON_MICRO}`;

const PILL_TONES: Record<
  PillTone,
  { pill: string; dot: string; text: string }
> = {
  emerald: {
    pill: "bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
  },
  sky: {
    pill: "bg-sky-50 text-sky-700",
    dot: "bg-sky-500",
    text: "text-sky-700",
  },
  amber: {
    pill: "bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    text: "text-amber-800",
  },
  red: {
    pill: "bg-red-50 text-red-700",
    dot: "bg-red-500",
    text: "text-red-700",
  },
  slate: {
    pill: "bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
    text: "text-slate-500",
  },
};

interface BillingDashboardProps {
  params: Promise<{ tenantSlug: string }>;
  initialData?: BillingDashboardData | null;
  isLoading?: boolean;
}

function IconTile({
  icon: Icon,
  tone,
}: {
  icon: IconType;
  tone: "teal" | "blue";
}) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg",
        tone === "teal"
          ? "bg-teal-50 text-teal-700"
          : "bg-blue-50 text-blue-600",
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}

function StatusPill({ tone, label }: { tone: PillTone; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
        PILL_TONES[tone].pill,
      )}
    >
      <span className={cn("size-1.5 rounded-full", PILL_TONES[tone].dot)} />
      {label}
    </span>
  );
}

function StatusText({
  tone,
  children,
}: {
  tone: PillTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold",
        PILL_TONES[tone].text,
      )}
    >
      <span className={cn("size-2 rounded-full", PILL_TONES[tone].dot)} />
      {children}
    </span>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: IconType;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2.5 text-slate-600">
        <Icon className="size-4 text-slate-400" />
        {label}
      </dt>
      <dd className="text-right font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function DashboardCard({
  icon,
  iconTone,
  label,
  children,
  footer,
}: {
  icon: IconType;
  iconTone: "teal" | "blue";
  label: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
      <header className="flex items-center gap-3">
        <IconTile icon={icon} tone={iconTone} />
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
          {label}
        </h2>
      </header>
      <div className="mt-5 flex flex-1 flex-col">{children}</div>
      {footer && (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap [&>button]:w-full sm:[&>button]:w-auto">
          {footer}
        </div>
      )}
    </section>
  );
}

function NoticeBanner({
  tone,
  icon: Icon,
  title,
  description,
  action,
}: {
  tone: "amber" | "red";
  icon: IconType;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
}) {
  const styles =
    tone === "red"
      ? {
          box: "border-red-200 bg-red-50",
          tile: "bg-red-500",
          title: "text-red-950",
          text: "text-red-800",
        }
      : {
          box: "border-amber-200 bg-amber-50",
          tile: "bg-amber-500",
          title: "text-amber-950",
          text: "text-amber-800",
        };

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
        styles.box,
      )}
    >
      <div className="flex min-w-0 items-start gap-4">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg text-white",
            styles.tile,
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className={cn("text-sm font-semibold", styles.title)}>{title}</h3>
          <p className={cn("mt-0.5 text-xs", styles.text)}>{description}</p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function PayPalMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="#003087"
    >
      <path d="M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087z" />
      <path
        fill="#0070e0"
        d="M19.79 6.142c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.94c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.84-4.84z"
      />
    </svg>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg bg-slate-100" />
        <Skeleton className="h-3 w-24 bg-slate-100" />
      </div>
      <Skeleton className="mt-5 h-7 w-32 bg-slate-100" />
      <Skeleton className="mt-2 h-4 w-24 bg-slate-100" />
      <div className="mt-6 space-y-3">
        <Skeleton className="h-4 w-full bg-slate-100" />
        <Skeleton className="h-4 w-full bg-slate-100" />
        <Skeleton className="h-4 w-3/4 bg-slate-100" />
      </div>
      <Skeleton className="mt-6 h-10 w-32 rounded-lg bg-slate-100" />
    </div>
  );
}

function LoadingState({ showBanner }: { showBanner: boolean }) {
  return (
    <div className="h-full p-4 font-sans text-slate-900 sm:p-8">
      <div className="mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-24 bg-slate-200" />
            <Skeleton className="h-4 w-72 max-w-full bg-slate-200" />
          </div>
          <Skeleton className="h-10 w-full rounded-lg bg-slate-200 sm:w-36" />
        </div>
        {showBanner && (
          <Skeleton className="h-19 w-full rounded-xl bg-slate-100" />
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-3 px-6 py-4">
            <Skeleton className="size-10 rounded-lg bg-slate-100" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-28 bg-slate-100" />
              <Skeleton className="h-3 w-16 bg-slate-100" />
            </div>
          </div>
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-4 px-6 py-4"
              >
                <Skeleton className="h-3 w-16 bg-slate-100" />
                <Skeleton className="h-3 w-20 bg-slate-100" />
                <Skeleton className="h-3 w-36 bg-slate-100" />
                <Skeleton className="h-3 w-14 bg-slate-100" />
                <Skeleton className="h-5 w-14 rounded-full bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
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
  const [isAborting, startAbort] = useTransition();

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
            <ArrowLeftRight />
            Change plan
          </Button>
        </div>

        {isPaymentFailed ? (
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
          />
        ) : data.billingStatus === "cancelled" ? (
          <NoticeBanner
            tone="amber"
            icon={Clock}
            title={`Cancels on ${data.renewalDate}`}
            description={`Your subscription will end on ${data.renewalDate}. You can reactivate or change your plan before then.`}
            action={
              <Button
                variant="outline"
                className={cn(
                  OUTLINE_BUTTON,
                  "h-9 w-full border-amber-300 text-xs text-amber-900 hover:bg-amber-100 sm:w-auto",
                )}
                onClick={() => router.push(plansHref)}
              >
                Reactivate
              </Button>
            }
          />
        ) : null}

        {scheduledChange && (
          <NoticeBanner
            tone="amber"
            icon={CalendarClock}
            title={
              <>
                Your plan will change to{" "}
                <span className="text-orange-700">
                  {scheduledChange.planName}
                </span>{" "}
                on <span className="text-orange-700">{effectiveDateLabel}</span>
                .
              </>
            }
            description={
              <>
                Your subscription will switch to {scheduledChange.planName} at{" "}
                {scheduledChange.planRate}. You keep{" "}
                {data.plan?.name ?? "your current plan"} and all of its features
                until then.
              </>
            }
            action={
              <Button
                variant="outline"
                disabled={isAborting}
                onClick={handleAbort}
                className={cn(
                  OUTLINE_BUTTON,
                  "h-9 w-full border-amber-300 text-xs text-amber-900 hover:bg-amber-100 sm:w-auto",
                )}
              >
                {isAborting && <Loader2 className="animate-spin" />}
                Cancel change
              </Button>
            }
          />
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardCard
            icon={Crown}
            iconTone="teal"
            label="Current plan"
            footer={
              <>
                <Button
                  className={PRIMARY_BUTTON}
                  onClick={() => router.push(plansHref)}
                >
                  <Settings className={ICON_TURN} />
                  Manage plan
                </Button>
                <Button
                  variant="outline"
                  className={OUTLINE_BUTTON}
                  onClick={() => setIsPlanDetailsOpen(true)}
                >
                  View plan details
                </Button>
              </>
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-2xl font-bold tracking-tight text-slate-900">
                  {data.plan?.name ?? "N/A"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  <span className="text-lg font-bold text-slate-900">
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
              <DetailRow
                icon={ShieldCheck}
                label="Auto-renew"
                value={
                  <StatusText tone={data.autoRenew ? "emerald" : "slate"}>
                    {data.autoRenew ? "On" : "Off"}
                  </StatusText>
                }
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
                <p className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
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
                <p className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
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
                className={OUTLINE_BUTTON}
                onClick={() => setIsUpdatePaymentOpen(true)}
              >
                {hasPayPalWallet ? "Manage PayPal" : "Change payment method"}
                {hasPayPalWallet && (
                  <ExternalLink className={ICON_NUDGE_RIGHT} />
                )}
              </Button>
            }
          >
            {hasPayPalWallet ? (
              <>
                <p className="flex items-center gap-2 text-lg font-bold text-slate-900">
                  <PayPalMark className="size-6" />
                  PayPal
                </p>
                <div className="mt-3 space-y-0.5 text-sm text-slate-700">
                  {paypalPayerName && <p>{paypalPayerName}</p>}
                  <p className="break-all">
                    {paypalEmail ?? "Billed through your PayPal account"}
                  </p>
                </div>
                <span className="mt-3 w-fit rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
                  Default
                </span>
                <p className="mt-5 border-t border-slate-100 pt-5 text-xs text-slate-500">
                  Used for subscription billing and automatic payments.
                </p>
              </>
            ) : isFreeTier ? (
              <>
                <p className="text-lg font-bold text-slate-900">Free plan</p>
                <p className="mt-2 text-sm text-slate-600">
                  No charges for this plan, so no payment method is needed.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-slate-900">
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
              <p className="text-xl font-bold tracking-tight text-slate-900">
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
            <p className="mt-5 border-t border-slate-100 pt-5 text-xs text-slate-500">
              {unusedSeats > 0
                ? "Each seat represents one team member who can sign in."
                : `No seats available — all ${totalSeats} are in use.`}
            </p>
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
              <Table className="min-w-180">
                <TableHeader>
                  <TableRow className="border-slate-100 bg-slate-50 hover:bg-slate-50">
                    {["Invoice", "Date", "Description", "Amount", "Status"].map(
                      (heading) => (
                        <TableHead
                          key={heading}
                          className="h-10 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:px-6"
                        >
                          {heading}
                        </TableHead>
                      ),
                    )}
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
                      <TableCell className="whitespace-nowrap px-4 py-3.5 sm:px-6 sm:py-4 font-semibold text-slate-900">
                        {inv.id}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3.5 sm:px-6 sm:py-4 text-slate-600">
                        {inv.date}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-3.5 sm:px-6 sm:py-4 text-slate-600">
                        {inv.description}
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
                          <Eye className="size-4 transition-transform duration-200 ease-out motion-safe:group-hover/view:scale-110" />
                          View invoice
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {pageCount > 1 && (
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
                invoices
              </p>
              <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-3">
                <Button
                  variant="outline"
                  aria-label="Previous page"
                  disabled={currentPage === 1}
                  onClick={() => setInvoicePage(currentPage - 1)}
                  className={cn(PAGINATION_BUTTON, "pl-2.5 sm:pl-3")}
                >
                  <ChevronLeft className={cn("size-4", ICON_NUDGE_LEFT)} />
                  {/* "Prev" keeps the control inside a 320px viewport; the
                      aria-label carries the full wording either way. */}
                  <span className="sm:hidden">Prev</span>
                  <span className="hidden sm:inline">Previous</span>
                </Button>
                <span
                  aria-live="polite"
                  className="flex-1 whitespace-nowrap text-center text-xs font-semibold text-slate-600 sm:flex-none sm:px-1"
                >
                  Page {currentPage} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  aria-label="Next page"
                  disabled={currentPage === pageCount}
                  onClick={() => setInvoicePage(currentPage + 1)}
                  className={cn(PAGINATION_BUTTON, "pr-2.5 sm:pr-3")}
                >
                  Next
                  <ChevronRight className={cn("size-4", ICON_NUDGE_RIGHT)} />
                </Button>
              </div>
            </nav>
          )}
        </section>
      </div>

      <Dialog open={isPlanDetailsOpen} onOpenChange={setIsPlanDetailsOpen}>
        <DialogContent className="max-w-md rounded-2xl p-6">
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
              <ArrowLeftRight className={ICON_POP} />
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
