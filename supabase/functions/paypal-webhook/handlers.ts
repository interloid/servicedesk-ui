import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createInvoice } from "./invoice.ts";
import { generateInvoicePdf } from "./pdf.ts";
import { uploadInvoicePdf } from "./storage.ts";
import { updateInvoiceStorage } from "./invoice.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export async function handleSubscriptionActivated(event: any) {
  const subscription = event.resource;
  const nextBilling = subscription.billing_info?.next_billing_time;

  const { data, error } = await admin
    .from("subscriptions")
    .update({
      status: "active",

      current_period_end: nextBilling,

      updated_at: new Date().toISOString(),
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
      .update({ plan_id: sub.plan_id, updated_at: new Date().toISOString() })
      .eq("id", sub.tenant_id);

    if (tenantError) {
      throw tenantError;
    }
  }
}

export async function handleSubscriptionCancelled(event: any) {
  const subscription = event.resource;

  await admin
    .from("subscriptions")
    .update({
      status: "cancelled",

      cancelled_at: new Date().toISOString(),

      updated_at: new Date().toISOString(),
    })
    .eq("paypal_subscription_id", subscription.id);
}

export async function handleSubscriptionSuspended(event: any) {
  const subscription = event.resource;

  await admin
    .from("subscriptions")
    .update({
      status: "past_due",

      updated_at: new Date().toISOString(),
    })
    .eq("paypal_subscription_id", subscription.id);
}

export async function handlePaymentCompleted(event: any) {
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

export async function handlePaymentDenied(event: any) {
  const payment = event.resource;

  await admin
    .from("subscriptions")
    .update({
      status: "past_due",

      updated_at: new Date().toISOString(),
    })
    .eq("paypal_subscription_id", payment.billing_agreement_id);
}

export async function handlePaymentRefunded(event: any) {
  const payment = event.resource;

  await admin
    .from("invoices")
    .update({
      status: "refunded",
    })
    .eq("paypal_txn_id", payment.sale_id);
}
