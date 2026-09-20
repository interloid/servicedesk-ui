import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateInvoicePdf } from "./pdf.ts";
import { uploadInvoicePdf, getInvoiceSignedUrl } from "./storage.ts";
import { sendInvoiceEmail } from "./email.ts";
import { updateInvoiceStorage } from "./invoice.ts";
import { paypal } from "./paypal.ts";
import {
  activatePendingAgreement,
  applySubscriptionPlan,
  logBilling,
  nextBillingTime,
  PLAN_COLUMNS,
  priceOf,
  seatsOf,
  SUBSCRIPTION_COLUMNS,
  type BillingAdminClient,
  type PlanRow,
  type SubscriptionRow,
} from "../_shared/paypal-subscriptions.ts";
import { type PayPalSubscriber } from "../_shared/paypal-payment-method.ts";

// A tenant has ONE PayPal agreement, so every recurring event resolves
// straight to its row:
//
//   subscriptions.paypal_subscription_id          the live agreement
//   subscriptions.pending_paypal_subscription_id  a Free -> Paid signup the
//                                                 buyer has not approved yet
//
// Nothing here needs a separate table to work out which tenant an agreement
// belongs to.

interface WebhookEvent {
  id?: string;
  event_type?: string;
  resource: Record<string, unknown> & {
    id?: string;
    create_time?: string;
    plan_id?: string;
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

const billingAdmin = admin as unknown as BillingAdminClient;

function addMonths(iso: string, months = 1): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  date.setMonth(date.getMonth() + months);

  return date.toISOString();
}

type EmbeddedPlan = { name?: string; price_month?: number | string };

/**
 * A subscriptions row read together with its plan. The FK hint the embed needs
 * (see below) defeats supabase-js's select-string inference, which then widens
 * the result to an error type, so these reads are cast to this shape.
 */
type SubscriptionWithPlan = SubscriptionRow & {
  plans?: EmbeddedPlan | EmbeddedPlan[] | null;
  tenants?: { name?: string } | { name?: string }[] | null;
};

/** The tenant that owns this agreement, live or awaiting approval. */
async function findSubscriptionByAgreement(
  paypalSubscriptionId: string,
): Promise<{ sub: SubscriptionRow; isPending: boolean } | null> {
  const { data: live, error: liveError } = await admin
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("paypal_subscription_id", paypalSubscriptionId)
    .maybeSingle();

  if (liveError) {
    throw liveError;
  }

  if (live) {
    return { sub: live as unknown as SubscriptionRow, isPending: false };
  }

  const { data: pending, error: pendingError } = await admin
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("pending_paypal_subscription_id", paypalSubscriptionId)
    .maybeSingle();

  if (pendingError) {
    throw pendingError;
  }

  if (pending) {
    return { sub: pending as unknown as SubscriptionRow, isPending: true };
  }

  return null;
}

async function loadPlan(planId: string | null): Promise<PlanRow | null> {
  if (!planId) return null;

  const { data } = await admin
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .maybeSingle();

  return (data as PlanRow | null) ?? null;
}

async function loadFreePlan(): Promise<PlanRow | null> {
  const { data } = await admin
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("price_month", 0)
    .eq("is_active", true)
    .order("seat_limit", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data as PlanRow | null) ?? null;
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

    // PostgREST types an embedded one-to-one as an array; at runtime it is the
    // single joined user.
    const memberUser = (
      Array.isArray(member?.users) ? member?.users[0] : member?.users
    ) as { full_name?: string; email?: string } | undefined;

    const email = memberUser?.email?.trim();

    if (email && !seen.has(email)) {
      seen.add(email);
      recipients.push({
        email,
        name: memberUser?.full_name?.trim() || "there",
      });
    }
  }

