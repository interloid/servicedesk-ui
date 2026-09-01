import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib";

export async function generateInvoicePdf(
  invoice: any,
  subscription: any,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();
  let y = 790;

  const brandDark = rgb(0.06, 0.09, 0.16);
  const brandTeal = rgb(0.06, 0.44, 0.44);
  const textMuted = rgb(0.4, 0.45, 0.55);
  const borderColor = rgb(0.89, 0.91, 0.94);
  const bgLight = rgb(0.97, 0.98, 0.99);

  page.drawText("ServiceDesk", {
    x: 50,
    y,
    size: 24,
    font: bold,
    color: brandDark,
  });

  page.drawText("INVOICE", {
    x: width - 150,
    y,
    size: 20,
    font: bold,
    color: brandTeal,
  });

  y -= 18;

  page.drawText("Help Desk & Ticket Management Platform", {
    x: 50,
    y,
    size: 9,
    font,
    color: textMuted,
  });

  page.drawText(`# ${invoice.id || invoice.invoice_number || "-"}`, {
    x: width - 150,
    y,
    size: 10,
    font,
    color: textMuted,
  });

  y -= 25;

  page.drawLine({
    start: { x: 50, y },
    end: { x: width - 50, y },
    thickness: 1,
    color: borderColor,
  });

  y -= 30;

  const col1X = 50;
  const col2X = 320;
  const metaY = y;

  page.drawText("BILLED TO", {
    x: col1X,
    y: metaY,
    size: 9,
    font: bold,
    color: textMuted,
  });

  page.drawText(subscription.tenant_name || "Tenant Account", {
    x: col1X,
    y: metaY - 16,
    size: 11,
    font: bold,
    color: brandDark,
  });

  page.drawText(`Tenant ID: ${subscription.tenant_id || "-"}`, {
    x: col1X,
    y: metaY - 30,
    size: 9,
    font,
    color: textMuted,
  });

  page.drawText("INVOICE DETAILS", {
    x: col2X,
    y: metaY,
    size: 9,
    font: bold,
    color: textMuted,
  });

  page.drawText(`Date: ${invoice.created_at?.substring(0, 10) ?? "-"}`, {
    x: col2X,
    y: metaY - 16,
    size: 10,
    font,
    color: brandDark,
  });

  page.drawText(`Txn ID: ${invoice.paypal_txn_id || "-"}`, {
    x: col2X,
    y: metaY - 30,
    size: 9,
    font,
    color: textMuted,
  });

  const isPaid = String(invoice.status).toLowerCase() === "paid";
  const badgeBg = isPaid ? rgb(0.86, 0.96, 0.9) : rgb(0.99, 0.89, 0.89);
  const badgeText = isPaid ? rgb(0.09, 0.5, 0.24) : rgb(0.88, 0.17, 0.17);
  const statusLabel = String(invoice.status || "UNPAID").toUpperCase();

  page.drawRectangle({
    x: col2X,
    y: metaY - 55,
    width: 65,
    height: 18,
    color: badgeBg,
  });

  page.drawText(statusLabel, {
    x: col2X + 12,
    y: metaY - 49,
    size: 8,
    font: bold,
    color: badgeText,
  });

  y -= 85;

  const tableTop = y;
  const tableWidth = width - 100;

  page.drawRectangle({
    x: 50,
    y: tableTop - 24,
    width: tableWidth,
    height: 26,
    color: bgLight,
  });

  page.drawText("DESCRIPTION", {
    x: 65,
    y: tableTop - 16,
    size: 9,
    font: bold,
    color: textMuted,
  });
  page.drawText("BILLING PERIOD", {
    x: 270,
    y: tableTop - 16,
    size: 9,
    font: bold,
    color: textMuted,
  });
  page.drawText("AMOUNT", {
    x: width - 110,
    y: tableTop - 16,
    size: 9,
    font: bold,
    color: textMuted,
  });

  y -= 45;

  const periodText = `${invoice.period_start || "-"} to ${invoice.period_end || "-"}`;
  const amountText = `$${Number(invoice.amount || 0).toFixed(2)}`;

  page.drawText(subscription.plan_name || "ServiceDesk Subscription", {
    x: 65,
    y,
    size: 10,
    font: bold,
    color: brandDark,
  });

  page.drawText(periodText, {
    x: 270,
    y,
    size: 9,
    font,
    color: textMuted,
  });

  page.drawText(amountText, {
    x: width - 110,
    y,
    size: 10,
    font: bold,
    color: brandDark,
  });

  y -= 25;

  page.drawLine({
    start: { x: 50, y },
    end: { x: width - 50, y },
    thickness: 1,
    color: borderColor,
  });

  y -= 30;

  const totalBoxX = width - 220;

  page.drawText("Total Paid:", {
    x: totalBoxX,
    y,
    size: 11,
    font,
    color: textMuted,
  });

  page.drawText(amountText, {
    x: totalBoxX + 80,
    y: y - 2,
    size: 16,
    font: bold,
    color: brandTeal,
  });

  y -= 120;

  page.drawLine({
    start: { x: 50, y },
    end: { x: width - 50, y },
    thickness: 1,
    color: borderColor,
  });

  y -= 25;

  page.drawText("Thank you for your business!", {
    x: 50,
    y,
    size: 11,
    font: bold,
    color: brandDark,
  });

  y -= 16;

  page.drawText(
    "If you have any questions regarding this invoice, please contact support@servicedesk.com.",
    {
      x: 50,
      y,
      size: 9,
      font,
      color: textMuted,
    },
  );

  return await pdf.save();
}
