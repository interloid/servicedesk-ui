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
  Eye,
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

const OUTLINE_BUTTON = cn(MODAL_BUTTON, "border-slate-200 bg-white");

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

// A scaled-down rendering of the invoice PDF (paypal-webhook/pdf.ts): same
// sections and wording, drawn from the same invoice row. The real PDF is one
// click away through "View full invoice".
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
      className="flex-1 rounded-lg border border-slate-200 bg-white p-4 text-[8px] leading-relaxed text-slate-700 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-lg bg-brand-accent text-[8.5px] font-bold leading-none text-white">
            S
          </span>
          <div>
            <p className="text-[11px] font-bold leading-tight text-slate-900">
              ServiceDesk
            </p>
            <p className="text-[6.5px] text-slate-500">
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
              "rounded-full px-2 py-0.5 text-[6.5px] font-bold",
              meta.badge,
            )}
          >
            {meta.badgeLabel}
          </span>
        </div>
      </div>

      <p className="mt-3 text-[8.5px] font-bold text-slate-900">
        # {invoice.id}
      </p>
      <p>Invoice date: {invoice.date}</p>

      <p className="mt-3 text-[6.5px] font-bold uppercase tracking-wider text-slate-500">
        Bill to
      </p>
      <p className="font-bold text-slate-900">{account.name}</p>
      {invoice.billingEmail && (
        <p className="break-all">{invoice.billingEmail}</p>
      )}
      <p className="break-all">Tenant ID: {account.tenantId}</p>

      <p className="mt-3 text-[7px] font-bold uppercase tracking-wider text-slate-900">
        Charge details
      </p>
      <div className="mt-1 flex justify-between bg-slate-50 px-1.5 py-1 text-[6.5px] font-bold uppercase text-slate-500">
        <span>Description</span>
        <span>Amount</span>
      </div>
      <div className="flex justify-between gap-2 px-1.5 py-1.5">
        <div className="min-w-0">
          <p className="font-bold text-slate-900">
            {chargeTitle} – {chargeType}
          </p>
          <p className="text-[6.5px] text-slate-500">{chargeNote}</p>
        </div>
        <p className="shrink-0 font-bold text-slate-900">{invoice.amount}</p>
      </div>

      <div className="space-y-1 border-t border-slate-100 px-1.5 pt-1.5">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{invoice.subtotal}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax ({invoice.taxRate})</span>
          <span>{invoice.tax}</span>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between rounded bg-teal-50 px-1.5 py-1 font-bold text-slate-900">
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
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-2xl p-0 text-slate-900 sm:max-w-3xl"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <DialogTitle className="text-xl font-bold leading-tight text-slate-900">
              Quick invoice
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-sm text-slate-500">
              A quick preview of your invoice. Download the PDF for full
              details.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="-mr-2 shrink-0 border-none bg-none text-slate-500 hover:text-slate-900"
            >
              <X className="size-5" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>

        <div className="grid gap-6 px-6 py-6 md:grid-cols-[minmax(0,1fr)_18.5rem]">
          <div className="min-w-0 rounded-2xl border border-slate-200 p-4 md:pr-6">
            <div className="flex items-center gap-4 rounded-xl bg-teal-50 p-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-brand-accent text-white">
                <FileText className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xl font-bold leading-tight text-slate-900">
                  {planName}
                </p>
                <p className="mt-1 truncate text-sm text-slate-600">
                  {planSummary}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold",
                  meta.pill,
                )}
              >
                <span className={cn("size-1.5 rounded-full", meta.dot)} />
                {invoice.status}
              </span>
            </div>

            <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-3.5 px-1 text-sm">
              {details.map(({ icon: Icon, label, value, emphasis }) => (
                <div key={label} className="contents">
                  <dt className="flex items-center gap-3 text-slate-600">
                    <Icon className="size-4.5 text-slate-500" />
                    {label}
                  </dt>
                  <dd
                    className={cn(
                      "break-all text-slate-900",
                      emphasis ? "font-semibold" : "text-slate-700",
                    )}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <div
              className={cn(
                "mt-5 flex items-center gap-4 rounded-xl p-4 text-left",
                meta.box,
              )}
            >
              <span
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-full",
                  meta.iconWrap,
                )}
              >
                <StatusIcon className="size-5" strokeWidth={2.5} />
              </span>
              <span
                aria-hidden="true"
                className={cn("w-px self-stretch", meta.divider)}
              />
              <p
                className={cn(
                  "text-sm [&_strong]:font-semibold",
                  meta.textColor,
                  meta.strongColor,
                )}
              >
                {meta.message}
              </p>
            </div>
          </div>

          <aside className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <p className="text-sm font-medium text-slate-600">
                Invoice PDF preview
              </p>
              {pdfUrl ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={openPdf}
                  className="text-slate-500 hover:text-slate-900"
                >
                  <ExternalLink />
                  <span className="sr-only">Open the PDF in a new tab</span>
                </Button>
              ) : (
                <span className="text-xs text-slate-400">
                  PDF not available yet
                </span>
              )}
            </div>
            <InvoicePaper invoice={invoice} account={account} meta={meta} />
          </aside>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            disabled={!pdfUrl}
            onClick={openPdf}
            className={OUTLINE_BUTTON}
          >
            
            View full invoice
            <ExternalLink />
          </Button>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button
              variant="outline"
              onClick={onClose}
              className={OUTLINE_BUTTON}
            >
              Close
            </Button>
            <Button
              onClick={handleDownload}
              disabled={isDownloading || !pdfUrl}
              className={cn(MODAL_BUTTON, MODAL_BUTTON_PRIMARY)}
            >
              {isDownloading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              {isDownloading ? "Downloading..." : "Download PDF"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
