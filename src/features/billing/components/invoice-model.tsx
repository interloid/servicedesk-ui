"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import {
  CalendarDays,
  Check,
  CircleAlert,
  Clock,
  CreditCard,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  Hash,
  Loader2,
  Receipt,
  Undo2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MODAL_BUTTON, MODAL_BUTTON_PRIMARY } from "./modal-buttons";
import type { BillingDashboardData } from "../services/billing-dashboard.service";

type Invoice = BillingDashboardData["invoices"][number];
type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice;
  /** Bill-to details, printed on the PDF and mirrored in the preview. */
  account: { name: string; tenantId: string };
}

const OUTLINE_BUTTON = cn(MODAL_BUTTON, "border-slate-200 w-full sm:w-auto");

interface StatusMeta {
  pill: string;
  dot: string;
  box: string;
  badge: string;
  badgeLabel: string;
  icon: IconType;
  iconWrap: string;
  divider: string;
  textColor: string;
  strongColor: string;
}

function statusMeta(invoice: Invoice): StatusMeta & { message: ReactNode } {
  switch (invoice.status) {
    case "Paid":
      return {
        pill: "bg-teal-100/70 text-teal-800",
        dot: "bg-brand-accent",
        box: "bg-teal-50",
        badge: "bg-emerald-100 text-emerald-800",
        badgeLabel: "PAID",
        icon: Check,
        iconWrap: "bg-brand-accent text-white",
        divider: "bg-teal-200",
        textColor: "text-slate-600",
        strongColor: "[&_strong]:text-teal-900",
        message: (
          <>
            Paid on <strong>{invoice.paidAt ?? invoice.date}</strong> via{" "}
            <strong>{invoice.paymentMethod}</strong>.
          </>
        ),
      };
    case "Failed":
      return {
        pill: "bg-red-50 text-red-700",
        dot: "bg-red-500",
        box: "bg-red-50",
        badge: "bg-red-100 text-red-800",
        badgeLabel: "PAYMENT FAILED",
        icon: CircleAlert,
        iconWrap: "bg-red-600 text-white",
        divider: "bg-red-200",
        textColor: "text-red-800",
        strongColor: "[&_strong]:text-red-900",
        message: (
          <>
            Payment via <strong>{invoice.paymentMethod}</strong> failed. Update
            your payment method on the billing page.
          </>
        ),
      };
    case "Refunded":
      return {
        pill: "bg-slate-100 text-slate-600",
        dot: "bg-slate-400",
        box: "bg-slate-100",
        badge: "bg-slate-200 text-slate-700",
        badgeLabel: "REFUNDED",
        icon: Undo2,
        iconWrap: "bg-slate-600 text-white",
        divider: "bg-slate-300",
        textColor: "text-slate-700",
        strongColor: "[&_strong]:text-slate-900",
        message: (
          <>
            Refunded to your <strong>{invoice.paymentMethod}</strong> account.
          </>
        ),
      };
    default:
      return {
        pill: "bg-amber-50 text-amber-800",
        dot: "bg-amber-500",
        box: "bg-amber-50",
        badge: "bg-amber-100 text-amber-800",
        badgeLabel: "PENDING",
        icon: Clock,
        iconWrap: "bg-amber-500 text-white",
        divider: "bg-amber-200",
        textColor: "text-amber-800",
        strongColor: "[&_strong]:text-amber-900",
        message: (
          <>
            Payment <strong>pending</strong>. This invoice hasn&apos;t been paid
            yet.
          </>
        ),
      };
  }
}

