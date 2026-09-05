const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL")!;

export async function sendInvoiceEmail({
  customerEmail,
  customerName,
  invoiceNumber,
  amount,
  currency,
  signedUrl,
}: {
  customerEmail: string;
  customerName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  signedUrl: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,

      to: [customerEmail],

      subject: `Invoice ${invoiceNumber}`,

      html: `
        <div style="max-width:600px;margin:auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-family:Arial,sans-serif;background:white">
          <div style="padding:28px 32px;border-bottom:1px solid #e5e7eb">
            <strong style="font-size:20px;color:#111827">ServiceDesk</strong>
            <span style="font-size:13px;color:#6b7280">Help Desk &amp; Ticket Management Platform</span>
          </div>
          <div style="padding:32px">
            <span style="background:#dcfce7;color:#166534;padding:7px 12px;border-radius:5px;font-size:12px;font-weight:bold">PAYMENT SUCCESSFUL</span>
            <h2 style="font-size:22px;color:#111827;margin:18px 0 6px">Payment received successfully</h2>
            <p style="color:#374151;font-size:14px;line-height:1.6">Hi ${customerName},</p>
            <p style="color:#374151;font-size:14px;line-height:1.6">Thank you for your payment. Your invoice has been generated successfully and is available below.</p>
            <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:24px 0">
              <div style="padding:14px 18px;background:#f8fafc;font-weight:bold;font-size:13px;color:#111827">INVOICE DETAILS</div>
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr>
                  <td style="padding:14px 18px;color:#6b7280;border-top:1px solid #e5e7eb">Invoice</td>
                  <td style="padding:14px 18px;color:#111827;font-weight:bold;border-top:1px solid #e5e7eb;text-align:right">${invoiceNumber}</td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;color:#6b7280;border-top:1px solid #e5e7eb">Amount Paid</td>
                  <td style="padding:14px 18px;color:#111827;font-weight:bold;border-top:1px solid #e5e7eb;text-align:right">${currency} ${Number(amount).toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;color:#6b7280;border-top:1px solid #e5e7eb">Payment Status</td>
                  <td style="padding:14px 18px;color:#111827;font-weight:bold;border-top:1px solid #e5e7eb;text-align:right">Paid</td>
                </tr>
              </table>
            </div>
            <div style="text-align:center;margin:30px">
              <a href="${signedUrl}" style="display:inline-block;background:#0e7adf;color:#ffffff;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">Download Invoice</a>
            </div>
            <p style="font-size:12px;color:#6b7280;text-align:center">If the button above does not work, you can access your invoice from your ServiceDesk billing account.</p>
          </div>
          <div style="padding:22px 32px;background:#f8fafc;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#374151">
            Thank you for choosing ServiceDesk.<br>
            Questions about your invoice?
            <span style="color:#0e7adf">support@servicedesk.com</span>
          </div>
        </div>
        `,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}
