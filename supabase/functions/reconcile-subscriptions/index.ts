// Scheduled reconciliation for deferred plan changes.
//
// A downgrade is approved by the buyer up front but only becomes effective at
// the end of the paid period, when PayPal starts the new (cheaper) agreement.
// Normally the BILLING.SUBSCRIPTION.ACTIVATED webhook applies it. This job is
// the backstop for a webhook that was missed, retried past its window, or
// arrived while the database was unavailable.
//
// PayPal is the source of truth: nothing is applied here unless PayPal already
// reports the new agreement as ACTIVE. The job is idempotent -- it only selects
// switches that are still pending/approved, and invoice writes collide on the
// unique paypal_txn_id -- so running it twice changes nothing the second time.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID")?.trim();
const CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET")?.trim();
const BASE_URL = Deno.env.get("PAYPAL_BASE_URL")?.trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
const CRON_SECRET = Deno.env.get("CRON_SECRET")?.trim();

if (!CLIENT_ID) throw new Error("PAYPAL_CLIENT_ID is missing");
if (!CLIENT_SECRET) throw new Error("PAYPAL_CLIENT_SECRET is missing");
if (!BASE_URL) throw new Error("PAYPAL_BASE_URL is missing");
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is missing");
if (!SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
if (!CRON_SECRET) throw new Error("CRON_SECRET is missing");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface SubscriptionSwitch {
  id: string;
  tenant_id: string;
  plan_id: string;
  paypal_subscription_id: string;
  old_paypal_subscription_id: string | null;
  effective_at: string | null;
  status: string;
}

function isRealAgreement(id?: string | null): boolean {
  return Boolean(id && !id.startsWith("FREE-"));
}

async function getAccessToken(): Promise<string> {
  const response = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.access_token) {
    throw new Error("Failed to obtain PayPal access token");
  }

  return data.access_token;
}

async function getSubscription(token: string, id: string) {
  const response = await fetch(`${BASE_URL}/v1/billing/subscriptions/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `PayPal GET subscription ${id} failed: ${response.status} ${await response.text()}`,
    );
  }

  return await response.json();
}

async function cancelSubscription(token: string, id: string) {
  const response = await fetch(
    `${BASE_URL}/v1/billing/subscriptions/${id}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Superseded by scheduled plan change." }),
    },
  );

  // 204 on success; 422 typically means it is already cancelled/expired.
  if (!response.ok && response.status !== 422) {
    throw new Error(
      `PayPal cancel ${id} failed: ${response.status} ${await response.text()}`,
    );
  }
}

