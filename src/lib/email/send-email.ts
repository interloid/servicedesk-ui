import "server-only";

import { serverEnv } from "@/config/server-env";

/** Everything interpolated into an email body goes through this. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Email sending is not configured. Set RESEND_API_KEY and FROM_EMAIL.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

/**
 * Sends one email through Resend's REST API -- the same provider the
 * paypal-webhook edge function uses for invoices. No SDK: one POST is all this
 * needs.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const apiKey = serverEnv.RESEND_API_KEY;
  const from = serverEnv.FROM_EMAIL;

  if (!apiKey || !from) {
    throw new EmailNotConfiguredError();
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend rejected the email (${response.status}): ${body}`);
  }
}
