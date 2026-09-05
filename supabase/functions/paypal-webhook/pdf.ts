import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib";

interface Invoice {
  id?: string;
  created_at?: string;
  updated_at?: string;
  paypal_txn_id?: string;
  status?: string;
  period_start?: string;
  period_end?: string;
  amount?: number;

  // Optional billing information. Not stored in the database yet, so the PDF
  // only renders these when the caller provides them.
  currency?: string;
  subtotal?: number;
  tax?: number;
  amount_paid?: number;
  balance_due?: number;
  payment_method?: string;
}

interface Subscription {
  tenant_name?: string;
  tenant_id?: string;
  plan_name?: string;

  billing_cycle?: string;
  seats?: number;

  // Optional customer information (not stored yet).
  tenant_email?: string;
  tenant_address?: string;
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
    page.drawText(text.toUpperCase(), { x, y, size, font: bold, color: textMuted });
  };

  const drawLine = (y: number) => {
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: borderColor });
  };

  // Status maps to the invoice_status enum:
  //   pending, paid, failed, refunded
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

  let y = height - 52;

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

  page.drawText("INVOICE", {
    x: right - 105,
    y: y + 2,
    size: 20,
    font: bold,
    color: brandTeal,
  });

  const invoiceId = String(invoice.id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  const invoiceNumber = invoiceId ? `INV-${invoiceId}` : "-";

  page.drawText(`# ${invoiceNumber}`, {
    x: right - 105,
    y: y - 17,
    size: 9,
    font,
    color: textMuted,
  });

  y -= 55;

  drawLine(y);

  y -= 28;

  const badgeWidth = isFailed
    ? 115
    : isPending
      ? 75
      : isRefunded
        ? 90
        : 55;

  page.drawRectangle({
    x: right - badgeWidth,
    y: y - 4,
    width: badgeWidth,
    height: 22,
    color: statusBackground,
  });

  page.drawText(statusLabel, {
    x: right - badgeWidth + 10,
    y: y + 3,
    size: 8,
    font: bold,
    color: statusColor,
  });

  y -= 55;

  const col1X = left;
  const col2X = 320;

  drawLabel("Bill To", col1X, y);

  page.drawText(subscription.tenant_name || "Tenant Account", {
    x: col1X,
    y: y - 17,
    size: 11,
    font: bold,
    color: textPrimary,
  });

  let customerY = y - 32;

  if (subscription.tenant_email) {
    page.drawText(subscription.tenant_email, {
      x: col1X,
      y: customerY,
      size: 9,
      font,
      color: textMuted,
    });

    customerY -= 14;
  }

  if (subscription.tenant_address) {
    page.drawText(subscription.tenant_address, {
      x: col1X,
      y: customerY,
      size: 9,
      font,
      color: textMuted,
    });

    customerY -= 14;
  }

  page.drawText(`Tenant ID: ${subscription.tenant_id || "-"}`, {
    x: col1X,
    y: customerY,
    size: 8,
    font,
    color: textMuted,
  });

  drawLabel("Invoice Details", col2X, y);

  page.drawText(`Invoice date: ${formatDate(invoice.created_at)}`, {
    x: col2X,
    y: y - 17,
    size: 9,
    font,
    color: textPrimary,
  });

  page.drawText(
    `Billing period: ${formatDate(invoice.period_start)} - ${formatDate(invoice.period_end)}`,
    {
      x: col2X,
      y: y - 32,
      size: 9,
      font,
      color: textPrimary,
    },
  );

  page.drawText(`Payment method: ${invoice.payment_method || "PayPal"}`, {
    x: col2X,
    y: y - 47,
    size: 9,
    font,
    color: textPrimary,
  });

  if (invoice.paypal_txn_id) {
    page.drawText(`Transaction ID: ${invoice.paypal_txn_id}`, {
      x: col2X,
      y: y - 62,
      size: 8,
      font,
      color: textMuted,
    });
  }

  y -= 105;

  drawLine(y);

  y -= 25;

  drawLabel("Subscription", left, y);

  page.drawText(subscription.plan_name || "ServiceDesk Subscription", {
    x: left,
    y: y - 18,
    size: 11,
    font: bold,
    color: textPrimary,
  });

  const subscriptionDetails: string[] = [];

  if (subscription.billing_cycle) {
    subscriptionDetails.push(subscription.billing_cycle);
  }

  if (subscription.seats !== undefined) {
    subscriptionDetails.push(
      `${subscription.seats} ${
        subscription.seats === 1 ? "agent seat" : "agent seats"
      }`,
    );
  }

  if (subscriptionDetails.length > 0) {
    page.drawText(subscriptionDetails.join(" · "), {
      x: left,
      y: y - 33,
      size: 9,
      font,
      color: textMuted,
    });
  }

  y -= 65;

  page.drawRectangle({
    x: left,
    y: y - 28,
    width: contentWidth,
    height: 28,
    color: bgLight,
  });

  drawLabel("Description", left + 15, y - 18);
  drawLabel("Billing Period", 260, y - 18);
  drawLabel("Amount", right - 70, y - 18);

  y -= 55;

  page.drawText(
    subscription.plan_name
      ? `${subscription.plan_name} Subscription`
      : "ServiceDesk Subscription",
    {
      x: left + 15,
      y,
      size: 10,
      font: bold,
      color: textPrimary,
    },
  );

  page.drawText(
    `${formatDate(invoice.period_start)} - ${formatDate(invoice.period_end)}`,
    {
      x: 260,
      y,
      size: 9,
      font,
      color: textMuted,
    },
  );

  const amount = Number(invoice.amount ?? 0);

  page.drawText(formatMoney(amount), {
    x: right - 70,
    y,
    size: 10,
    font: bold,
    color: textPrimary,
  });

  y -= 30;

  drawLine(y);

  y -= 30;

  const totalsX = width - 240;
  const valueX = right - 5;

  const total =
    invoice.amount !== undefined
      ? invoice.amount
      : (invoice.subtotal ?? 0) + Number(invoice.tax ?? 0);

  const amountPaid =
    invoice.amount_paid !== undefined
      ? invoice.amount_paid
      : isPaid || isRefunded
        ? total
        : 0;

  const balanceDue =
    invoice.balance_due !== undefined
      ? invoice.balance_due
      : Math.max(total - amountPaid, 0);

  const drawTotalRow = (
    label: string,
    value: string,
    rowY: number,
    valueSize = 10,
    valueColor = textPrimary,
  ) => {
    page.drawText(label, { x: totalsX, y: rowY, size: 10, font, color: textMuted });

    const valueWidth = bold.widthOfTextAtSize(value, valueSize);

    page.drawText(value, {
      x: valueX - valueWidth,
      y: rowY,
      size: valueSize,
      font: bold,
      color: valueColor,
    });
  };

  // Subtotal and Tax are only shown when the caller provides them; the
  // invoices table does not store them yet, so rendering fake "$0.00" rows
  // would misrepresent the actual PayPal charges.
  if (invoice.subtotal !== undefined) {
    drawTotalRow("Subtotal", formatMoney(invoice.subtotal), y);
    y -= 20;
  }

  if (invoice.tax !== undefined) {
    drawTotalRow("Tax", formatMoney(Number(invoice.tax)), y);
    y -= 12;
  }

  drawLine(y);

  y -= 25;

  drawTotalRow("Total", formatMoney(total), y, 14, brandDark);

  y -= 23;

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

  y -= 50;

  const paymentBoxHeight = 58;

  page.drawRectangle({
    x: left,
    y: y - paymentBoxHeight,
    width: contentWidth,
    height: paymentBoxHeight,
    color: isPaid ? paidBg : bgLight,
  });

  if (isPaid) {
    page.drawText("Payment completed", {
      x: left + 15,
      y: y - 20,
      size: 10,
      font: bold,
      color: paidText,
    });

    page.drawText(
      `Paid on ${formatDate(invoice.created_at)}${
        invoice.payment_method ? ` · ${invoice.payment_method}` : ""
      }`,
      {
        x: left + 15,
        y: y - 37,
        size: 9,
        font,
        color: textMuted,
      },
    );
  } else if (isRefunded) {
    page.drawText("Payment refunded", {
      x: left + 15,
      y: y - 20,
      size: 10,
      font: bold,
      color: failedText,
    });

    page.drawText(
      `Refunded on ${formatDate(invoice.updated_at || invoice.created_at)}${
        invoice.payment_method ? ` · ${invoice.payment_method}` : ""
      }`,
      {
        x: left + 15,
        y: y - 37,
        size: 9,
        font,
        color: textMuted,
      },
    );
  } else {
    page.drawText(statusLabel, {
      x: left + 15,
      y: y - 20,
      size: 10,
      font: bold,
      color: statusColor,
    });

    page.drawText(
      "Please refer to your billing account for payment details.",
      {
        x: left + 15,
        y: y - 37,
        size: 9,
        font,
        color: textMuted,
      },
    );
  }

  y -= 105;

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

  const footerText = "ServiceDesk · Help Desk & Ticket Management Platform";

  const footerWidth = font.widthOfTextAtSize(footerText, 8);

  page.drawText(footerText, {
    x: right - footerWidth,
    y: y + 14,
    size: 8,
    font,
    color: textMuted,
  });

  page.drawText("This invoice was generated electronically.", {
    x: right - font.widthOfTextAtSize("This invoice was generated electronically.", 8),
    y,
    size: 8,
    font,
    color: textMuted,
  });

  return await pdf.save();
}