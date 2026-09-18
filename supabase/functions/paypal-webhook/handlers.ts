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

// Moves a switch from pending/approved to applied in one conditional update,
// BEFORE any of its effects are applied. PayPal redelivers events and edge
// functions run deliveries concurrently; only the delivery that wins this
// update applies the switch, so the superseded agreement is cancelled once.
// Returns false when another delivery already claimed it.
async function claimSwitch(switchId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("subscription_switches")
    .update({ status: "applied", updated_at: new Date().toISOString() })
    .eq("id", switchId)
    .in("status", ["pending", "approved"])
    .select("id");

  if (error) {
    throw error;
  }

  return (data?.length ?? 0) > 0;
}

// Undoes claimSwitch after the apply failed, so PayPal's redelivery of the
// event finds the switch open again and retries it.
async function releaseSwitch(switchId: string, previousStatus?: string) {
  const { error } = await admin
    .from("subscription_switches")
    .update({
      status: previousStatus ?? "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", switchId)
    .eq("status", "applied");

  if (error) {
    console.error(
      `[webhook] could not release switch ${switchId} after a failed apply:`,
      error,
    );
  }
}

// Emails an invoice at most once.
//
// email_sent_at is claimed with a conditional update right before sending, so
// concurrent or repeated deliveries of the same event cannot mail the same
// invoice twice. If the email reaches none of the recipients, the claim is
// released and the error rethrown: the webhook fails, PayPal redelivers the
// event, and the redelivery retries the email instead of skipping it. When at
// least one recipient got it, the claim stands, so nobody is emailed twice.
async function emailInvoiceOnce({
  invoice,
  tenantId,
  storagePath,
  amount,
  currency,
}: {
  invoice: { id: string; invoice_number?: string | null };
  tenantId: string;
  storagePath: string;
  amount: number;
  currency: string;
}) {
  const recipients = await resolveInvoiceRecipients(tenantId);

  if (recipients.length === 0) {
    console.warn(
      `No active tenant/billing admin found for tenant ${tenantId}; invoice email skipped.`,
    );
    return;
  }

  const { data: claimed, error: claimError } = await admin
    .from("invoices")
    .update({ email_sent_at: new Date().toISOString() })
    .eq("id", invoice.id)
    .is("email_sent_at", null)
    .select("id");

  if (claimError) {
    throw claimError;
  }

  // Another delivery already sent, or is sending, this invoice.
  if (!claimed || claimed.length === 0) {
    return;
  }

  const invoiceNumber =
    invoice.invoice_number ||
    `INV-${String(invoice.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`;

  let delivered = 0;
  let lastError: unknown = null;

  try {
    const signedUrl = await getInvoiceSignedUrl(storagePath);

    for (const recipient of recipients) {
      try {
        await sendInvoiceEmail({
          customerEmail: recipient.email,
          customerName: recipient.name,
          invoiceNumber,
          amount,
          currency,
          signedUrl,
        });
        delivered += 1;
      } catch (error) {
        lastError = error;
        console.error(`Failed to send invoice ${invoice.id} email:`, error);
      }
    }
  } catch (error) {
    lastError = error;
    console.error(`Failed to prepare invoice ${invoice.id} email:`, error);
  }

  if (delivered === 0 && lastError) {
    const { error: releaseError } = await admin
      .from("invoices")
      .update({ email_sent_at: null })
      .eq("id", invoice.id);

    if (releaseError) {
      console.error(
        `Could not release invoice ${invoice.id} email claim:`,
        releaseError,
      );
    }

    throw lastError;
  }
}

function subscriberFetcher(paypalSubscriptionId: string) {
  return async () => {
    const fresh = await getSubscription(paypalSubscriptionId);
    // Raw JSON; storePayPalPaymentMethod validates its shape.
    return fresh.subscriber ?? null;
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

  // A scheduled downgrade (Business -> Pro) is created with start_time at the
  // end of the paid period, and PayPal reports it ACTIVE as soon as the buyer
  // approves -- long before it bills. Applying it here would drop the tenant
  // to the cheaper plan today. Instead only the agreement id is saved and the
  // superseded agreement retired (in case the buyer never reached the success
  // page); the reconcile job applies the plan at effective_at.
  if (
    pendingSwitch?.effective_at &&
    new Date(pendingSwitch.effective_at).getTime() > Date.now()
  ) {
    const { error: approveError } = await admin
      .from("subscription_switches")
      .update({ status: "approved", updated_at: now })
      .eq("id", pendingSwitch.id)
      .in("status", ["pending", "approved"]);

    if (approveError) {
      throw approveError;
    }

    const { error: repointError } = await admin
      .from("subscriptions")
      .update({ paypal_subscription_id: subscription.id, updated_at: now })
      .eq("tenant_id", pendingSwitch.tenant_id);

    if (repointError) {
      throw repointError;
    }

    if (isRealAgreement(pendingSwitch.old_paypal_subscription_id)) {
      try {
        // The activate action usually cancelled it already; skip the call
        // then rather than logging a failed second cancel.
        const oldAgreement = await getSubscription(
          pendingSwitch.old_paypal_subscription_id!,
        );
        const oldStatus = String(oldAgreement.status ?? "").toUpperCase();

        if (["ACTIVE", "APPROVAL_PENDING", "SUSPENDED"].includes(oldStatus)) {
          await cancelSubscription(pendingSwitch.old_paypal_subscription_id!);
        }
      } catch (cancelError) {
        console.error(
          "Failed to cancel superseded agreement for scheduled downgrade:",
          cancelError,
        );
      }
    }

    return;
  }

  if (pendingSwitch) {
    if (!(await claimSwitch(pendingSwitch.id))) {
      // A concurrent delivery of this event is applying it.
      return;
    }

    try {
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
    } catch (error) {
      await releaseSwitch(pendingSwitch.id, pendingSwitch.status);
      throw error;
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
  const paypalSubscriptionId = subscription.id;
  const { data: supersedingSwitch, error: supersedingError } = await admin
    .from("subscription_switches")
    .select("id, effective_at")
    .eq("old_paypal_subscription_id", paypalSubscriptionId)
    .in("status", ["pending", "approved"])
    .maybeSingle();

  if (supersedingError) {
    throw supersedingError;
  }

  if (supersedingSwitch) {
    return;
  }

  const { data: localSubscription, error: subscriptionError } = await admin
    .from("subscriptions")
    .select(
      `
        id,
        tenant_id,
        plan_id,
        paypal_subscription_id,
        status,
        seats,
        current_period_end
      `,
    )
    .eq("paypal_subscription_id", paypalSubscriptionId)
    .maybeSingle();

  if (subscriptionError) {
    throw subscriptionError;
  }

  if (!localSubscription) {
    return;
  }

  const { data: freePlan, error: freePlanError } = await admin
    .from("plans")
    .select("id")
    .eq("name", "Free")
    .eq("is_active", true)
    .maybeSingle();

  if (freePlanError) {
    throw freePlanError;
  }

  if (!freePlan) {
    throw new Error("Free plan not found.");
  }

  const { data: existingSwitch, error: existingSwitchError } = await admin
    .from("subscription_switches")
    .select("id")
    .eq("old_paypal_subscription_id", paypalSubscriptionId)
    .in("status", ["pending", "approved"])
    .maybeSingle();

  if (existingSwitchError) {
    throw existingSwitchError;
  }

  if (existingSwitch) {
    return;
  }

  const effectiveAt = localSubscription.current_period_end;

  if (!effectiveAt) {
    throw new Error(
      `Cannot schedule FREE downgrade: missing current_period_end for ${paypalSubscriptionId}`,
    );
  }

  const { error: switchError } = await admin
    .from("subscription_switches")
    .insert({
      tenant_id: localSubscription.tenant_id,
      plan_id: freePlan.id,
      paypal_subscription_id: `FREE-${localSubscription.tenant_id}`,
      old_paypal_subscription_id: localSubscription.paypal_subscription_id,
      old_plan_id: localSubscription.plan_id,
      old_status: localSubscription.status,
      old_seats: localSubscription.seats,
      old_current_period_end: localSubscription.current_period_end,
      status: "approved",
      effective_at: effectiveAt,
      updated_at: new Date().toISOString(),
    });

  if (switchError) {
    throw switchError;
  }
}

export async function handleSubscriptionSuspended(event: WebhookEvent) {
  const subscription = event.resource;

  // A scheduled cancellation suspends the agreement on purpose (so it can be
  // reactivated). That is not a billing problem: the tenant keeps the plan
  // until effective_at, so the row must not be flagged past_due.
  const { data: schedulingSwitch, error: switchError } = await admin
    .from("subscription_switches")
    .select("id")
    .eq("old_paypal_subscription_id", subscription.id)
    .in("status", ["pending", "approved"])
    .not("effective_at", "is", null)
    .maybeSingle();

  if (switchError) {
    throw switchError;
  }

  if (schedulingSwitch) {
    return;
  }

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
    console.error(
      "[webhook] Revised-upgrade switch lookup failed:",
      lookupError,
    );
    return false;
  }

  // This was a normal subscription update, not a revised upgrade.
  if (!pendingUpgrade) {
    return false;
  }

  // Claimed before applying, as in handleSubscriptionActivated. When another
  // delivery holds the claim this is still a revised upgrade, just not this
  // delivery's to apply.
  if (!(await claimSwitch(pendingUpgrade.id))) {
    return true;
  }

  try {
    const { data: plan, error: planError } = await admin
      .from("plans")
      .select("seat_limit")
      .eq("id", pendingUpgrade.plan_id)
      .maybeSingle();

    if (planError) {
      throw planError;
    }

    const { error: subError } = await admin
      .from("subscriptions")
      .update({
        plan_id: pendingUpgrade.plan_id,
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
      .update({
        plan_id: pendingUpgrade.plan_id,
        updated_at: now,
      })
      .eq("id", tenantId);

    if (tenantError) {
      throw tenantError;
    }
  } catch (error) {
    await releaseSwitch(pendingUpgrade.id, pendingUpgrade.status);
    throw error;
  }

  return true;
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

  await storePayPalPaymentMethod(admin, {
    tenantId: existingSub.tenant_id,
    subscriptionRowId: existingSub.id,
    paypalSubscriptionId: subscription.id,
    subscriber: subscription.subscriber,
    fetchSubscriber: subscriberFetcher(subscription.id),
    context: "webhook:updated",
  });

  const nextBilling = subscription.billing_info?.next_billing_time;

  const wasRevisedUpgrade = await applyRevisedUpgrade(
    subscription,
    existingSub.tenant_id,
    nextBilling,
  );

  if (wasRevisedUpgrade) {
    return;
  }

  if (nextBilling) {
    const { error: updateError } = await admin
      .from("subscriptions")
      .update({
        current_period_end: nextBilling,
        updated_at: new Date().toISOString(),
      })
      .eq("paypal_subscription_id", subscription.id);

    if (updateError) {
      console.error("Failed to sync subscription on update:", updateError);
    }
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
}

export async function handlePaymentCompleted(event: WebhookEvent) {
  const payment = event.resource;

  if (!payment.id) {
    throw new Error("Webhook missing payment id.");
  }

  const subscriptionId = payment.billing_agreement_id;

  if (!subscriptionId) {
    return;
  }

  const paymentTime = payment.create_time
    ? new Date(payment.create_time)
    : new Date();

  const paymentDate = paymentTime.toISOString().substring(0, 10);

  const { data: switchRows, error: upgradeSwitchError } = await admin
    .from("subscription_switches")
    .select(
      "id, tenant_id, status, created_at, updated_at, old_paypal_subscription_id",
    )
    .or(
      `old_paypal_subscription_id.eq.${subscriptionId},paypal_subscription_id.eq.${subscriptionId}`,
    )
    .is("effective_at", null)
    .in("status", ["pending", "approved", "applied"])
    .lte("created_at", paymentTime.toISOString())
    .order("updated_at", { ascending: false })
    .limit(1);

  const upgradeSwitch = (switchRows ?? [])[0] ?? null;

  if (upgradeSwitchError) {
    console.warn(
      `[webhook] upgrade switch lookup failed for sale ${payment.id}:`,
      upgradeSwitchError,
    );
  }

  let isRecentUpgradeSale = false;

  if (upgradeSwitch) {
    const switchUpdated = upgradeSwitch.updated_at
      ? new Date(upgradeSwitch.updated_at)
      : null;

    const switchCreated = upgradeSwitch.created_at
      ? new Date(upgradeSwitch.created_at)
      : null;

    const switchDate =
      switchUpdated && !Number.isNaN(switchUpdated.getTime())
        ? switchUpdated.toISOString().substring(0, 10)
        : switchCreated && !Number.isNaN(switchCreated.getTime())
          ? switchCreated.toISOString().substring(0, 10)
          : null;

    const hadPaidSubscription =
      !!upgradeSwitch.old_paypal_subscription_id &&
      !upgradeSwitch.old_paypal_subscription_id.startsWith("FREE-");

    isRecentUpgradeSale =
      hadPaidSubscription && !!switchDate && switchDate === paymentDate;
  }

  if (isRecentUpgradeSale) {
    return;
  }

  const { data: alreadyInvoiced, error: existingInvoiceError } = await admin
    .from("invoices")
    .select("id, storage_path, email_sent_at")
    .eq("paypal_txn_id", payment.id)
    .maybeSingle();

  if (existingInvoiceError) {
    throw existingInvoiceError;
  }

  // Finished only once the PDF is stored AND the email has gone out. A stored
  // PDF with no email means an earlier delivery failed to send it; carry on so
  // this delivery retries the email (the PDF is not regenerated).
  if (alreadyInvoiced?.storage_path && alreadyInvoiced.email_sent_at) {
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

  let plan = Array.isArray(subscription.plans)
    ? subscription.plans?.[0]
    : subscription.plans;

  // A scheduled downgrade saves the new agreement id on the row at approval
  // but keeps the old plan there until the reconcile job applies the switch.
  // The new agreement's first sale can land before that run, so the invoice
  // takes the plan it actually bills for from the switch. Any sale on that
  // agreement is at the new plan's rate, so no time bound is needed (PayPal's
  // charge time can drift slightly from start_time).
  const { data: dueScheduledSwitch } = await admin
    .from("subscription_switches")
    .select("plans!subscription_switches_plan_id_fkey(name, price_month)")
    .eq("paypal_subscription_id", subscriptionId)
    .in("status", ["pending", "approved"])
    .not("effective_at", "is", null)
    .maybeSingle();

  const scheduledPlan = Array.isArray(dueScheduledSwitch?.plans)
    ? dueScheduledSwitch?.plans?.[0]
    : dueScheduledSwitch?.plans;

  if (scheduledPlan) {
    plan = scheduledPlan;
  }

  const tenant = Array.isArray(subscription.tenants)
    ? subscription.tenants?.[0]
    : subscription.tenants;

  const amount = Number(payment.amount?.total ?? 0);
  const currency = payment.amount?.currency ?? "USD";

  const paidAt = payment.create_time || new Date().toISOString();

  const periodStart = paidAt.substring(0, 10);

  // current_period_end can still hold the previous cycle's end when the sale
  // arrives before the subscription row is moved on. A period that ends on or
  // before the payment day would print as "Sep 11 - Sep 11", so it falls back
  // to one month from the payment instead.
  const recordedPeriodEnd = subscription.current_period_end?.substring(0, 10);
  const hasCurrentPeriod =
    !!recordedPeriodEnd && recordedPeriodEnd > periodStart;

  const periodEnd = addMonths(paidAt).substring(0, 10);

  const nextBillingDate = hasCurrentPeriod
    ? subscription.current_period_end
    : addMonths(paidAt);

  const nextBillingAmount = Number(plan?.price_month ?? 0);

  const { data: billingMethod } = await admin
    .from("payment_methods")
    .select("paypal_email")
    .eq("tenant_id", subscription.tenant_id)
    .eq("is_default", true)
    .maybeSingle();

  const billingEmail = billingMethod?.paypal_email || undefined;

  const { data: failedInvoice } = await admin
    .from("invoices")
    .select("id, amount, period_start, period_end")
    .eq("subscription_id", subscription.id)
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const paidStart = paidAt.substring(0, 10);

  const failedIsSameCharge =
    !!failedInvoice &&
    Number(failedInvoice.amount ?? 0) === amount &&
    paidStart >= failedInvoice.period_start &&
    paidStart <= failedInvoice.period_end;

  let insertedInvoice: { id: string } | null = null;

  if (alreadyInvoiced) {
    insertedInvoice = {
      id: alreadyInvoiced.id,
    };
  } else if (failedIsSameCharge && failedInvoice) {
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

    insertedInvoice = {
      id: failedInvoice.id,
    };
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
      if (invoiceError.code === "23505") {
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

  let storagePath: string | null = invoice.storage_path ?? null;

  if (!storagePath) {
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

    storagePath = await uploadInvoicePdf(
      subscription.tenant_id,
      invoice.id,
      pdf,
    );

    await updateInvoiceStorage(invoice.id, storagePath);
  }

  await emailInvoiceOnce({
    invoice,
    tenantId: subscription.tenant_id,
    storagePath,
    amount: Number(invoice.amount ?? amount ?? 0),
    currency,
  });
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

  if (event.event_type === "CHECKOUT.ORDER.COMPLETED") {
    const capture = resource.purchase_units?.[0]?.payments?.captures?.[0];
    if (!resource.id || !capture?.id || capture.status !== "COMPLETED") {
      return;
    }
    txnId = capture.id;
    currency = capture.amount?.currency ?? "USD";
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
  }

  const { data: invoiceRow, error: invoiceError } = await admin
    .from("invoices")
    .select("*")
    .eq("paypal_txn_id", txnId)
    .maybeSingle();

  if (invoiceError) {
    throw invoiceError;
  }

  const invoice = invoiceRow;

  // Finished only once the PDF is stored AND the email has gone out.
  if (invoice?.storage_path && invoice.email_sent_at) {
    return;
  }

  // The one-time upgrade invoice row is created by `capture-order` (keyed on
  // the PayPal transaction id). If no row exists here, this is a stray event
  // with nothing to finalize — skip rather than invent an invoice.
  if (!invoice) {
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

  let storagePath: string | null = invoice.storage_path ?? null;

  // An earlier delivery may have stored the PDF and only failed to email it.
  if (!storagePath) {
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

    storagePath = await uploadInvoicePdf(tenantId, invoice.id, pdf);

    await updateInvoiceStorage(invoice.id, storagePath);
  }

  // Email the upgrade invoice to the tenant admin (mandatory) and, when one
  // exists, the verified+active billing admin, with a short-lived download
  // link -- exactly once; a failed send is retried via PayPal's redelivery.
  await emailInvoiceOnce({
    invoice,
    tenantId,
    storagePath,
    amount: Number(invoice.amount ?? 0),
    currency,
  });
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

    // 23505: a concurrent delivery already recorded this failure.
    if (invError && invError.code !== "23505") {
      console.error("Failed to record denied payment as an invoice:", invError);
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