// Writes an invoice per completed PayPal transaction. invoices.paypal_txn_id is
// UNIQUE, so re-running this backfill never duplicates a row.
async function backfillInvoices(
  token: string,
  tenantId: string,
  paypalSubscriptionId: string,
  periodEnd: string | null,
): Promise<number> {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  const url =
    `${BASE_URL}/v1/billing/subscriptions/${paypalSubscriptionId}/transactions` +
    `?start_time=${start.toISOString()}&end_time=${end.toISOString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    console.error(
      `PayPal transactions for ${paypalSubscriptionId} failed:`,
      response.status,
      await response.text(),
    );
    return 0;
  }

  const { transactions } = await response.json();

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return 0;
  }

  let written = 0;

  for (const txn of transactions) {
    if (String(txn?.status ?? "").toUpperCase() !== "COMPLETED") continue;

    const gross = txn?.amount_with_breakdown?.gross_amount?.value;
    if (!txn?.id || gross === undefined) continue;

    const paidAt = txn.time ? String(txn.time).substring(0, 10) : null;

    const { error } = await admin.from("invoices").upsert(
      {
        tenant_id: tenantId,
        paypal_txn_id: txn.id,
        amount: Number(gross),
        status: "paid",
        period_start: paidAt ?? new Date().toISOString().substring(0, 10),
        period_end: periodEnd
          ? periodEnd.substring(0, 10)
          : new Date().toISOString().substring(0, 10),
      },
      { onConflict: "paypal_txn_id", ignoreDuplicates: true },
    );

    if (error) {
      console.error(`Invoice upsert failed for txn ${txn.id}:`, error);
      continue;
    }

    written += 1;
  }

  return written;
}

async function applySwitch(
  token: string,
  pendingSwitch: SubscriptionSwitch,
  paypalSub: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  const billingInfo = paypalSub.billing_info as
    | { next_billing_time?: string }
    | undefined;
  const nextBilling = billingInfo?.next_billing_time ?? null;

  const { data: plan } = await admin
    .from("plans")
    .select("seat_limit")
    .eq("id", pendingSwitch.plan_id)
    .maybeSingle();

  const { error: subError } = await admin
    .from("subscriptions")
    .update({
      plan_id: pendingSwitch.plan_id,
      paypal_subscription_id: pendingSwitch.paypal_subscription_id,
      status: "active",
      seats: plan?.seat_limit ?? 1,
      current_period_end: nextBilling,
      updated_at: now,
    })
    .eq("tenant_id", pendingSwitch.tenant_id);

  if (subError) throw subError;

  const { error: tenantError } = await admin
    .from("tenants")
    .update({ plan_id: pendingSwitch.plan_id, updated_at: now })
    .eq("id", pendingSwitch.tenant_id);

  if (tenantError) throw tenantError;

  // The old, more expensive agreement is only cancelled once the new one is
  // confirmed live, so a failure here can never leave the tenant unbilled.
  if (isRealAgreement(pendingSwitch.old_paypal_subscription_id)) {
    try {
      await cancelSubscription(token, pendingSwitch.old_paypal_subscription_id!);
    } catch (error) {
      console.error("Failed to cancel superseded agreement:", error);
    }
  }

  const { error: appliedError } = await admin
    .from("subscription_switches")
    .update({ status: "applied", updated_at: now })
    .eq("id", pendingSwitch.id);

  if (appliedError) throw appliedError;

  const invoices = await backfillInvoices(
    token,
    pendingSwitch.tenant_id,
    pendingSwitch.paypal_subscription_id,
    nextBilling,
  );

  return invoices;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json(
      { success: false, message: "Method Not Allowed" },
      { status: 405 },
    );
  }

  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return Response.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  const summary = {
    examined: 0,
    applied: 0,
    notReady: 0,
    abandoned: 0,
    failed: 0,
    invoicesWritten: 0,
  };

  try {
    const { data: dueSwitches, error } = await admin
      .from("subscription_switches")
      .select(
        "id, tenant_id, plan_id, paypal_subscription_id, old_paypal_subscription_id, effective_at, status",
      )
      .in("status", ["pending", "approved"])
      .not("effective_at", "is", null)
      .lte("effective_at", new Date().toISOString());

    if (error) throw error;

    summary.examined = dueSwitches?.length ?? 0;

    if (summary.examined === 0) {
      return Response.json({ success: true, ...summary });
    }

    const token = await getAccessToken();

    for (const pendingSwitch of (dueSwitches ?? []) as SubscriptionSwitch[]) {
      try {
        const paypalSub = await getSubscription(
          token,
          pendingSwitch.paypal_subscription_id,
        );

        const status = String(paypalSub.status ?? "").toUpperCase();

        if (status === "ACTIVE") {
          summary.invoicesWritten += await applySwitch(
            token,
            pendingSwitch,
            paypalSub,
          );
          summary.applied += 1;
          console.log(
            `Applied scheduled switch ${pendingSwitch.id} for tenant ${pendingSwitch.tenant_id}.`,
          );
          continue;
        }

        if (status === "CANCELLED" || status === "EXPIRED") {
          // The buyer never completed, or later killed, the new agreement.
          // Leave the current plan alone and close the switch out.
          await admin
            .from("subscription_switches")
            .update({
              status: "cancelled",
              updated_at: new Date().toISOString(),
            })
            .eq("id", pendingSwitch.id);

          summary.abandoned += 1;
          console.log(
            `Scheduled switch ${pendingSwitch.id} abandoned (PayPal: ${status}).`,
          );
          continue;
        }

        // APPROVAL_PENDING / APPROVED / SUSPENDED: PayPal has not started
        // billing the new agreement yet. Change nothing and look again on the
        // next run.
        summary.notReady += 1;
        console.log(
          `Scheduled switch ${pendingSwitch.id} not ready (PayPal: ${status}).`,
        );
      } catch (switchError) {
        // One tenant failing must not stop the rest of the batch.
        summary.failed += 1;
        console.error(
          `Reconciling switch ${pendingSwitch.id} failed:`,
          switchError,
        );
      }
    }

    return Response.json({ success: true, ...summary });
  } catch (error) {
    console.error("reconcile-subscriptions failed:", error);
    return Response.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Internal Error",
        ...summary,
      },
      { status: 500 },
    );
  }
});
