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
        <div style="font-family:Arial,sans-serif">

            <h2>ServiceDesk</h2>

            <p>Hi ${customerName},</p>

            <p>Your payment has been received successfully.</p>

            <table cellpadding="8">

                <tr>

                    <td><b>Invoice</b></td>

                    <td>${invoiceNumber}</td>

                </tr>

                <tr>

                    <td><b>Amount</b></td>

                    <td>${currency} ${amount}</td>

                </tr>

            </table>

            <p>

                <a href="${signedUrl}">

                    Download Invoice

                </a>

            </p>

            <br>

            <p>

                Thank you for choosing ServiceDesk.

            </p>

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
