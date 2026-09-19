import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPayPalTokenProvider } from "../_shared/paypal-auth.ts";

const CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID")?.trim();
const CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET")?.trim();
const BASE_URL = Deno.env.get("PAYPAL_BASE_URL")?.trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

if (!CLIENT_ID) {
  throw new Error("PAYPAL_CLIENT_ID is missing");
}

if (!CLIENT_SECRET) {
  throw new Error("PAYPAL_CLIENT_SECRET is missing");
}

if (!BASE_URL) {
  throw new Error("PAYPAL_BASE_URL is missing");
}

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is missing");
}

if (!SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
}

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

const getAccessToken = createPayPalTokenProvider({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  baseUrl: BASE_URL,
});

async function getSubscription(token: string, id: string) {
  const response = await fetch(`${BASE_URL}/v1/billing/subscriptions/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `PayPal GET subscription ${id} failed: ` +
        `${response.status} ${await response.text()}`,
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
      body: JSON.stringify({
        reason: "Superseded by scheduled plan change.",
      }),
    },
  );

  if (!response.ok && response.status !== 422) {
    throw new Error(
      `PayPal cancel ${id} failed: ` +
        `${response.status} ${await response.text()}`,
    );
  }
}

async function backfillInvoices(
  token: string,
  tenantId: string,
  paypalSubscriptionId: string,
  periodEnd: string | null,
): Promise<number> {
  const end = new Date();

  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  const url =
    `${BASE_URL}/v1/billing/subscriptions/` +
    `${paypalSubscriptionId}/transactions` +
    `?start_time=${start.toISOString()}` +
    `&end_time=${end.toISOString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
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
    if (String(txn?.status ?? "").toUpperCase() !== "COMPLETED") {
      continue;
    }

    const gross = txn?.amount_with_breakdown?.gross_amount?.value;

    const grossCurrency =
      txn?.amount_with_breakdown?.gross_amount?.currency_code;

    if (!txn?.id || gross === undefined) {
      continue;
    }

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

        // Self-contained billing context so backfilled invoices
        // render the same way as webhook-created invoices.
        invoice_type: "recurring",
        paypal_subscription_id: paypalSubscriptionId,
        currency: grossCurrency ?? "USD",
        subtotal: Number(gross),
        tax: 0,
        amount_paid: Number(gross),
        balance_due: 0,
        payment_method: "PayPal",
        paid_at: txn.time ?? null,
      },
      {
        onConflict: "paypal_txn_id",
        ignoreDuplicates: true,
      },
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
  paypalSub: Record<string, unknown> | null,
): Promise<number> {
  const now = new Date().toISOString();

  const isFreeSwitch = pendingSwitch.paypal_subscription_id.startsWith("FREE-");
  const billingInfo = paypalSub?.billing_info as
    | {
        next_billing_time?: string;
      }
    | undefined;

  const nextBilling = isFreeSwitch
    ? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
    : (billingInfo?.next_billing_time ?? null);

  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("seat_limit")
    .eq("id", pendingSwitch.plan_id)
    .maybeSingle();

  if (planError) {
    throw planError;
  }

  if (!plan) {
    throw new Error(
      `Plan ${pendingSwitch.plan_id} for switch ` +
        `${pendingSwitch.id} no longer exists.`,
    );
  }

  const { error: subError } = await admin
    .from("subscriptions")
    .update({
      plan_id: pendingSwitch.plan_id,
      paypal_subscription_id: pendingSwitch.paypal_subscription_id,

      status: "active",

      seats: plan.seat_limit ?? 1,

      current_period_end: nextBilling,

      updated_at: now,
    })
    .eq("tenant_id", pendingSwitch.tenant_id);

  if (subError) {
    throw subError;
  }

  const { error: tenantError } = await admin
    .from("tenants")
    .update({
      plan_id: pendingSwitch.plan_id,
      updated_at: now,
    })
    .eq("id", pendingSwitch.tenant_id);

  if (tenantError) {
    throw tenantError;
  }

  if (isRealAgreement(pendingSwitch.old_paypal_subscription_id)) {
    await cancelSubscription(token, pendingSwitch.old_paypal_subscription_id!);
  }

  const { error: appliedError } = await admin
    .from("subscription_switches")
    .update({
      status: "applied",
      updated_at: now,
    })
    .eq("id", pendingSwitch.id);

  if (appliedError) {
    throw appliedError;
  }

  if (!isFreeSwitch) {
    return await backfillInvoices(
      token,
      pendingSwitch.tenant_id,
      pendingSwitch.paypal_subscription_id,
      nextBilling,
    );
  }

  return 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json(
      {
        success: false,
        message: "Method Not Allowed",
      },
      {
        status: 405,
      },
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
        [
          "id",
          "tenant_id",
          "plan_id",
          "paypal_subscription_id",
          "old_paypal_subscription_id",
          "effective_at",
          "status",
        ].join(", "),
      )
      .in("status", ["pending", "approved"])
      .not("effective_at", "is", null)
      .lte("effective_at", new Date().toISOString());

    if (error) {
      throw error;
    }

    const switches: SubscriptionSwitch[] = (dueSwitches ??
      []) as unknown as SubscriptionSwitch[];

    summary.examined = dueSwitches?.length ?? 0;

    // Nothing to reconcile.
    if (summary.examined === 0) {
      return Response.json({
        success: true,
        ...summary,
      });
    }

    const token = await getAccessToken();
    for (const pendingSwitch of switches) {
      try {
        if (pendingSwitch.paypal_subscription_id.startsWith("FREE-")) {
          await applySwitch(token, pendingSwitch, null);

          summary.applied += 1;

          continue;
        }

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

          continue;
        }

        if (status === "CANCELLED" || status === "EXPIRED") {
          const { error: cancelledError } = await admin
            .from("subscription_switches")
            .update({
              status: "cancelled",
              updated_at: new Date().toISOString(),
            })
            .eq("id", pendingSwitch.id);

          if (cancelledError) {
            throw cancelledError;
          }

          summary.abandoned += 1;

          continue;
        }

        summary.notReady += 1;
      } catch (switchError) {
        summary.failed += 1;

        console.error(
          `Reconciling switch ${pendingSwitch.id} failed:`,
          switchError,
        );
      }
    }
    return Response.json({
      success: true,
      ...summary,
    });
  } catch (error) {
    console.error("reconcile-subscriptions failed:", error);

    return Response.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Internal Error",
        ...summary,
      },
      {
        status: 500,
      },
    );
  }
});