function InvoicePaper({
  invoice,
  account,
  meta,
}: {
  invoice: Invoice;
  account: InvoiceModalProps["account"];
  meta: StatusMeta;
}) {
  const isOneTime = invoice.invoiceType === "one_time";
  const planName = invoice.planName.replace(/\s+upgrade$/i, "");
  const chargeTitle = isOneTime ? `${planName} Upgrade` : planName;
  const chargeType = isOneTime
    ? "One-time charge"
    : "Recurring subscription charge";
  const chargeNote = [
    `${invoice.seats} ${invoice.seats === 1 ? "agent seat" : "agent seats"}`,
    isOneTime
      ? "Not part of your monthly subscription"
      : "Billed automatically every month",
  ].join(" · ");

  return (
    <div
      aria-hidden="true"
      className="flex-1 rounded-xl border border-slate-200 bg-white p-4 text-[11px] leading-relaxed text-slate-700 shadow-sm sm:p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-brand-accent text-[10px] font-bold leading-none text-white">
            S
          </span>
          <div>
            <p className="text-[13px] font-bold leading-tight text-slate-900">
              ServiceDesk
            </p>
            <p className="text-[9px] text-slate-500">
              Help Desk &amp; Ticket Management Platform
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <p className="text-xs font-bold leading-tight tracking-wide text-teal-700">
            INVOICE
          </p>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[8px] font-bold",
              meta.badge,
            )}
          >
            {meta.badgeLabel}
          </span>
        </div>
      </div>

      <p className="mt-4 text-[11px] font-bold text-slate-900">
        # {invoice.id}
      </p>
      <p className="text-[10px] text-slate-600">Invoice date: {invoice.date}</p>

      <p className="mt-4 text-[8px] font-bold uppercase tracking-wider text-slate-400">
        Bill to
      </p>
      <p className="font-bold text-slate-900 text-[11px]">{account.name}</p>
      {invoice.billingEmail && (
        <p className="break-all text-[10px] text-slate-600">
          {invoice.billingEmail}
        </p>
      )}
      <p className="break-all text-[10px] text-slate-600">
        Tenant ID: {account.tenantId}
      </p>

      <p className="mt-4 text-[9px] font-bold uppercase tracking-wider text-slate-900">
        Charge details
      </p>
      <div className="mt-1 flex justify-between bg-slate-50 px-2 py-1.5 text-[8px] font-bold uppercase text-slate-500">
        <span>Description</span>
        <span>Amount</span>
      </div>
      <div className="flex justify-between gap-2 px-2 py-2">
        <div className="min-w-0">
          <p className="font-bold text-slate-900 text-[10.5px]">
            {chargeTitle} – {chargeType}
          </p>
          <p className="text-[9px] text-slate-500">{chargeNote}</p>
        </div>
        <p className="shrink-0 font-bold text-slate-900 text-[10.5px]">
          {invoice.amount}
        </p>
      </div>

      <div className="mt-2 space-y-1 border-t border-slate-100 px-2 pt-2 text-[10px]">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{invoice.subtotal}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax ({invoice.taxRate})</span>
          <span>{invoice.tax}</span>
        </div>
      </div>
      <div className="mt-2 flex justify-between rounded bg-teal-50 px-2 py-1.5 font-bold text-slate-900 text-[11px]">
        <span>Total</span>
        <span>{invoice.amount}</span>
      </div>
    </div>
  );
}

