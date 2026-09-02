import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateInvoicePdf } from "./pdf.ts";
import { uploadInvoicePdf } from "./storage.ts";
import { updateInvoiceStorage } from "./invoice.ts";
import { cancelSubscription } from "./paypal.ts";

interface WebhookEvent {
  resource: {
    id?: string;
    billing_info?: { next_billing_time?: string };
    billing_agreement_id?: string;
    seller_receivable_breakdown?: unknown;
    amount?: { total?: string };
    sale_id?: string;
  };
}

interface SubscriptionSwitch {
  id?: string;
  tenant_id?: string;
  plan_id?: string;
  paypal_subscription_id?: string;
  old_paypal_subscription_id?: string | null;
  old_plan_id?: string | null;
  old_status?: string | null;
  old_seats?: number | null;
  old_current_period_end?: string | null;
  status?: string;
}

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function isRealAgreement(id?: string | null): boolean {
  return Boolean(id && !id.startsWith("FREE-"));
}

async function restoreSubscriptionFromSwitch(
  pendingSwitch: SubscriptionSwitch,
) {
  const now = new Date().toISOString();

  const { data: tenant, error: tenantLookupError } = await admin
    .from("tenants")
    .select("plan_id")
    .eq("id", pendingSwitch.tenant_id)
    .single();

  if (tenantLookupError) {
    throw tenantLookupError;
  }

  const restorePlanId = pendingSwitch.old_plan_id ?? tenant?.plan_id;

  if (!restorePlanId) {
    throw new Error("Cannot restore subscription: missing plan.");
  }

  const { error: subError } = await admin
    .from("subscriptions")
    .update({
      plan_id: restorePlanId,
      paypal_subscription_id:
        pendingSwitch.old_paypal_subscription_id ??
        `FREE-${pendingSwitch.tenant_id}`,
      status: pendingSwitch.old_status ?? "active",
      seats: pendingSwitch.old_seats ?? 1,
      current_period_end: pendingSwitch.old_current_period_end ?? null,
      updated_at: now,
    })
    .eq("tenant_id", pendingSwitch.tenant_id);

  if (subError) {
    throw subError;
  }

  const { error: tenantError } = await admin
    .from("tenants")
    .update({ plan_id: restorePlanId, updated_at: now })
    .eq("id", pendingSwitch.tenant_id);

  if (tenantError) {
    throw tenantError;
  }

  const { error: switchError } = await admin
    .from("subscription_switches")
    .update({ status: "cancelled", updated_at: now })
    .eq("id", pendingSwitch.id);

  if (switchError) {
    throw switchError;
  }
}

export async function handleSubscriptionActivated(event: WebhookEvent) {
  const subscription = event.resource;

  if (!subscription.id) {
    throw new Error("Webhook missing subscription id.");
  }

  const nextBilling = subscription.billing_info?.next_billing_time;
  const now = new Date().toISOString();

  const { data: pendingSwitch, error: switchError } = await admin
    .from("subscription_switches")
    .select("*")
    .eq("paypal_subscription_id", subscription.id)
    .in("status", ["pending", "approved"])
    .maybeSingle();

  if (switchError) {
    throw switchError;
  }

  if (pendingSwitch) {
    const { data: plan } = await admin
      .from("plans")
      .select("seat_limit")
      .eq("id", pendingSwitch.plan_id)
      .maybeSingle();

    const { error: subError } = await admin
      .from("subscriptions")
      .update({
        plan_id: pendingSwitch.plan_id,
        paypal_subscription_id: subscription.id,
        status: "active",
        seats: plan?.seat_limit ?? 1,
        current_period_end: nextBilling ?? null,
        updated_at: now,
      })
      .eq("tenant_id", pendingSwitch.tenant_id);

    if (subError) {
      throw subError;
    }

    const { error: tenantError } = await admin
      .from("tenants")
      .update({ plan_id: pendingSwitch.plan_id, updated_at: now })
      .eq("id", pendingSwitch.tenant_id);

    if (tenantError) {
      throw tenantError;
    }

    if (isRealAgreement(pendingSwitch.old_paypal_subscription_id)) {
      try {
        await cancelSubscription(pendingSwitch.old_paypal_subscription_id!);
      } catch (cancelError) {
        console.error(
          "Failed to cancel previous agreement on activation:",
          cancelError,
        );
      }
    }

    const { error: applyError } = await admin
      .from("subscription_switches")
      .update({ status: "applied", updated_at: now })
      .eq("id", pendingSwitch.id);

    if (applyError) {
      throw applyError;
    }

    return;
  }

  const { data, error } = await admin
    .from("subscriptions")
    .update({
      status: "active",

      current_period_end: nextBilling,

      updated_at: now,
    })
    .eq("paypal_subscription_id", subscription.id)
    .select();

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error(`Subscription ${subscription.id} not found in database.`);
  }

  const sub = data[0];

  if (sub.plan_id) {
    const { error: tenantError } = await admin
      .from("tenants")
      .update({ plan_id: sub.plan_id, updated_at: now })
      .eq("id", sub.tenant_id);

    if (tenantError) {
      throw tenantError;
    }
  }
}

