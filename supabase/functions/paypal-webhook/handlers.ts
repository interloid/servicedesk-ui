import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateInvoicePdf } from "./pdf.ts";
import { uploadInvoicePdf, getInvoiceSignedUrl } from "./storage.ts";
import { sendInvoiceEmail } from "./email.ts";
import { updateInvoiceStorage } from "./invoice.ts";
import { cancelSubscription, getSubscription } from "./paypal.ts";
import {
  storePayPalPaymentMethod,
  type PayPalSubscriber,
} from "../_shared/paypal-payment-method.ts";

interface WebhookEvent {
  resource: Record<string, unknown> & {
    id?: string;
    billing_info?: { next_billing_time?: string };
    billing_agreement_id?: string;
    seller_receivable_breakdown?: unknown;
    amount?: { total?: string; currency?: string };
    sale_id?: string;
    subscriber?: PayPalSubscriber;
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

function subscriberFetcher(paypalSubscriptionId: string) {
  return async () => {
    const fresh = await getSubscription(paypalSubscriptionId);
    return (fresh.subscriber as PayPalSubscriber | undefined) ?? null;
  };
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

    const { data: updatedSub, error: subError } = await admin
      .from("subscriptions")
      .update({
        plan_id: pendingSwitch.plan_id,
        paypal_subscription_id: subscription.id,
        status: "active",
        seats: plan?.seat_limit ?? 1,
        current_period_end: nextBilling ?? null,
        updated_at: now,
      })
      .eq("tenant_id", pendingSwitch.tenant_id)
      .select("id")
      .maybeSingle();

    if (subError) {
      throw subError;
    }

    await storePayPalPaymentMethod(admin, {
      tenantId: pendingSwitch.tenant_id!,
      subscriptionRowId: updatedSub?.id ?? null,
      paypalSubscriptionId: subscription.id,
      subscriber: subscription.subscriber,
      fetchSubscriber: subscriberFetcher(subscription.id),
      context: "webhook:activated:switch",
    });

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

  await storePayPalPaymentMethod(admin, {
    tenantId: sub.tenant_id,
    subscriptionRowId: sub.id,
    paypalSubscriptionId: subscription.id,
    subscriber: subscription.subscriber,
    fetchSubscriber: subscriberFetcher(subscription.id),
    context: "webhook:activated",
  });

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

  // A scheduled downgrade cancels the agreement it replaces as soon as the
  // buyer approves, to avoid being double-charged when the new agreement
  // starts. That cancellation must not mark the tenant cancelled: they keep
  // the current plan until the replacement goes live at effective_at.
  const { data: supersedingSwitch } = await admin
    .from("subscription_switches")
    .select("id, effective_at")
    .eq("old_paypal_subscription_id", subscription.id)
    .in("status", ["pending", "approved"])
    .maybeSingle();

  if (supersedingSwitch) {
    console.log(
      `Ignoring cancellation of ${subscription.id}: superseded by scheduled switch ${supersedingSwitch.id} (effective ${supersedingSwitch.effective_at}).`,
    );
    return;
  }

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

export async function handleSubscriptionUpdated(event: WebhookEvent) {
  const subscription = event.resource;

  if (!subscription.id) {
    throw new Error("Webhook missing subscription id.");
  }

  const { data: existingSub, error: subError } = await admin
    .from("subscriptions")
    .select("id, tenant_id")
    .eq("paypal_subscription_id", subscription.id)
    .maybeSingle();

  if (subError || !existingSub) {
    console.error("Subscription not found for update:", subError);
    return;
  }

  // A card-funded subscription fires this event when its payment source is
  // patched, so it is the one place a card change shows up. Safe to run for
  // wallet-funded subscriptions too: storePayPalPaymentMethod leaves existing
  // card metadata alone when the event carries no payment source, so an
  // unrelated UPDATED event cannot blank out a card we already hold.
  await storePayPalPaymentMethod(admin, {
    tenantId: existingSub.tenant_id,
    subscriptionRowId: existingSub.id,
    paypalSubscriptionId: subscription.id,
    subscriber: subscription.subscriber,
    fetchSubscriber: subscriberFetcher(subscription.id),
    context: "webhook:updated",
  });

  const updates: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };

  const nextBilling = subscription.billing_info?.next_billing_time;

  if (nextBilling) {
    updates.current_period_end = nextBilling;
  }

  const { error: updateError } = await admin
    .from("subscriptions")
    .update(updates)
    .eq("paypal_subscription_id", subscription.id);

  if (updateError) {
    console.error("Failed to sync subscription on update:", updateError);
  }
}

export async function handleSubscriptionPaymentFailed(event: WebhookEvent) {
  const subscription = event.resource;

  if (!subscription.id) {
    throw new Error("Webhook missing subscription id.");
  }

  const { data: existingSub, error: subError } = await admin
    .from("subscriptions")
    .select("id, tenant_id, paypal_subscription_id")
    .eq("paypal_subscription_id", subscription.id)
    .maybeSingle();

  if (subError || !existingSub) {
    console.error("Subscription not found for payment failure:", subError);
    return;
  }

  await admin
    .from("subscriptions")
    .update({
      status: "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("paypal_subscription_id", subscription.id);

  console.log(
    `Payment failed for subscription ${subscription.id}. Status updated to past_due.`,
  );
}

export async function handlePaymentCompleted(event: WebhookEvent) {
  const payment = event.resource;

  const subscriptionId = payment.billing_agreement_id;

  // PayPal retries deliveries, so the same sale can arrive several times. The
  // invoice is keyed on the PayPal transaction id: if one already exists this
  // sale is fully processed, and re-running would both violate that key and
  // email the customer a second copy.
  const { data: alreadyInvoiced, error: existingInvoiceError } = await admin
    .from("invoices")
    .select("id")
    .eq("paypal_txn_id", payment.id)
    .maybeSingle();

  if (existingInvoiceError) {
    throw existingInvoiceError;
  }

  if (alreadyInvoiced) {
    console.log(
      `Sale ${payment.id} already invoiced as ${alreadyInvoiced.id}; skipping duplicate delivery.`,
    );
    return;
  }

  const { data: subscription, error } = await admin
    .from("subscriptions")
    .select("*, plans(name), tenants(name)")
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

      plan_name:
        (Array.isArray(subscription.plans)
          ? subscription.plans?.[0]?.name
          : subscription.plans?.name) ?? null,

      seats: subscription.seats ?? null,

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
    // A concurrent delivery inserted it between the check above and here. The
    // unique key on paypal_txn_id did its job: nothing left to do.
    if (invoiceError.code === "23505") {
      console.log(
        `Sale ${payment.id} was invoiced concurrently; skipping duplicate delivery.`,
      );
      return;
    }

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

  const plan = Array.isArray(subscription.plans)
    ? subscription.plans?.[0]
    : subscription.plans;
  const tenant = Array.isArray(subscription.tenants)
    ? subscription.tenants?.[0]
    : subscription.tenants;

  // PayPal is the only payment provider, and the currency comes from the
  // PayPal payload (the invoices table does not store either yet).
  const pdf = await generateInvoicePdf(
    {
      ...invoice,
      currency: payment.amount.currency ?? "USD",
      payment_method: "PayPal",
    },
    {
      tenant_name: tenant?.name,
      tenant_id: subscription.tenant_id,
      plan_name: plan?.name,
      seats: subscription.seats,
    },
  );

  const storagePath = await uploadInvoicePdf(
    subscription.tenant_id,
    invoice.id,
    pdf,
  );

  await updateInvoiceStorage(invoice.id, storagePath);

  // Email the invoice to the tenant's billing admin with a short-lived
  // download link. Email failures must not fail payment processing.
  try {
    const { data: billingMember, error: memberError } = await admin
      .from("memberships")
      .select("user_id, users!memberships_user_id_fkey(full_name, email)")
      .eq("tenant_id", subscription.tenant_id)
      .in("role", ["tenant_admin", "billing_admin"])
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberError) {
      throw memberError;
    }

    const customerEmail = billingMember?.users?.email as string | undefined;

    if (customerEmail) {
      const invoiceNumber = invoice.id
        ? `INV-${String(invoice.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`
        : "-";
      const signedUrl = await getInvoiceSignedUrl(storagePath);

      await sendInvoiceEmail({
        customerEmail,
        customerName:
          (billingMember?.users?.full_name as string | undefined) ??
          tenant?.name ??
          "there",
        invoiceNumber,
        amount: Number(invoice.amount ?? payment.amount.total ?? 0),
        currency: payment.amount.currency ?? "USD",
        signedUrl,
      });
    } else {
      console.warn(
        `No billing admin email found for tenant ${subscription.tenant_id}; invoice email skipped.`,
      );
    }
  } catch (emailError) {
    console.error("Failed to send invoice email:", emailError);
  }
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