export default function InvoiceModal({
  isOpen,
  onClose,
  invoice,
  account,
}: InvoiceModalProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const pdfUrl = invoice.pdfUrl;
  const fileName = `${invoice.id || "Invoice"}.pdf`;
  const meta = statusMeta(invoice);
  const StatusIcon = meta.icon;
  const planName = invoice.planName.replace(/\s+upgrade$/i, "");
  const planSummary = [
    invoice.invoiceType === "one_time" ? "One-time upgrade" : "Monthly plan",
    `${invoice.seats} ${invoice.seats === 1 ? "seat" : "seats"}`,
  ].join(" · ");

  const openPdf = () => {
    if (pdfUrl) {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleDownload = async () => {
    if (!pdfUrl) {
      toast.error("This invoice has no PDF yet.");
      return;
    }

    try {
      setIsDownloading(true);

      const response = await fetch(pdfUrl);
      if (!response.ok) throw new Error("Failed to fetch file");

      const blob = await response.blob();

      if (blob.type !== "application/pdf" && !pdfUrl.endsWith(".pdf")) {
        throw new Error("Retrieved file is not a valid PDF");
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();

      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.warn(
        "Direct blob download failed (likely CORS or wrong URL), falling back to new tab:",
        error,
      );
      openPdf();
    } finally {
      setIsDownloading(false);
    }
  };

  const details: Array<{
    icon: IconType;
    label: string;
    value: string;
    emphasis?: boolean;
  }> = [
    {
      icon: CalendarDays,
      label: "Invoice date",
      value: invoice.date,
      emphasis: true,
    },
    { icon: Receipt, label: "Invoice number", value: invoice.id },
    { icon: FileText, label: "Plan details", value: invoice.description },
    {
      icon: Users,
      label: "Seats",
      value: String(invoice.seats),
      emphasis: true,
    },
    {
      icon: CreditCard,
      label: "Payment method",
      value: invoice.paymentMethod,
      emphasis: true,
    },
    {
      icon: Hash,
      label: "Transaction ID",
      value: invoice.transactionId ?? "—",
    },
    {
      icon: DollarSign,
      label: "Amount",
      value: invoice.amount,
      emphasis: true,
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 text-slate-900 sm:max-w-3xl lg:max-w-4xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div>
            <DialogTitle className="text-lg font-bold leading-tight text-slate-900 sm:text-xl">
              Quick invoice
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-slate-500 sm:text-sm">
              A quick preview of your invoice. Download the PDF for full
              details.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="
              -mr-1 shrink-0
              border-none
              bg-transparent
              text-slate-500
              shadow-none
              hover:bg-transparent
              hover:text-slate-500
              active:bg-transparent
              active:text-slate-500
              focus:bg-transparent
              focus-visible:bg-transparent
              focus-visible:ring-0
              focus-visible:ring-offset-0
            "
            >
              <X className="size-5" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-6">
            <div className="flex flex-col justify-between rounded-2xl border border-slate-200 p-4 sm:p-5">
              <div>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-teal-50 p-3.5 sm:p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-accent text-white sm:size-10 sm:rounded-xl">
                      <FileText className="size-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold leading-tight text-slate-900 sm:text-xl">
                        {planName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-600 sm:mt-1 sm:text-sm">
                        {planSummary}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold sm:px-3 sm:py-1 sm:text-sm",
                      meta.pill,
                    )}
                  >
                    {invoice.status}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3.5 px-1 text-xs sm:mt-5 sm:gap-x-6 sm:text-sm">
                  {details.map(({ icon: Icon, label, value, emphasis }) => (
                    <div key={label} className="contents">
                      <dt className="flex items-center gap-2 text-slate-600">
                        <Icon className="size-4 shrink-0 text-slate-500" />
                        <span className="whitespace-nowrap">{label}</span>
                      </dt>
                      <dd
                        className={cn(
                          "wrap-break-word text-right sm:text-left text-slate-900",
                          emphasis ? "font-semibold" : "text-slate-700",
                        )}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div
                className={cn(
                  "mt-5 flex items-center gap-3 rounded-xl p-3.5 text-left sm:gap-4 sm:p-4",
                  meta.box,
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full sm:size-10",
                    meta.iconWrap,
                  )}
                >
                  <StatusIcon className="size-4" strokeWidth={2.5} />
                </span>
                <span
                  aria-hidden="true"
                  className={cn("h-8 w-px shrink-0", meta.divider)}
                />
                <p
                  className={cn(
                    "text-xs sm:text-sm [&_strong]:font-semibold",
                    meta.textColor,
                    meta.strongColor,
                  )}
                >
                  {meta.message}
                </p>
              </div>
            </div>

            <aside className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <p className="text-xs font-medium text-slate-600 sm:text-sm">
                  Invoice PDF preview
                </p>
                {pdfUrl ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={openPdf}
                    className="size-7 text-slate-500 hover:text-slate-900"
                  >
                    <ExternalLink className="size-4" />
                    <span className="sr-only">Open the PDF in a new tab</span>
                  </Button>
                ) : (
                  <span className="text-xs text-slate-400">
                    PDF not available
                  </span>
                )}
              </div>
              <InvoicePaper invoice={invoice} account={account} meta={meta} />
            </aside>
          </div>
        </div>

        <div
          className="
    flex shrink-0 flex-col gap-2.5
    border-t border-slate-200
    px-4 py-3
    sm:px-6 sm:py-4
    lg:flex-row lg:items-center
  "
        >
          <Button
            onClick={handleDownload}
            disabled={isDownloading || !pdfUrl}
            className={cn(
              MODAL_BUTTON,
              MODAL_BUTTON_PRIMARY,
              "order-1 w-full lg:order-3 lg:w-auto",
            )}
          >
            {isDownloading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {isDownloading ? "Downloading..." : "Download PDF"}
          </Button>

          <Button
            variant="outline"
            disabled={!pdfUrl}
            onClick={openPdf}
            className={cn(
              OUTLINE_BUTTON,
              "order-2 w-full lg:order-1 lg:w-auto",
            )}
          >
            View full invoice
            <ExternalLink className="size-4" />
          </Button>

          <Button
            variant="outline"
            onClick={onClose}
            className={cn(
              OUTLINE_BUTTON,
              "order-3 w-full lg:order-2 lg:ml-auto lg:w-auto",
            )}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
