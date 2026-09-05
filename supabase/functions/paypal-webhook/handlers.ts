import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateInvoicePdf } from "./pdf.ts";
import { uploadInvoicePdf, getInvoiceSignedUrl } from "./storage.ts";
import { sendInvoiceEmail } from "./email.ts";
import { updateInvoiceStorage } from "./invoice.ts";
import { cancelSubscription, getSubscription } from "./paypal.ts";

interface PayPalSubscriber {
  payer_id?: string;
  email_address?: string;
  // Present only for card-funded subscriptions. Wallet-funded ones report
  // tenant: "PAYPAL" and omit payment_source entirely.
  tenant?: string;
  payment_source?: {
    card?: {
      brand?: string;
      last_digits?: string;
      expiry?: string;
      bin_details?: {
        bin?: string;
        issuing_bank?: string;
        bin_country_code?: string;
      };
    };
  };
}

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

// Card columns are populated only when PayPal actually reports a card. A
// wallet-approved subscription reports subscriber.tenant "PAYPAL" with no
// payment_source at all -- PayPal does not disclose the card behind a wallet --
// so those rows carry the payer identity instead.
async function storePayPalPaymentMethod(
  tenantId: string,
  subscriptionRowId: string | null,
  paypalSubscriptionId: string,
  subscriber?: PayPalSubscriber,
) {
  // The webhook resource is a point-in-time snapshot and does not always carry
  // subscriber.payment_source. Re-read the subscription so a card-funded one is
  // recorded from the authoritative record, falling back to the event payload
  // when the API call fails.
  let resolved = subscriber;

  try {
    const fresh = await getSubscription(paypalSubscriptionId);
    resolved = (fresh.subscriber as PayPalSubscriber | undefined) ?? subscriber;
  } catch (error) {
    console.error(
      `Falling back to webhook subscriber for ${paypalSubscriptionId}:`,
      error,
    );
  }

  const card = resolved?.payment_source?.card;

  // PayPal formats card.expiry as YYYY-MM.
  let expiryMonth: number | null = null;
  let expiryYear: number | null = null;

  if (card?.expiry) {
    const [year, month] = card.expiry.split("-");
    expiryMonth = parseInt(month, 10) || null;
    expiryYear = parseInt(year, 10) || null;
  }

  const paymentMethodData = {
    tenant_id: tenantId,
    subscription_id: subscriptionRowId,
    paypal_payment_token_id: paypalSubscriptionId,
    paypal_customer_id: resolved?.payer_id ?? null,
    paypal_email: resolved?.email_address ?? null,
    card_brand: card?.brand ?? null,
    card_last4: card?.last_digits ?? null,
    card_expiry_month: expiryMonth,
    card_expiry_year: expiryYear,
    card_bin: card?.bin_details?.bin ?? null,
    card_issuer: card?.bin_details?.issuing_bank ?? null,
    card_country: card?.bin_details?.bin_country_code ?? null,
    payment_source_type: card ? "card" : "paypal",
    is_default: true,
    status: "active",
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await admin
    .from("payment_methods")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .maybeSingle();

  const { error } = existing
    ? await admin
        .from("payment_methods")
        .update(paymentMethodData)
        .eq("id", existing.id)
    : await admin.from("payment_methods").insert(paymentMethodData);

  if (error) {
    console.error("Failed to store PayPal payment method:", error);
    return;
  }

  console.log(
    `Stored ${card ? `card ${card.brand ?? "?"} ****${card.last_digits ?? "?"}` : `PayPal wallet (tenant ${resolved?.tenant ?? "unknown"})`}` +
      ` for subscription ${paypalSubscriptionId}.`,
  );
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

    await storePayPalPaymentMethod(
      pendingSwitch.tenant_id!,
      updatedSub?.id ?? null,
      subscription.id,
      subscription.subscriber,
    );

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

  await storePayPalPaymentMethod(
    sub.tenant_id,
    sub.id,
    subscription.id,
    subscription.subscriber,
  );

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
    .select("id")
    .eq("paypal_subscription_id", subscription.id)
    .maybeSingle();

  if (subError || !existingSub) {
    console.error("Subscription not found for update:", subError);
    return;
  }

  // Payment methods are not written from this webhook: PayPal does not fire
  // BILLING.SUBSCRIPTION.UPDATED for funding-instrument changes, and the
  // subscription resource carries no subscriber.payment_source for
  // wallet-funded subscriptions. The payment_methods table is owned by the
  // update-payment-method function instead.
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