  return recipients;
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

/**
 * BILLING.SUBSCRIPTION.ACTIVATED
 *
 * Either the Free -> Paid signup the tenant is waiting on (the agreement is
 * applied and becomes THE agreement), or the agreement it already has coming
 * back from a suspension. Never a second agreement: none is ever created for
 * a tenant that has one.
 */
export async function handleSubscriptionActivated(event: WebhookEvent) {
  const subscription = event.resource;

  if (!subscription.id) {
    throw new Error("Webhook missing subscription id.");
  }

  const match = await findSubscriptionByAgreement(subscription.id);

  if (!match) {
    // Thrown, not swallowed: PayPal redelivers, which covers the race where
    // the buyer approves before the checkout finished being recorded.
    throw new Error(`Subscription ${subscription.id} not found in database.`);
  }

  const { sub, isPending } = match;

  if (isPending) {
    const plan = await loadPlan(sub.pending_plan_id);

    if (!plan) {
      throw new Error(
        `Pending plan ${sub.pending_plan_id} for tenant ${sub.tenant_id} no longer exists.`,
      );
    }

    // Idempotent: a redelivered ACTIVATED writes the same plan, the same
    // agreement id and the same period onto the row.
    await activatePendingAgreement(billingAdmin, paypal, {
      sub,
      agreementId: subscription.id,
      plan,
      paypalData: subscription,
      context: "webhook:activated",
    });

    return;
  }

  // The tenant's own agreement: refresh what PayPal reports and clear a
  // past_due flag it has recovered from.
  await applySubscriptionPlan(billingAdmin, {
    tenantId: sub.tenant_id,
    status: "active",
    periodEnd: subscription.billing_info?.next_billing_time ?? null,
    clearPending: false,
    clearNext: false,
  });

  logBilling("webhook.activated", {
    tenant_id: sub.tenant_id,
    paypal_subscription_id: subscription.id,
  });
}

/**
 * BILLING.SUBSCRIPTION.CANCELLED
 *
 * Expected when a scheduled cancellation reaches its period end (the cron
 * cancels the agreement and this event follows). Otherwise the buyer ended it
 * in PayPal: they keep what they already paid for, so the move to Free is
 * scheduled for the period end rather than applied now.
 *
 * Nothing here ever tries to revive the agreement -- PayPal cannot.
 */
export async function handleSubscriptionCancelled(event: WebhookEvent) {
  const paypalSubscriptionId = event.resource.id;

  if (!paypalSubscriptionId) {
    throw new Error("Webhook missing subscription id.");
  }

  const match = await findSubscriptionByAgreement(paypalSubscriptionId);

  if (!match) {
    return;
  }

  const { sub, isPending } = match;

  // An abandoned or superseded checkout: there is nothing to downgrade.
  if (isPending) {
    const { error } = await admin
      .from("subscriptions")
      .update({
        pending_plan_id: null,
        pending_order_id: null,
        pending_paypal_subscription_id: null,
        pending_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", sub.tenant_id);

    if (error) {
      throw error;
    }

    return;
  }

  const now = new Date().toISOString();

  const { error: cancelledAtError } = await admin
    .from("subscriptions")
    .update({ cancelled_at: now, updated_at: now })
    .eq("tenant_id", sub.tenant_id);

  if (cancelledAtError) {
    throw cancelledAtError;
  }

  // Already scheduled: the cron owns the rest of it.
  if (sub.cancel_at_period_end) {
    logBilling("webhook.cancelled.expected", {
      tenant_id: sub.tenant_id,
      paypal_subscription_id: paypalSubscriptionId,
    });
    return;
  }

  const freePlan = await loadFreePlan();

  if (!freePlan) {
    throw new Error("Free plan not found.");
  }

  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end)
    : null;

  // No paid time left: drop to Free immediately and forget the dead
  // agreement, so nothing ever calls PayPal with it again.
  if (!periodEnd || periodEnd.getTime() <= Date.now()) {
    await applySubscriptionPlan(billingAdmin, {
      tenantId: sub.tenant_id,
      planId: freePlan.id,
      status: "active",
      seats: seatsOf(freePlan),
      periodStart: now,
      clearPeriodEnd: true,
      clearPaypalSubscriptionId: true,
    });

    logBilling("webhook.cancelled.applied", {
      tenant_id: sub.tenant_id,
      paypal_subscription_id: paypalSubscriptionId,
      target_plan: freePlan.name,
    });

    return;
  }

  const { error } = await admin
    .from("subscriptions")
    .update({
      next_plan_id: freePlan.id,
      next_plan_effective_at: periodEnd.toISOString(),
      cancel_at_period_end: true,
      updated_at: now,
    })
    .eq("tenant_id", sub.tenant_id);

  if (error) {
    throw error;
  }

  logBilling("webhook.cancelled.scheduled", {
    tenant_id: sub.tenant_id,
    paypal_subscription_id: paypalSubscriptionId,
    target_plan: freePlan.name,
    effective_at: periodEnd.toISOString(),
  });
}

/**
 * BILLING.SUBSCRIPTION.SUSPENDED
 *
 * A scheduled cancellation suspends the agreement on purpose (so it can be
 * resumed by "Reactivate"), which is not a billing problem. Anything else is.
 */
export async function handleSubscriptionSuspended(event: WebhookEvent) {
  const paypalSubscriptionId = event.resource.id;

  if (!paypalSubscriptionId) {
    throw new Error("Webhook missing subscription id.");
  }

  const match = await findSubscriptionByAgreement(paypalSubscriptionId);

  if (!match || match.isPending || match.sub.cancel_at_period_end) {
    return;
  }

  const { error } = await admin
    .from("subscriptions")
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("tenant_id", match.sub.tenant_id);

  if (error) {
    throw error;
  }
}

/**
 * BILLING.SUBSCRIPTION.UPDATED
 *
 * Fires when the agreement itself changes -- including once the buyer
 * approves a REVISE. When PayPal now bills the plan the tenant is waiting on,
 * that change is applied here; the agreement id is unchanged throughout.
 */
export async function handleSubscriptionUpdated(event: WebhookEvent) {
  const subscription = event.resource;

  if (!subscription.id) {
    throw new Error("Webhook missing subscription id.");
  }

  const match = await findSubscriptionByAgreement(subscription.id);

  if (!match || match.isPending) {
    return;
  }

  const { sub } = match;
  const nextBilling =
    subscription.billing_info?.next_billing_time ??
    nextBillingTime(subscription);

  const paypalPlanCode = String(subscription.plan_id ?? "");

  // A revise the buyer has just approved. Which change it belongs to decides
  // WHEN it takes effect:
  //
  //   pending_plan_id  an upgrade they paid the difference for -> now
  //   next_plan_id     a downgrade revised early so PayPal bills the lower
  //                    rate next cycle -> NOT now. They paid for the dearer
  //                    plan through next_plan_effective_at and keep it until
  //                    then; reconcile-subscriptions flips the local plan at
  //                    that date (and skips the revise, already done here).
  for (const [planId, isPending] of [
    [sub.pending_plan_id, true],
    [sub.next_plan_id, false],
  ] as Array<[string | null, boolean]>) {
    if (!planId || !paypalPlanCode) continue;

    const plan = await loadPlan(planId);

    if (!plan || plan.code !== paypalPlanCode) continue;

    const notDueYet =
      !isPending &&
      !!sub.next_plan_effective_at &&
      new Date(sub.next_plan_effective_at).getTime() > Date.now();

    if (notDueYet) {
      logBilling("webhook.revise-approved.scheduled", {
        tenant_id: sub.tenant_id,
        paypal_subscription_id: subscription.id,
        target_plan: plan.name,
        effective_at: sub.next_plan_effective_at,
      });

      break;
    }

    // Claimed on the plan it is applying, so a redelivered event that finds
    // the change already applied writes nothing a second time.
    const applied = await applySubscriptionPlan(billingAdmin, {
      tenantId: sub.tenant_id,
      planId: plan.id,
      status: "active",
      seats: seatsOf(plan),
      periodEnd: nextBilling ?? sub.current_period_end ?? null,
      expectedNextPlanId: isPending ? null : planId,
    });

    logBilling("webhook.revise-approved", {
      tenant_id: sub.tenant_id,
      paypal_subscription_id: subscription.id,
      target_plan: plan.name,
      applied,
    });

    return;
  }

  if (nextBilling) {
    const { error } = await admin
      .from("subscriptions")
      .update({
        current_period_end: nextBilling,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", sub.tenant_id);

    if (error) {
      console.error("Failed to sync subscription on update:", error);
    }
  }
}

export async function handleSubscriptionPaymentFailed(event: WebhookEvent) {
  const paypalSubscriptionId = event.resource.id;

  if (!paypalSubscriptionId) {
    throw new Error("Webhook missing subscription id.");
  }

  const match = await findSubscriptionByAgreement(paypalSubscriptionId);

  if (!match || match.isPending) {
    console.error(
      "Subscription not found for payment failure:",
      paypalSubscriptionId,
    );
    return;
  }

  const { error } = await admin
    .from("subscriptions")
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("tenant_id", match.sub.tenant_id);

  if (error) {
    throw error;
  }
}

/**
 * PAYMENT.SALE.COMPLETED -- a RECURRING charge on the agreement.
 *
 * A one-time upgrade order never arrives here: it has no
 * billing_agreement_id and is delivered as PAYMENT.CAPTURE.COMPLETED /
 * CHECKOUT.ORDER.COMPLETED instead. The two kinds of payment therefore can
 * never invoice each other, and the unique paypal_txn_id keeps a redelivered
 * sale from writing a second invoice.
 */
export async function handlePaymentCompleted(event: WebhookEvent) {
  const payment = event.resource;

  if (!payment.id) {
    throw new Error("Webhook missing payment id.");
  }

  const subscriptionId = payment.billing_agreement_id;

  if (!subscriptionId) {
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

  const { data: subscriptionRow, error } = await admin
    .from("subscriptions")
    .select(
      // subscriptions now has three FKs to plans (plan_id, next_plan_id,
      // pending_plan_id), so the embed MUST name the one it means or
      // PostgREST rejects it as ambiguous (PGRST201).
      "*, plans!subscriptions_plan_id_fkey(name, price_month), tenants(name)",
    )
    .eq("paypal_subscription_id", subscriptionId)
    .single();

  if (error || !subscriptionRow) {
    throw new Error("Subscription not found.");
  }

  const subscription = subscriptionRow as unknown as SubscriptionWithPlan;

  let plan: EmbeddedPlan | null =
    (Array.isArray(subscription.plans)
      ? subscription.plans?.[0]
      : subscription.plans) ?? null;

  // A scheduled downgrade is applied by reconcile-subscriptions, which runs
  // hourly; PayPal can bill the new rate before that run. The invoice then
  // takes the plan it is actually charging for, not the one the row still
  // shows.
  if (
    subscription.next_plan_id &&
    subscription.next_plan_effective_at &&
    new Date(subscription.next_plan_effective_at).getTime() <= Date.now()
  ) {
    const duePlan = await loadPlan(subscription.next_plan_id);

    if (duePlan) {
      plan = duePlan;
    }
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

  if (!insertedInvoice) {
    return;
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
        seats: subscription.seats ?? undefined,
        tenant_email: billingEmail,
        next_billing_date: nextBillingDate ?? undefined,
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

/**
 * CHECKOUT.ORDER.COMPLETED / PAYMENT.CAPTURE.COMPLETED -- the ONE-TIME
 * upgrade difference.
 *
 * `capture-order` normally writes this invoice the moment it captures; this
 * handler attaches the PDF and the email. When the webhook wins the race, the
 * invoice is written here instead -- keyed on the same PayPal capture id, so
 * the two paths can only ever produce ONE invoice.
 */
export async function handleOrderCompleted(event: WebhookEvent) {
  const resource = event.resource as Record<string, unknown> & {
    id?: string;
    custom_id?: string;
    status?: string;
    amount?: { value?: string; currency?: string };
    purchase_units?: Array<{
      custom_id?: string;
      payments?: {
        captures?: Array<{
          id?: string;
          status?: string;
          custom_id?: string;
          amount?: { value?: string; currency?: string };
        }>;
      };
    }>;
  };

  let txnId: string;
  let currency = "USD";
  let amount = 0;
  let tenantId: string | undefined;

  if (event.event_type === "CHECKOUT.ORDER.COMPLETED") {
    const unit = resource.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];

    if (!resource.id || !capture?.id || capture.status !== "COMPLETED") {
      return;
    }

    txnId = capture.id;
    currency = capture.amount?.currency ?? "USD";
    amount = Number(capture.amount?.value ?? 0);
    tenantId = unit?.custom_id ?? capture.custom_id;
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
    amount = Number(resource.amount?.value ?? 0);
    tenantId = resource.custom_id;
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

  // Finished only once the PDF is stored AND the email has gone out.
  if (invoice?.storage_path && invoice.email_sent_at) {
    return;
  }

  // The webhook beat `capture-order` to it. custom_id carries the tenant, and
  // the tenant's pending upgrade carries the plan, so the invoice can be
  // written here rather than being lost.
  if (!invoice) {
    if (!tenantId || amount <= 0) {
      return;
    }

    const { data: subRow } = await admin
      .from("subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const sub = subRow as unknown as SubscriptionRow | null;

    if (!sub) {
      return;
    }

    const plan = await loadPlan(sub.pending_plan_id ?? sub.plan_id);
    const nowIso = new Date().toISOString();

    const { error: upsertError } = await admin.from("invoices").upsert(
      {
        tenant_id: tenantId,
        paypal_txn_id: txnId,
        paypal_event_id: event.id ?? null,
        amount,
        currency,
        status: "paid",
        invoice_type: "one_time",
        subscription_id: sub.id,
        paypal_subscription_id: sub.paypal_subscription_id,
        subtotal: amount,
        tax: 0,
        amount_paid: amount,
        balance_due: 0,
        payment_method: "PayPal",
        paid_at: nowIso,
        plan_name: plan?.name ?? null,
        seats: seatsOf(plan),
        period_start: nowIso.substring(0, 10),
        period_end: nowIso.substring(0, 10),
        next_billing_date: sub.current_period_end,
        next_billing_amount: priceOf(plan),
      },
      { onConflict: "paypal_txn_id", ignoreDuplicates: true },
    );

    if (upsertError) {
      throw upsertError;
    }

    const { data: written } = await admin
      .from("invoices")
      .select("*")
      .eq("paypal_txn_id", txnId)
      .maybeSingle();

    if (!written) {
      return;
    }

    invoice = written;
  }

  const invoiceTenantId = invoice.tenant_id;

  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", invoiceTenantId)
    .maybeSingle();

  const { data: tenantSubRow } = await admin
    .from("subscriptions")
    .select(
      "current_period_end, plans!subscriptions_plan_id_fkey(name, price_month)",
    )
    .eq("tenant_id", invoiceTenantId)
    .maybeSingle();

  const tenantSub = tenantSubRow as unknown as
    | (Pick<SubscriptionRow, "current_period_end"> & {
        plans?: EmbeddedPlan | EmbeddedPlan[] | null;
      })
    | null;

  const tenantPlan = Array.isArray(tenantSub?.plans)
    ? tenantSub?.plans?.[0]
    : tenantSub?.plans;

  // For the "Upcoming billing" panel, prefer the values recorded on the row
  // itself (set at capture time from the TARGET plan). The live subscription
  // row can still show the old plan while the revise is being approved.
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
    .eq("tenant_id", invoiceTenantId)
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
        tenant_id: invoiceTenantId,
        plan_name: invoice.plan_name,
        seats: invoice.seats,
        tenant_email: billingEmail,
        next_billing_date: nextBillingDate,
        next_billing_amount: nextBillingAmount,
      },
    );

    storagePath = await uploadInvoicePdf(invoiceTenantId, invoice.id, pdf);

    await updateInvoiceStorage(invoice.id, storagePath);
  }

  // Email the upgrade invoice to the tenant admin (mandatory) and, when one
  // exists, the verified+active billing admin, with a short-lived download
  // link -- exactly once; a failed send is retried via PayPal's redelivery.
  await emailInvoiceOnce({
    invoice,
    tenantId: invoiceTenantId,
    storagePath,
    amount: Number(invoice.amount ?? 0),
    currency,
  });
}

export async function handlePaymentDenied(event: WebhookEvent) {
  const payment = event.resource;

  if (!payment.billing_agreement_id) {
    return;
  }

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
  const { data: deniedRow } = await admin
    .from("subscriptions")
    .select(
      "id, tenant_id, paypal_subscription_id, current_period_end, seats, " +
        "plans!subscriptions_plan_id_fkey(name, price_month)",
    )
    .eq("paypal_subscription_id", payment.billing_agreement_id)
    .maybeSingle();

  const subscription = deniedRow as unknown as SubscriptionWithPlan | null;

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
