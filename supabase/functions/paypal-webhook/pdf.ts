import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib";

interface Invoice {
  id?: string;
  created_at?: string;
  updated_at?: string;
  paypal_txn_id?: string;
  paypal_subscription_id?: string;
  invoice_number?: string;
  invoice_type?: string;
  status?: string;
  period_start?: string;
  period_end?: string;
  amount?: number;

  // Billing context. Backed by invoices columns where available; the caller can
  // also pass them at render time so legacy rows render identically.
  currency?: string;
  subtotal?: number;
  tax?: number;
  amount_paid?: number;
  balance_due?: number;
  payment_method?: string;
  paid_at?: string;
}

interface Subscription {
  tenant_name?: string;
  tenant_id?: string;
  plan_name?: string;

  billing_cycle?: string;
  seats?: number;

  // Billing email / address shown under Bill To (best effort; address is only
  // rendered when the tenant has one).
  tenant_email?: string;
  tenant_address?: string;

  // Informational "Upcoming billing" panel -- never part of this invoice's
  // subtotal, tax, total or amount paid.
  next_billing_date?: string;
  next_billing_amount?: number;
}

export async function generateInvoicePdf(
  invoice: Invoice,
  subscription: Subscription,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();

  const brandDark = rgb(0.06, 0.09, 0.16);
  const brandTeal = rgb(0.06, 0.44, 0.44);

  const textPrimary = rgb(0.12, 0.15, 0.2);
  const textMuted = rgb(0.4, 0.45, 0.55);

  const borderColor = rgb(0.89, 0.91, 0.94);
  const bgLight = rgb(0.97, 0.98, 0.99);

  const paidBg = rgb(0.88, 0.96, 0.91);
  const paidText = rgb(0.08, 0.48, 0.22);

  const warningBg = rgb(0.99, 0.95, 0.84);
  const warningText = rgb(0.65, 0.42, 0.05);

  const failedBg = rgb(0.99, 0.9, 0.9);
  const failedText = rgb(0.78, 0.12, 0.12);

  const left = 50;
  const right = width - 50;
  const contentWidth = right - left;

  const formatDate = (value?: string) => {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value.substring(0, 10);
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  const currency = invoice.currency || "USD";

  const formatMoney = (value?: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value ?? 0));
  };

  const drawLabel = (text: string, x: number, y: number, size = 8) => {
    page.drawText(text.toUpperCase(), {
      x,
      y,
      size,
      font: bold,
      color: textMuted,
    });
  };

  const drawText = (
    text: string,
    x: number,
    y: number,
    size: number,
    f = font,
    color = textPrimary,
  ) => {
    page.drawText(text, { x, y, size, font: f, color });
  };

  const drawTextRight = (
    text: string,
    x: number,
    y: number,
    size: number,
    f = font,
    color = textPrimary,
  ) => {
    const textWidth = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: x - textWidth, y, size, font: f, color });
  };

  const drawLine = (y: number) => {
    page.drawLine({
      start: { x: left, y },
      end: { x: right, y },
      thickness: 1,
      color: borderColor,
    });
  };

  // Status maps to the invoice_status enum: pending, paid, failed, refunded.
  const status = String(invoice.status || "pending").toLowerCase();

  const isPaid = status === "paid";
  const isRefunded = status === "refunded";
  const isFailed = status === "failed";
  const isPending = status === "pending";

  const statusLabel = isPaid
    ? "PAID"
    : isRefunded
      ? "REFUNDED"
      : isFailed
        ? "PAYMENT FAILED"
        : isPending
          ? "PENDING"
          : status.toUpperCase();

  const statusBackground = isPaid
    ? paidBg
    : isRefunded || isFailed
      ? failedBg
      : warningBg;

  const statusColor = isPaid
    ? paidText
    : isRefunded || isFailed
      ? failedText
      : warningText;

  const invoiceNumber =
    invoice.invoice_number ||
    (invoice.id
      ? `INV-${String(invoice.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`
      : "-");

  const planName = String(subscription.plan_name || "ServiceDesk").replace(
    /\s+upgrade$/i,
    "",
  );

  const isOneTime =
    String(invoice.invoice_type || "").toLowerCase() === "one_time";

  // ── Calculations (totals are ALWAYS the current charge only) ──────────────
  const subtotal = Number(invoice.subtotal ?? invoice.amount ?? 0);
  const tax = Number(invoice.tax ?? 0);
  const total = Number(
    invoice.amount !== undefined ? invoice.amount : subtotal + tax,
  );
  const amountPaid = Number(
    invoice.amount_paid !== undefined
      ? invoice.amount_paid
      : isPaid || isRefunded
        ? total
        : 0,
  );
  const balanceDue = Number(
    invoice.balance_due !== undefined
      ? invoice.balance_due
      : Math.max(total - amountPaid, 0),
  );
  const taxPct = subtotal > 0 ? (tax / subtotal) * 100 : 0;
  const taxPctLabel = `${Number.isInteger(taxPct) ? taxPct : taxPct.toFixed(2)}%`;

  // ── Header ────────────────────────────────────────────────────────────────
  let y = height - 48;

  page.drawText("ServiceDesk", {
    x: left,
    y,
    size: 25,
    font: bold,
    color: brandDark,
  });

  page.drawText("Help Desk & Ticket Management Platform", {
    x: left,
    y: y - 17,
    size: 9,
    font,
    color: textMuted,
  });

  drawTextRight("INVOICE", right, y + 2, 20, bold, brandTeal);

  // Prominent PAYMENT STATUS badge right under the title, above the number.
  const badgeWidth = font.widthOfTextAtSize(statusLabel, 9) + 22;
  const badgeHeight = 20;

  page.drawRectangle({
    x: right - badgeWidth,
    y: y - 24,
    width: badgeWidth,
    height: badgeHeight,
    color: statusBackground,
  });

  page.drawText(statusLabel, {
    x: right - badgeWidth + 11,
    y: y - 20,
    size: 9,
    font: bold,
    color: statusColor,
  });

  drawTextRight(`# ${invoiceNumber}`, right, y - 50, 11, bold, brandDark);

  drawTextRight(
    `Invoice date: ${formatDate(invoice.created_at)}`,
    right,
    y - 65,
    9,
  );

  y -= 90;

  drawLine(y);

  // ── Bill To (left) ────────────────────────────────────────────────────────
  y -= 32;

  const col1X = left;
  const col2X = 295;

  drawLabel("Bill To", col1X, y);

  drawText(
    subscription.tenant_name || "Tenant Account",
    col1X,
    y - 17,
    11,
    bold,
  );

  let customerY = y - 31;

  if (subscription.tenant_email) {
    drawText(subscription.tenant_email, col1X, customerY, 9, font, textMuted);
    customerY -= 14;
  }

  if (subscription.tenant_address) {
    drawText(subscription.tenant_address, col1X, customerY, 9, font, textMuted);
    customerY -= 14;
  }

  drawText(`Tenant ID: ${subscription.tenant_id || "-"}`, col1X, customerY, 8);

  customerY -= 14;
  drawText(`Plan: ${planName}`, col1X, customerY, 8);

  if (subscription.seats !== undefined) {
    customerY -= 13;
    drawText(
      `${subscription.seats} ${subscription.seats === 1 ? "seat" : "seats"}`,
      col1X,
      customerY,
      8,
    );
  }

  // ── Invoice Details (right) ───────────────────────────────────────────────
  drawLabel("Invoice Details", col2X, y);

  let detailsY = y - 17;
  const detailsLine = (label: string, value: string, small = false) => {
    page.drawText(`${label}: `, {
      x: col2X,
      y: detailsY,
      size: small ? 8 : 9,
      font,
      color: textMuted,
    });
    page.drawText(value, {
      x: col2X + font.widthOfTextAtSize(`${label}: `, small ? 8 : 9),
      y: detailsY,
      size: small ? 8 : 9,
      font,
      color: textPrimary,
    });
    detailsY -= small ? 14 : 16;
  };

  detailsLine("Invoice date", formatDate(invoice.created_at));
  detailsLine(
    "Billing period",
    `${formatDate(invoice.period_start)} - ${formatDate(invoice.period_end)}`,
  );
  detailsLine("Currency", currency);
  detailsLine("Payment method", invoice.payment_method || "PayPal");
  detailsLine("Transaction ID", invoice.paypal_txn_id || "-", true);

  if (invoice.paypal_subscription_id) {
    detailsLine("PayPal subscription ID", invoice.paypal_subscription_id, true);
  }

  // Both columns above grow downward independently, so the next section has to
  // start below whichever one ended lower. The old fixed `y -= 62` ignored
  // that: with a PayPal subscription id the details column runs past it, and
  // the divider that used to sit here was drawn straight through the
  // "Payment method" row.
  y = Math.min(customerY, detailsY) - 12;

  // ── Charge details ────────────────────────────────────────────────────────
  y -= 40;

  drawLabel("Charge Details", left, y);

  y -= 22;

  page.drawRectangle({
    x: left,
    y: y - 24,
    width: contentWidth,
    height: 24,
    color: bgLight,
  });

  drawLabel("Description", left + 15, y - 16);
  drawLabel("Billing period", 250, y - 16);
  drawLabel("Amount", right - 70, y - 16);

  y -= 40;

  const chargeTitle = isOneTime ? `${planName} Upgrade` : planName;

  const chargeType = isOneTime
    ? "One-time charge"
    : "Recurring subscription charge";

  drawText(`${chargeTitle} – ${chargeType}`, left + 15, y, 10, bold);

  const seatText =
    subscription.seats !== undefined
      ? `${subscription.seats} ${subscription.seats === 1 ? "agent seat" : "agent seats"}`
      : "";

  const subLine = [
    seatText,
    isOneTime
      ? "Not part of your monthly subscription"
      : "Billed automatically every month",
  ]
    .filter(Boolean)
    .join(" · ");

  drawText(subLine, left + 15, y - 14, 8, font, textMuted);

  const periodText = `${formatDate(invoice.period_start)} - ${formatDate(invoice.period_end)}`;
  const periodWidth = font.widthOfTextAtSize(periodText, 9);
  drawText(periodText, 250, y, 9);

  drawTextRight(formatMoney(total), right - 5, y + 3, 10, bold);

  y -= 34;

  drawLine(y);

  // ── Amount summary (Subtotal, Tax, Total, Amount paid, Balance due) ───────
  y -= 24;

  const totalsX = width - 250;
  const valueX = right - 5;

  const drawTotalRow = (
    label: string,
    value: string,
    rowY: number,
    valueSize = 10,
    valueColor = textPrimary,
  ) => {
    page.drawText(label, {
      x: totalsX,
      y: rowY,
      size: 10,
      font,
      color: textMuted,
    });

    const valueWidth = bold.widthOfTextAtSize(value, valueSize);

    page.drawText(value, {
      x: valueX - valueWidth,
      y: rowY,
      size: valueSize,
      font: bold,
      color: valueColor,
    });
  };

  drawTotalRow("Subtotal", formatMoney(subtotal), y);
  y -= 20;

  drawTotalRow(`Tax (${taxPctLabel})`, formatMoney(tax), y);
  y -= 14;

  drawLine(y);

  y -= 24;

  drawTotalRow("Total", formatMoney(total), y, 14, brandDark);

  y -= 24;

  drawTotalRow(
    "Amount paid",
    formatMoney(amountPaid),
    y,
    10,
    isPaid ? paidText : textPrimary,
  );

  y -= 23;

  drawTotalRow(
    "Balance due",
    formatMoney(balanceDue),
    y,
    11,
    balanceDue > 0 ? failedText : paidText,
  );

  // ── Upcoming billing (informational, never added to this invoice) ─────────
  if (subscription.next_billing_date) {
    y -= 32;

    page.drawRectangle({
      x: left,
      y: y - 58,
      width: contentWidth,
      height: 58,
      color: bgLight,
    });

    drawLabel("Upcoming Billing", left + 15, y - 14);

    drawText(
      `Next billing date: ${formatDate(subscription.next_billing_date)}`,
      left + 15,
      y - 30,
      9,
      bold,
    );

    if (subscription.next_billing_amount !== undefined) {
      drawTextRight(
        `Next recurring amount: ${formatMoney(subscription.next_billing_amount)}/month`,
        right - 15,
        y - 30,
        9,
        bold,
      );
    } else {
      drawTextRight("Next recurring amount: —", right - 15, y - 30, 9, bold);
    }

    drawText(
      "This is informational only and is not included in any amount on this invoice.",
      left + 15,
      y - 44,
      7,
      font,
      textMuted,
    );

    y -= 82;
  }

  // ── Payment information ───────────────────────────────────────────────────
  y -= 26;

  const paymentBoxHeight = isFailed ? 72 : 66;

  page.drawRectangle({
    x: left,
    y: y - paymentBoxHeight,
    width: contentWidth,
    height: paymentBoxHeight,
    color: isPaid ? paidBg : isFailed ? failedBg : bgLight,
  });

  const paymentMethod =
    invoice.payment_method || subscription.billing_cycle || "PayPal";

  if (isPaid) {
    page.drawText("Payment completed", {
      x: left + 15,
      y: y - 20,
      size: 10,
      font: bold,
      color: paidText,
    });

    page.drawText(`Provider: ${paymentMethod}`, {
      x: left + 15,
      y: y - 38,
      size: 9,
      font,
      color: textMuted,
    });

    page.drawText(`Transaction ID: ${invoice.paypal_txn_id || "-"}`, {
      x: left + 15,
      y: y - 52,
      size: 8,
      font,
      color: textMuted,
    });

    page.drawText(
      `Paid on ${formatDate(invoice.paid_at || invoice.created_at)}`,
      {
        x: left + 15,
        y: y - 62,
        size: 9,
        font,
        color: paidText,
      },
    );
  } else if (isFailed) {
    page.drawText("Payment failed", {
      x: left + 15,
      y: y - 20,
      size: 10,
      font: bold,
      color: failedText,
    });

    page.drawText(`Provider: ${paymentMethod}`, {
      x: left + 15,
      y: y - 38,
      size: 9,
      font,
      color: textMuted,
    });

    page.drawText(`Transaction ID: ${invoice.paypal_txn_id || "-"}`, {
      x: left + 15,
      y: y - 52,
      size: 8,
      font,
      color: textMuted,
    });

    page.drawText("Status: PAYMENT FAILED", {
      x: left + 15,
      y: y - 62,
      size: 9,
      font,
      color: failedText,
    });
  } else {
    page.drawText(statusLabel, {
      x: left + 15,
      y: y - 20,
      size: 10,
      font: bold,
      color: statusColor,
    });

    page.drawText(`Provider: ${paymentMethod}`, {
      x: left + 15,
      y: y - 38,
      size: 9,
      font,
      color: textMuted,
    });

    page.drawText(`Transaction ID: ${invoice.paypal_txn_id || "-"}`, {
      x: left + 15,
      y: y - 52,
      size: 8,
      font,
      color: textMuted,
    });

    page.drawText("Please refer to your billing account for payment details.", {
      x: left + 15,
      y: y - 62,
      size: 9,
      font,
      color: textMuted,
    });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  y -= paymentBoxHeight + 30;

  drawLine(y);

  y -= 28;

  page.drawText("Thank you for your business.", {
    x: left,
    y,
    size: 11,
    font: bold,
    color: brandDark,
  });

  y -= 17;

  page.drawText("Questions about this invoice?", {
    x: left,
    y,
    size: 9,
    font,
    color: textMuted,
  });

  y -= 14;

  page.drawText("support@servicedesk.com", {
    x: left,
    y,
    size: 9,
    font,
    color: brandTeal,
  });

  y -= 14;

  const footerCompany =
    "ServiceDesk, Inc. · 1 Market Plaza, Suite 300 · San Francisco, CA 94105";
  const footerCompanyWidth = font.widthOfTextAtSize(footerCompany, 7);

  page.drawText(footerCompany, {
    x: left,
    y,
    size: 7,
    font,
    color: textMuted,
  });

  const websiteLeft = left + footerCompanyWidth + 14;

  page.drawText("www.servicedesk.com", {
    x: websiteLeft,
    y,
    size: 7,
    font,
    color: brandTeal,
  });

  const footerText = "This invoice was generated electronically.";

  drawTextRight(footerText, right, y - 13, 8, font, textMuted);

  return await pdf.save();
}