export async function handleSubscriptionCancelled(event: WebhookEvent) {
  const subscription = event.resource;

  const { data: rows } = await admin
    .from("subscriptions")
    .select("id")
    .eq("paypal_subscription_id", subscription.id);

  if (rows && rows.length > 0) {
    const { error: updateError } = await admin
      .from("subscriptions")
      .update({
        status: "cancelled",

        cancelled_at: new Date().toISOString(),

        updated_at: new Date().toISOString(),
      })
      .eq("paypal_subscription_id", subscription.id);

    if (updateError) {
      throw updateError;
    }

    const { data: pendingSwitch, error: switchError } = await admin
      .from("subscription_switches")
      .select("*")
      .eq("paypal_subscription_id", subscription.id)
      .in("status", ["pending", "approved"])
      .maybeSingle();

    if (switchError) {
      throw switchError;
    }

    if (pendingSwitch) {
      await restoreSubscriptionFromSwitch(pendingSwitch);
    }

    return;
  }

  const { data: supersededSwitch } = await admin
    .from("subscription_switches")
    .select("id, status")
    .eq("old_paypal_subscription_id", subscription.id)
    .maybeSingle();

  if (supersededSwitch) {
    console.log(
      `Ignoring cancellation of superseded agreement ${subscription.id} (switch ${supersededSwitch.status}).`,
    );
  }
}

export async function handleSubscriptionSuspended(event: WebhookEvent) {
  const subscription = event.resource;

  await admin
    .from("subscriptions")
    .update({
      status: "past_due",

      updated_at: new Date().toISOString(),
    })
    .eq("paypal_subscription_id", subscription.id);
}

export async function handlePaymentCompleted(event: WebhookEvent) {
  const payment = event.resource;

  const subscriptionId = payment.billing_agreement_id;

  const { data: subscription, error } = await admin
    .from("subscriptions")
    .select("*")
    .eq("paypal_subscription_id", subscriptionId)
    .single();

  if (error || !subscription) {
    throw new Error("Subscription not found.");
  }

  const { data: insertedInvoice, error: invoiceError } = await admin
    .from("invoices")
    .insert({
      tenant_id: subscription.tenant_id,

      paypal_txn_id: payment.id,

      amount: Number(payment.amount.total),

      status: "paid",

      period_start: subscription.created_at
        ? subscription.created_at.substring(0, 10)
        : new Date().toISOString().substring(0, 10),

      period_end: subscription.current_period_end
        ? subscription.current_period_end.substring(0, 10)
        : (() => {
            const date = new Date();
            date.setMonth(date.getMonth() + 1);
            return date.toISOString().substring(0, 10);
          })(),
    })
    .select()
    .single();

  if (invoiceError) {
    throw invoiceError;
  }
  const { data: invoice, error: fetchError } = await admin
    .from("invoices")
    .select("*")
    .eq("id", insertedInvoice.id)
    .single();

  if (fetchError) {
    throw fetchError;
  }

  const pdf = await generateInvoicePdf(invoice, subscription);

  const storagePath = await uploadInvoicePdf(
    subscription.tenant_id,
    invoice.id,
    pdf,
  );

  await updateInvoiceStorage(invoice.id, storagePath);
}

export async function handlePaymentDenied(event: WebhookEvent) {
  const payment = event.resource;

  await admin
    .from("subscriptions")
    .update({
      status: "past_due",

      updated_at: new Date().toISOString(),
    })
    .eq("paypal_subscription_id", payment.billing_agreement_id);
}

export async function handlePaymentRefunded(event: WebhookEvent) {
  const payment = event.resource;

  await admin
    .from("invoices")
    .update({
      status: "refunded",
    })
    .eq("paypal_txn_id", payment.sale_id);
}
