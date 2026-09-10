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
  id?: string;
  event_type?: string;
  resource: Record<string, unknown> & {
    id?: string;
    create_time?: string;
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

function addMonths(iso: string, months = 1): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  date.setMonth(date.getMonth() + months);

  return date.toISOString();
}

interface InvoiceRecipient {
  email: string;
  name: string;
}

// resolves the invoice email recipients for a tenant:
//   - the first active tenant_admin is always a recipient (mandatory)
//   - the first active billing_admin is added when present (a billing_admin
//     only becomes active after signing in, i.e. confirming their email)
// If the tenant could not activate even one admin, no recipients are returned
// and the caller skips delivery with a warning.
async function resolveInvoiceRecipients(
  tenantId: string,
): Promise<InvoiceRecipient[]> {
  const { data: members, error: membersError } = await admin
    .from("memberships")
    .select("role, users!memberships_user_id_fkey(full_name, email)")
    .eq("tenant_id", tenantId)
    .in("role", ["tenant_admin", "billing_admin"])
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (membersError) {
    throw membersError;
  }

  const recipients: InvoiceRecipient[] = [];
  const seen = new Set<string>();

  for (const role of ["tenant_admin", "billing_admin"]) {
    const member = (members ?? []).find((m) => m.role === role);
    const email = (member?.users?.email as string | undefined)?.trim();
    if (email && !seen.has(email)) {
      seen.add(email);
      recipients.push({
        email,
        name:
          (member?.users?.full_name as string | undefined)?.trim() || "there",
      });
    }
  }

  return recipients;
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

async function applyRevisedUpgrade(
  subscription: { id: string },
  tenantId: string,
  nextBilling?: string | null,
) {
  const now = new Date().toISOString();

  const { data: pendingUpgrade, error: lookupError } = await admin
    .from("subscription_switches")
    .select("*")
    .eq("old_paypal_subscription_id", subscription.id)
    .eq("tenant_id", tenantId)
    .in("status", ["pending", "approved"])
    .is("effective_at", null)
    .maybeSingle();

  if (lookupError) {
    console.error("Revised-upgrade switch lookup failed:", lookupError);
    return;
  }

  if (!pendingUpgrade) {
    return;
  }

  const { data: plan } = await admin
    .from("plans")
    .select("seat_limit")
    .eq("id", pendingUpgrade.plan_id)
    .maybeSingle();

  const { error: subError } = await admin
    .from("subscriptions")
    .update({
      plan_id: pendingUpgrade.plan_id,
      paypal_subscription_id: subscription.id,
      status: "active",
      seats: plan?.seat_limit ?? 1,
      current_period_end: nextBilling ?? null,
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("paypal_subscription_id", subscription.id);

  if (subError) {
    throw subError;
  }

  const { error: tenantError } = await admin
    .from("tenants")
    .update({ plan_id: pendingUpgrade.plan_id, updated_at: now })
    .eq("id", tenantId);

  if (tenantError) {
    throw tenantError;
  }

  const { error: applyError } = await admin
    .from("subscription_switches")
    .update({ status: "applied", updated_at: now })
    .eq("id", pendingUpgrade.id);

  if (applyError) {
    throw applyError;
  }

  console.log(
    `[webhook] applied revised upgrade ${pendingUpgrade.id} via BILLING.SUBSCRIPTION.UPDATED for tenant ${tenantId}.`,
  );
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

  // A one-time upgrade revises the EXISTING subscription onto the new plan.
  // PayPal fires BILLING.SUBSCRIPTION.UPDATED for that change (not ACTIVATED),
  // so this is the webhook that must complete the plan switch. The upgrade
  // switch is keyed on old_paypal_subscription_id (its own paypal_subscription_id
  // keeps the order id), has no effective_at, and is still pending. If the
  // buyer's redirect back to the app ever drops, this applies the upgrade.
  await applyRevisedUpgrade(subscription, existingSub.tenant_id, nextBilling);
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
    .select("id, storage_path")
    .eq("paypal_txn_id", payment.id)
    .maybeSingle();

  if (existingInvoiceError) {
    throw existingInvoiceError;
  }

  // Only short-circuit when the delivery actually finished: if the PDF upload
  // or email failed on a previous attempt the row exists but its storage_path
  // is still null, and skipping here would leave the invoice without a PDF or
  // an email for good. That case falls through and re-publishes the same row.
  if (alreadyInvoiced?.storage_path) {
    console.log(
      `Sale ${payment.id} already invoiced as ${alreadyInvoiced.id}; skipping duplicate delivery.`,
    );
    return;
  }

  const { data: subscription, error } = await admin
    .from("subscriptions")
    .select("*, plans(name, price_month), tenants(name)")
    .eq("paypal_subscription_id", subscriptionId)
    .single();

  if (error || !subscription) {
    throw new Error("Subscription not found.");
  }

  const plan = Array.isArray(subscription.plans)
    ? subscription.plans?.[0]
    : subscription.plans;
  const tenant = Array.isArray(subscription.tenants)
    ? subscription.tenants?.[0]
    : subscription.tenants;

  const amount = Number(payment.amount?.total ?? 0);
  const currency = payment.amount?.currency ?? "USD";
  const paidAt = payment.create_time || new Date().toISOString();
  const periodStart = (paidAt || "").substring(0, 10);
  const periodEnd = subscription.current_period_end
    ? subscription.current_period_end.substring(0, 10)
    : addMonths(paidAt).substring(0, 10);

  const nextBillingDate = subscription.current_period_end
    ? subscription.current_period_end
    : addMonths(paidAt);
  const nextBillingAmount = Number(plan?.price_month ?? 0);

  // Billing email for the PDF "Bill To" block: the tenant's default payment
  // method reports the email PayPal holds for the agreement.
  const { data: billingMethod } = await admin
    .from("payment_methods")
    .select("paypal_email")
    .eq("tenant_id", subscription.tenant_id)
    .eq("is_default", true)
    .maybeSingle();
  const billingEmail = billingMethod?.paypal_email || undefined;

  // A denied attempt recorded a FAILED invoice for this subscription; the
  // successful retry finalizes that same line instead of creating a duplicate
  // and counts as the "later collected" flip, per the payment lifecycle.
  const { data: failedInvoice } = await admin
    .from("invoices")
    .select("id")
    .eq("subscription_id", subscription.id)
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let insertedInvoice: { id: string } | null = null;

  if (alreadyInvoiced && !alreadyInvoiced.storage_path) {
    // Re-publishing a partially finished delivery: the row is already there, so
    // skip the flip/insert and just regenerate the PDF + email below.
    insertedInvoice = { id: alreadyInvoiced.id };
  } else if (failedInvoice) {
    const { error: flipError } = await admin
      .from("invoices")
      .update({
        paypal_txn_id: payment.id,
        amount,
        currency,
        status: "paid",
        subtotal: amount,
        tax: 0,
        amount_paid: amount,
        balance_due: 0,
        payment_method: "PayPal",
        paid_at: paidAt,
        period_start: periodStart,
        period_end: periodEnd,
        plan_name: plan?.name ?? null,
        seats: subscription.seats ?? null,
        next_billing_date: nextBillingDate,
        next_billing_amount: nextBillingAmount,
        billing_email: billingEmail ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", failedInvoice.id);

    if (flipError) {
      throw flipError;
    }

    console.log(
      `[webhook] finalized previously failed invoice ${failedInvoice.id} for sale ${payment.id}.`,
    );

    insertedInvoice = { id: failedInvoice.id };
  } else {
    const { data, error: invoiceError } = await admin
      .from("invoices")
      .insert({
        tenant_id: subscription.tenant_id,

        paypal_txn_id: payment.id,

        paypal_event_id: event.id ?? null,

        amount,
        currency,
        status: "paid",

        invoice_type: "recurring",
        subscription_id: subscription.id,
        paypal_subscription_id:
          subscription.paypal_subscription_id ?? subscriptionId,
        subtotal: amount,
        tax: 0,
        amount_paid: amount,
        balance_due: 0,
        payment_method: "PayPal",
        paid_at: paidAt,
        billing_email: billingEmail ?? null,

        plan_name: plan?.name ?? null,

        seats: subscription.seats ?? null,

        period_start: periodStart,

        period_end: periodEnd,

        next_billing_date: nextBillingDate,
        next_billing_amount: nextBillingAmount,
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

    insertedInvoice = data;
  }

  const { data: invoice, error: fetchError } = await admin
    .from("invoices")
    .select("*")
    .eq("id", insertedInvoice.id)
    .single();

  if (fetchError) {
    throw fetchError;
  }

  // PayPal is the only payment provider; currency comes from the payload.
  const pdf = await generateInvoicePdf(
    {
      ...invoice,
      currency,
      payment_method: "PayPal",
    },
    {
      tenant_name: tenant?.name,
      tenant_id: subscription.tenant_id,
      plan_name: plan?.name,
      seats: subscription.seats,
      tenant_email: billingEmail,
      next_billing_date: nextBillingDate,
      next_billing_amount: nextBillingAmount,
    },
  );

  const storagePath = await uploadInvoicePdf(
    subscription.tenant_id,
    invoice.id,
    pdf,
  );

  await updateInvoiceStorage(invoice.id, storagePath);

  // Email the invoice to the tenant admin (mandatory) and, when one exists,
  // the verified+active billing admin, with a short-lived download link. Email
  // failures must not fail payment processing.
  try {
    const recipients = await resolveInvoiceRecipients(subscription.tenant_id);

    if (recipients.length === 0) {
      console.warn(
        `No active tenant/billing admin found for tenant ${subscription.tenant_id}; invoice email skipped.`,
      );
    } else {
      const invoiceNumber =
        invoice.invoice_number ||
        (invoice.id
          ? `INV-${String(invoice.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`
          : "-");
      const signedUrl = await getInvoiceSignedUrl(storagePath);

      for (const recipient of recipients) {
        await sendInvoiceEmail({
          customerEmail: recipient.email,
          customerName: recipient.name ?? tenant?.name ?? "there",
          invoiceNumber,
          amount: Number(invoice.amount ?? amount ?? 0),
          currency,
          signedUrl,
        });
      }
    }
  } catch (emailError) {
    console.error("Failed to send invoice email:", emailError);
  }
}

// Attach a PDF + email to the invoice row recorded by `capture-order` for a
// one-time UPGRADE payment. In the sandbox the order's webhook event is
// PAYMENT.CAPTURE.COMPLETED (resource = the capture), while real environments
// can also deliver CHECKOUT.ORDER.COMPLETED (resource = the order). Both are
// routed through this handler, and the invoice is found by its UNIQUE
// paypal_txn_id so no custom_id plumbing is needed.
export async function handleOrderCompleted(event: WebhookEvent) {
  const resource = event.resource as Record<string, unknown> & {
    id?: string;
    custom_id?: string;
    status?: string;
    amount?: { value?: string; currency?: string };
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{
          id?: string;
          status?: string;
          amount?: { value?: string; currency?: string };
        }>;
      };
    }>;
  };

  let txnId: string;
  let currency = "USD";
  let eventLabel = "order";
  let capturedAmount: number | null = null;

  if (event.event_type === "CHECKOUT.ORDER.COMPLETED") {
    const capture = resource.purchase_units?.[0]?.payments?.captures?.[0];
    if (!resource.id || !capture?.id || capture.status !== "COMPLETED") {
      return;
    }
    txnId = capture.id;
    currency = capture.amount?.currency ?? "USD";
    capturedAmount = Number(capture.amount?.value ?? NaN);
    eventLabel = resource.id;
  } else {
    // PAYMENT.CAPTURE.COMPLETED: the resource is the capture itself.
    if (String(resource.status ?? "").toUpperCase() !== "COMPLETED") {
      return;
    }
    if (!resource.id) {
      throw new Error("Webhook missing capture id.");
    }
    txnId = resource.id;
    currency = resource.amount?.currency ?? "USD";
    capturedAmount = Number(resource.amount?.value ?? NaN);
    eventLabel = txnId;
  }

  const { data: invoiceRow, error: invoiceError } = await admin
    .from("invoices")
    .select("*")
    .eq("paypal_txn_id", txnId)
    .maybeSingle();

  if (invoiceError) {
    throw invoiceError;
  }

  let invoice = invoiceRow;

  if (invoice?.storage_path) {
    return;
  }

  // The one-time upgrade invoice row is created by `capture-order` (keyed on
  // the PayPal transaction id). If no row exists here, this is a stray event
  // with nothing to finalize — skip rather than invent an invoice.
  if (!invoice) {
    console.log(
      `[webhook] no invoice row for txn ${txnId} (${eventLabel}); skipping (one-time upgrade capture).`,
    );
    return;
  }

  const tenantId = invoice.tenant_id;

  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  // For the "Upcoming billing" panel, read the tenant's live subscription: the
  // next recurring charge date and the target plan's monthly rate. Never part
  // of the upgrade invoice totals.
  const { data: tenantSub } = await admin
    .from("subscriptions")
    .select(
      "paypal_subscription_id, current_period_end, seats, plan_id, plans(name, price_month)",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const tenantPlan = Array.isArray(tenantSub?.plans)
    ? tenantSub?.plans?.[0]
    : tenantSub?.plans;

  // For the "Upcoming billing" panel, prefer the values recorded on the row
  // itself (set at capture time from the TARGET plan). The live subscription
  // row lags an upgrade by a full switch cycle, so extrapolating from it would
  // show yesterday's rate on an invoice for today's upgrade.
  const nextBillingAmount = Number(
    invoice.next_billing_amount ?? tenantPlan?.price_month ?? 0,
  );
  const nextBillingDate =
    invoice.next_billing_date ??
    tenantSub?.current_period_end ??
    addMonths(new Date().toISOString());

  const { data: billingMethod } = await admin
    .from("payment_methods")
    .select("paypal_email")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .maybeSingle();
  const billingEmail =
    invoice.billing_email || billingMethod?.paypal_email || undefined;

  const pdf = await generateInvoicePdf(
    {
      ...invoice,
      currency,
      payment_method: "PayPal",
    },
    {
      tenant_name: (tenant as { name?: string } | null)?.name,
      tenant_id: tenantId,
      plan_name: invoice.plan_name,
      seats: invoice.seats,
      tenant_email: billingEmail,
      next_billing_date: nextBillingDate,
      next_billing_amount: nextBillingAmount,
    },
  );

  const storagePath = await uploadInvoicePdf(tenantId, invoice.id, pdf);

  await updateInvoiceStorage(invoice.id, storagePath);

  console.log(
    `[webhook] generated invoice PDF for txn ${txnId} (${eventLabel}) tenant ${tenantId}.`,
  );

  // Email the upgrade invoice to the tenant admin (mandatory) and, when one
  // exists, the verified+active billing admin, with a short-lived download link.
  try {
    const recipients = await resolveInvoiceRecipients(tenantId);

    if (recipients.length === 0) {
      console.warn(
        `No active tenant/billing admin found for tenant ${tenantId}; invoice email skipped.`,
      );
    } else {
      const invoiceNumber =
        invoice.invoice_number ||
        (invoice.id
          ? `INV-${String(invoice.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`
          : "-");
      const signedUrl = await getInvoiceSignedUrl(storagePath);

      for (const recipient of recipients) {
        await sendInvoiceEmail({
          customerEmail: recipient.email,
          customerName: recipient.name ?? tenant?.name ?? "there",
          invoiceNumber,
          amount: Number(invoice.amount ?? 0),
          currency,
          signedUrl,
        });
      }
    }
  } catch (emailError) {
    console.error("Failed to send upgrade invoice email:", emailError);
  }
}

export async function handlePaymentDenied(event: WebhookEvent) {
  const payment = event.resource;

  // Mark the subscription past-due (existing behaviour) so the billing
  // dashboard surfaces the collection problem immediately.
  await admin
    .from("subscriptions")
    .update({
      status: "past_due",

      updated_at: new Date().toISOString(),
    })
    .eq("paypal_subscription_id", payment.billing_agreement_id);

  // Also record the failed collection as a FAILED invoice (never PAID). A
  // denied payment may not carry full sale details, so the monthly plan rate
  // is used for the amount. The event id is stored for idempotency. When the
  // money later lands, handlePaymentCompleted flips this line to PAID.
  const { data: subscription } = await admin
    .from("subscriptions")
    .select(
      "id, tenant_id, paypal_subscription_id, current_period_end, seats, plans(name, price_month)",
    )
    .eq("paypal_subscription_id", payment.billing_agreement_id)
    .maybeSingle();

  if (subscription) {
    const plan = Array.isArray(subscription.plans)
      ? subscription.plans?.[0]
      : subscription.plans;
    const now = new Date().toISOString();
    const amount = Number(plan?.price_month ?? 0);

    // The FAILED row's natural key (per billing cycle) beats the partial unique
    // index on paypal_event_id, which only guards when event.id is actually
    // set. PayPal can redeliver a SALE.DENIED or send another denial for the
    // same cycle; never stack a second FAILED line for the same period.
    const { data: existingFailed } = await admin
      .from("invoices")
      .select("id")
      .eq("subscription_id", subscription.id)
      .eq("status", "failed")
      .eq("period_start", now.substring(0, 10))
      .maybeSingle();

    if (existingFailed) {
      console.log(
        `Denied payment for cycle ${now.substring(0, 10)} already recorded as failed invoice ${existingFailed.id}; skipping duplicate.`,
      );
      return;
    }

    const { error: invError } = await admin.from("invoices").insert({
      tenant_id: subscription.tenant_id,
      paypal_txn_id: payment.id ?? null,
      paypal_event_id: event.id ?? null,
      amount,
      currency: "USD",
      status: "failed",
      invoice_type: "recurring",
      subscription_id: subscription.id,
      paypal_subscription_id:
        subscription.paypal_subscription_id ?? payment.billing_agreement_id,
      subtotal: amount,
      tax: 0,
      amount_paid: 0,
      balance_due: amount,
      payment_method: "PayPal",
      plan_name: plan?.name ?? null,
      seats: subscription.seats ?? null,
      period_start: now.substring(0, 10),
      period_end: subscription.current_period_end
        ? subscription.current_period_end.substring(0, 10)
        : addMonths(now).substring(0, 10),
    });

    if (invError && invError.code !== "23505") {
      console.error("Failed to record denied payment as an invoice:", invError);
    } else if (invError && invError.code === "23505") {
      console.log(
        `Denied payment event ${event.id} already recorded; skipping duplicate.`,
      );
    }
  }
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
