import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPayPalTokenProvider } from "../_shared/paypal-auth.ts";
import {
  storePayPalPaymentMethod,
  type AdminClient,
} from "../_shared/paypal-payment-method.ts";
import {
  activatePendingAgreement,
  applyApprovedPlanChange,
  applySubscriptionPlan,
  canCancel,
  canRevise,
  createPayPalSubscriptionsClient,
  isDead,
  logBilling,
  nextBillingTime,
  PLAN_COLUMNS,
  priceOf,
  round2,
  seatsOf,
  SUBSCRIPTION_COLUMNS,
  type BillingAdminClient,
  type PlanRow,
  type SubscriptionRow,
} from "../_shared/paypal-subscriptions.ts";

// ONE PayPal recurring subscription per tenant.
//
//   Free -> Paid      create the agreement (the only time one is created)
//   Paid -> Paid up   one-time ORDER for (target - current), then REVISE the
//                     same agreement; its id never changes
//   Paid -> Paid down schedule it; reconcile revises the same agreement at the
//                     end of the paid period
//   Cancel            suspend the agreement, keep access to the period end,
//                     then cancel it for good and drop to Free
//
// The `subscriptions` row is the source of truth for all of it: what the
// tenant has now (plan_id / paypal_subscription_id / current_period_*), what
// is committed for later (next_plan_* / cancel_at_period_end) and what
// checkout is still open (pending_*). Nothing else holds billing state.

const CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID")?.trim();
const CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET")?.trim();
const BASE_URL = Deno.env.get("PAYPAL_BASE_URL")?.trim();
const FRONTEND_URL = Deno.env.get("FRONTEND_URL")?.trim();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
const SUPABASE_SERVICE_ROLE_KEY = Deno.env
  .get("SUPABASE_SERVICE_ROLE_KEY")
  ?.trim();

if (!CLIENT_ID) throw new Error("PAYPAL_CLIENT_ID is missing");
if (!CLIENT_SECRET) throw new Error("PAYPAL_CLIENT_SECRET is missing");
if (!BASE_URL) throw new Error("PAYPAL_BASE_URL is missing");
if (!FRONTEND_URL) throw new Error("FRONTEND_URL is missing");
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is missing");
if (!SUPABASE_ANON_KEY) throw new Error("SUPABASE_ANON_KEY is missing");
if (!SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");

const getAccessToken = createPayPalTokenProvider({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  baseUrl: BASE_URL,
});

const paypal = createPayPalSubscriptionsClient({
  baseUrl: BASE_URL,
  getAccessToken,
});

// An abandoned checkout is not a plan change: after this long the pending
// order / unapproved agreement is dropped so the tenant can start another one.
const PENDING_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

// What the buyer is told when an upgrade order is captured but the PayPal
// plan move has not landed. The payment itself always succeeded -- it is
// invoiced and the money is taken -- so neither of these calls it a failed
// payment.
//
// RETRYABLE: reconcile-subscriptions will apply it (the agreement is simply
// not ready this second). STUCK: nothing automatic can fix it, so the buyer
// is pointed at support instead of being told to wait for something that will
// never happen.
const UPGRADE_PENDING_MESSAGE =
  "Payment received. Your plan change is being applied — this can take a few minutes.";

const UPGRADE_STUCK_MESSAGE =
  "Your payment was received, but your subscription could not be moved to the new plan. Please contact support — we can either apply it or refund you.";

// The exact client the request builds, so helpers below accept it without a
// generic mismatch against supabase-js's default type parameters.
const createAdminClient = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Admin = ReturnType<typeof createAdminClient>;

function asBillingAdmin(admin: Admin): BillingAdminClient {
  return admin as unknown as BillingAdminClient;
}

function asPaymentMethodAdmin(admin: Admin): AdminClient {
  return admin as unknown as AdminClient;
}

async function loadSubscription(
  admin: Admin,
  tenantId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await admin
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[billing] subscription lookup failed:", {
      tenant_id: tenantId,
      error,
    });
    throw new Error("Failed to look up your subscription.");
  }

  return (data as SubscriptionRow | null) ?? null;
}

async function loadPlan(
  admin: Admin,
  planId: string | null | undefined,
): Promise<PlanRow | null> {
  if (!planId) return null;

  const { data } = await admin
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .maybeSingle();

  return (data as PlanRow | null) ?? null;
}

async function loadFreePlan(admin: Admin): Promise<PlanRow | null> {
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

async function clearPendingCheckout(admin: Admin, tenantId: string) {
  const { error } = await admin
    .from("subscriptions")
    .update({
      pending_plan_id: null,
      pending_order_id: null,
      pending_paypal_subscription_id: null,
      pending_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[billing] could not clear the pending checkout:", {
      tenant_id: tenantId,
      error,
    });
  }
}

// Best-effort: the cancellation itself has already gone through, so a failed
// insert is logged rather than surfaced to the customer.
async function logCancellationReason(
  admin: Admin,
  row: { tenantId: string; subscriptionId: string; reason: string },
) {
  const { error } = await admin
    .from("subscription_cancellation_reasons")
    .insert({
      tenant_id: row.tenantId,
      subscription_id: row.subscriptionId,
      reason: row.reason,
      created_at: new Date().toISOString(),
    });

  if (error) {
    console.warn("[billing] could not log the cancellation reason:", error);
  }
}

type CapturedOrder = {
  payerId?: string;
  payerEmail?: string;
  txnId?: string;
  amount?: number;
  currency?: string;
};

async function fetchPaypalOrder(
  orderId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/v2/checkout/orders/${orderId}`, {
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return {};
  }

  return await response.json().catch(() => ({}));
}

function parseCompletedOrder(data: Record<string, unknown>): CapturedOrder {
  const payer = data.payer as
    { payer_id?: string; email_address?: string } | undefined;

  const purchaseUnits = data.purchase_units as
    | Array<{
        payments?: {
          captures?: Array<{
            id?: string;
            amount?: { value?: string; currency?: string };
          }>;
        };
      }>
    | undefined;

  const captures = purchaseUnits?.[0]?.payments?.captures;
  const capture = captures?.find((c) => c?.id) ?? captures?.[0];

  return {
    payerId: payer?.payer_id,
    payerEmail: payer?.email_address,
    txnId: capture?.id,
    amount: Number(capture?.amount?.value ?? 0),
    currency: capture?.amount?.currency ?? "USD",
  };
}

// The ONE-TIME order that collects an upgrade difference. It is not a
// recurring payment: the agreement keeps billing the monthly rate on its own
// schedule, and this order gets its own `one_time` invoice.
async function createPaypalOrder(params: {
  amount: number;
  description: string;
  customId: string;
  return_url: string;
  cancel_url: string;
}): Promise<{
  ok: boolean;
  orderId?: string;
  approveUrl?: string;
  error?: string;
}> {
  const response = await fetch(`${BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          description: params.description,
          custom_id: params.customId,
          amount: {
            currency_code: "USD",
            value: params.amount.toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: "ServiceDesk",
        user_action: "PAY_NOW",
        return_url: params.return_url,
        cancel_url: params.cancel_url,
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    console.error("[paypal] order creation failed:", {
      http_status: response.status,
      name: (data as { name?: string }).name ?? null,
    });
    return {
      ok: false,
      error: (data as { message?: string }).message || "Order creation failed",
    };
  }

  const links = data.links as Array<{ rel: string; href: string }> | undefined;

  return {
    ok: true,
    orderId: data.id as string,
    approveUrl: links?.find((l) => l.rel === "approve")?.href,
  };
}

async function capturePaypalOrder(
  orderId: string,
): Promise<
  ({ ok: true } & CapturedOrder) | { ok: false; error: string; issue?: string }
> {
  // Capturing an order that is already COMPLETED fails with PayPal's generic
  // "failed business validation" error. The browser can land on
  // /payment/success twice (refresh, double submit, PayPal re-navigation), so
  // resolve existing captures up front instead of retrying the POST.
  const existingOrder = await fetchPaypalOrder(orderId);

  if (String(existingOrder.status ?? "").toUpperCase() === "COMPLETED") {
    return { ok: true, ...parseCompletedOrder(existingOrder) };
  }

  const response = await fetch(
    `${BASE_URL}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );

  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (response.ok) {
    return { ok: true, ...parseCompletedOrder(data) };
  }

  // A capture can complete between the GET and this POST (parallel webhook
  // delivery, double submit). Re-check once; if the order is COMPLETED now,
  // the money is in and this must surface as success.
  const recheckOrder = await fetchPaypalOrder(orderId);

  if (String(recheckOrder.status ?? "").toUpperCase() === "COMPLETED") {
    return { ok: true, ...parseCompletedOrder(recheckOrder) };
  }

  const details = Array.isArray(data.details) ? data.details : [];
  const firstDetail = details[0] as { issue?: string } | undefined;

  console.error("[paypal] order capture failed:", {
    order_id: orderId,
    http_status: response.status,
    issue: firstDetail?.issue ?? null,
  });

  return {
    ok: false,
    issue: firstDetail?.issue,
    error:
      firstDetail?.issue ??
      (data as { message?: string }).message ??
      "Capture failed",
  };
}

// The ONLY place a recurring PayPal subscription is created: a tenant with no
// agreement at all (Free / trial) subscribing to a paid plan.
async function createPaypalSubscription(params: {
  planCode: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
}): Promise<{
  ok: boolean;
  subscriptionId?: string;
  approvalUrl?: string;
  error?: string;
  details?: unknown;
  debugId?: string | null;
}> {
  const response = await fetch(`${BASE_URL}/v1/billing/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      plan_id: params.planCode,
      custom_id: params.tenantId,
      subscriber: {
        email_address: params.email,
        name: { given_name: "Valued", surname: "Customer" },
        address: { country_code: "US" },
      },
      application_context: {
        brand_name: "ServiceDesk",
        user_action: "SUBSCRIBE_NOW",
        landing_page: "LOGIN",
        return_url: `${FRONTEND_URL}/${params.tenantSlug}/payment/success`,
        cancel_url: `${FRONTEND_URL}/${params.tenantSlug}/payment/cancel`,
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    details?: unknown;
    debug_id?: string;
    links?: Array<{ rel: string; href: string }>;
  };

  if (!response.ok || !data.id) {
    console.error("[paypal] subscription creation failed:", {
      tenant_id: params.tenantId,
      plan_code: params.planCode,
      http_status: response.status,
    });

    return {
      ok: false,
      error: data.message ?? "PayPal subscription creation failed.",
      details: data.details ?? null,
      debugId: data.debug_id ?? null,
    };
  }

  return {
    ok: true,
    subscriptionId: data.id,
    approvalUrl: data.links?.find((link) => link.rel === "approve")?.href,
  };
}

/**
 * Brings the row in line with PayPal before any decision is made on it.
 *
 * A pending agreement that PayPal has already activated (the buyer approved
 * but the webhook has not landed yet) is applied, so the next decision is
 * taken against the agreement the tenant really has -- that is what stops a
 * second agreement being created for someone who already has one. A pending
 * checkout PayPal has dropped, or that was abandoned, is cleared.
 */
async function reconcilePendingCheckout(
  admin: Admin,
  sub: SubscriptionRow,
): Promise<SubscriptionRow> {
  if (!sub.pending_plan_id) return sub;

  const startedAt = sub.pending_started_at
    ? new Date(sub.pending_started_at).getTime()
    : 0;
  const expired = Date.now() - startedAt > PENDING_CHECKOUT_TTL_MS;

  if (sub.pending_paypal_subscription_id) {
    const lookup = await paypal.get(sub.pending_paypal_subscription_id);

    if (
      lookup.ok &&
      (lookup.status === "ACTIVE" || lookup.status === "APPROVED")
    ) {
      const plan = await loadPlan(admin, sub.pending_plan_id);

      if (plan) {
        await activatePendingAgreement(asBillingAdmin(admin), paypal, {
          sub,
          agreementId: sub.pending_paypal_subscription_id,
          plan,
          paypalData: lookup.data,
          context: "subscription:reconcile-pending",
        });

        return (await loadSubscription(admin, sub.tenant_id)) ?? sub;
      }
    }

    if (!lookup.ok || isDead(lookup.status) || expired) {
      if (lookup.ok && canCancel(lookup.status)) {
        await paypal.cancel(
          sub.pending_paypal_subscription_id,
          "Checkout abandoned",
        );
      }

      logBilling("checkout.expired", {
        tenant_id: sub.tenant_id,
        paypal_subscription_id: sub.pending_paypal_subscription_id,
        paypal_status: lookup.status,
      });

      await clearPendingCheckout(admin, sub.tenant_id);

      return (await loadSubscription(admin, sub.tenant_id)) ?? sub;
    }

    return sub;
  }

  // A pending PLAN CHANGE with neither an order nor an agreement of its own:
  // a downgrade waiting on the buyer's PayPal approval. Nothing was charged
  // and nothing was promised, so once the TTL passes it is simply dropped --
  // the tenant stays on the plan they have. If they did approve it, the
  // UPDATED webhook has already turned it into a real schedule.
  if (!sub.pending_order_id && expired) {
    logBilling("plan-change.abandoned", {
      tenant_id: sub.tenant_id,
      target_plan_id: sub.pending_plan_id,
    });

    await clearPendingCheckout(admin, sub.tenant_id);

    return (await loadSubscription(admin, sub.tenant_id)) ?? sub;
  }

  // A pending ORDER: only time expires it. A captured one is finished by
  // `capture-order` (or retried by reconcile-subscriptions), never here.
  if (sub.pending_order_id && expired) {
    const order = await fetchPaypalOrder(sub.pending_order_id);

    if (String(order.status ?? "").toUpperCase() !== "COMPLETED") {
      logBilling("checkout.expired", {
        tenant_id: sub.tenant_id,
        order_id: sub.pending_order_id,
      });

      await clearPendingCheckout(admin, sub.tenant_id);

      return (await loadSubscription(admin, sub.tenant_id)) ?? sub;
    }
  }

  return sub;
}

/**
 * Cancellation, from either the Cancel button or a plan change to Free.
 *
 * With paid time left the tenant keeps the plan until current_period_end and
 * the agreement is SUSPENDED -- never cancelled -- so it bills no further
 * cycle while "Reactivate" can still resume the very same agreement.
 * reconcile-subscriptions cancels it for good at the period end and moves the
 * tenant to Free with paypal_subscription_id = NULL.
 */
async function scheduleCancellation(
  admin: Admin,
  params: {
    sub: SubscriptionRow;
    currentPlan: PlanRow | null;
    freePlan: PlanRow;
    reason?: string;
  },
): Promise<Response> {
  const { sub, currentPlan, freePlan, reason } = params;
  const now = new Date();
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end)
    : null;

  const hasPaidTime =
    periodEnd !== null &&
    periodEnd.getTime() > now.getTime() &&
    priceOf(currentPlan) > 0;

  const agreementId = sub.paypal_subscription_id;
  const lookup = agreementId ? await paypal.get(agreementId) : null;

  if (reason) {
    await logCancellationReason(admin, {
      tenantId: sub.tenant_id,
      subscriptionId: sub.id,
      reason,
    });
  }

  if (hasPaidTime && periodEnd) {
    const { error } = await admin
      .from("subscriptions")
      .update({
        next_plan_id: freePlan.id,
        next_plan_effective_at: periodEnd.toISOString(),
        cancel_at_period_end: true,
        cancelled_at: now.toISOString(),
        // The customer asked for this, so the agreement is about to be
        // SUSPENDED rather than cancelled and "Reactivate" can be offered --
        // unless the suspend below fails, which rewrites paypal_status.
        cancellation_source: "customer",
        pending_plan_id: null,
        pending_order_id: null,
        pending_paypal_subscription_id: null,
        pending_started_at: null,
        updated_at: now.toISOString(),
      })
      .eq("tenant_id", sub.tenant_id);

    if (error) {
      console.error("[billing] could not schedule the cancellation:", {
        tenant_id: sub.tenant_id,
        error,
      });
      return Response.json(
        { success: false, message: "Failed to schedule cancellation." },
        { status: 500 },
      );
    }

    // Suspending is what makes "Reactivate" possible on the SAME agreement.
    // A dead agreement needs no action: nothing will ever bill on it again.
    if (agreementId && lookup?.ok && lookup.status === "ACTIVE") {
      const suspended = await paypal.setState(
        agreementId,
        "suspend",
        "Cancellation scheduled by customer",
      );

      // Falling back to a real cancel is the lesser evil: an agreement left
      // ACTIVE would charge the customer another cycle they have cancelled.
      // They keep access until the period end either way (entitlements come
      // from this row), but "Reactivate" will then correctly report that the
      // PayPal subscription has ended and cannot be resumed.
      if (!suspended) {
        const cancelled = await paypal.cancel(
          agreementId,
          "Cancellation scheduled by customer; agreement could not be suspended",
        );

        console.error(
          "[billing] could not suspend a cancelled agreement; cancelled it instead:",
          {
            tenant_id: sub.tenant_id,
            paypal_subscription_id: agreementId,
            cancelled,
          },
        );
      }

      // Recorded from the OUTCOME, not the intent: a suspend that fell back to
      // a cancel leaves an agreement PayPal can never resume, and the billing
      // page must not offer "Reactivate" for it.
      await admin
        .from("subscriptions")
        .update({
          paypal_status: suspended ? "SUSPENDED" : "CANCELLED",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", sub.tenant_id);
    }

    logBilling("cancel.scheduled", {
      tenant_id: sub.tenant_id,
      paypal_subscription_id: agreementId,
      current_plan: currentPlan?.name,
      target_plan: freePlan.name,
      paypal_status: lookup?.status,
      effective_at: periodEnd.toISOString(),
    });

    return Response.json({
      success: true,
      scheduled: true,
      effectiveAt: periodEnd.toISOString(),
      message:
        "Subscription cancelled. Your current plan stays active until the end of the billing period.",
    });
  }

  // Nothing left paid for: end it now.
  if (agreementId && lookup?.ok && canCancel(lookup.status)) {
    const cancelled = await paypal.cancel(agreementId, "Cancelled by customer");

    if (!cancelled) {
      return Response.json(
        {
          success: false,
          message:
            "PayPal could not cancel your subscription. Please try again in a moment.",
        },
        { status: 502 },
      );
    }
  }

  await applySubscriptionPlan(asBillingAdmin(admin), {
    tenantId: sub.tenant_id,
    planId: freePlan.id,
    status: "active",
    seats: seatsOf(freePlan),
    periodStart: now.toISOString(),
    clearPeriodEnd: true,
    clearPaypalSubscriptionId: true,
  });

  // Ended outright, with no paid time left to run down. The agreement is gone
  // and there is nothing to reactivate.
  await admin
    .from("subscriptions")
    .update({
      cancelled_at: now.toISOString(),
      cancellation_source: "customer",
      paypal_status: "CANCELLED",
      updated_at: now.toISOString(),
    })
    .eq("tenant_id", sub.tenant_id);

  logBilling("cancel.immediate", {
    tenant_id: sub.tenant_id,
    paypal_subscription_id: agreementId,
    current_plan: currentPlan?.name,
    target_plan: freePlan.name,
    paypal_status: lookup?.status,
  });

  return Response.json({
    success: true,
    message: "Subscription cancelled. You are now on the Free plan.",
  });
}

/** Records the one-time upgrade charge. Keyed on the PayPal capture id, so a
 *  retry or a redelivered webhook can never write it twice. */
async function recordUpgradeInvoice(
  admin: Admin,
  params: {
    sub: SubscriptionRow;
    plan: PlanRow;
    capture: CapturedOrder;
    billingEmail?: string;
  },
): Promise<void> {
  const { sub, plan, capture } = params;

  if (!capture.txnId || !capture.amount || capture.amount <= 0) {
    if (!capture.txnId) {
      console.error(
        "[billing] captured upgrade has no readable capture id; no invoice was recorded:",
        { tenant_id: sub.tenant_id, order_id: sub.pending_order_id },
      );
    }
    return;
  }

  const nowIso = new Date().toISOString();

  const { error } = await admin.from("invoices").upsert(
    {
      tenant_id: sub.tenant_id,
      paypal_txn_id: capture.txnId,
      amount: capture.amount,
      status: "paid",
      storage_path: null,
      period_start: nowIso.substring(0, 10),
      period_end: nowIso.substring(0, 10),
      plan_name: plan.name,
      seats: seatsOf(plan),
      // A one-time upgrade difference, NOT a recurring charge: the agreement
      // keeps billing the monthly rate on its own cycle and writes its own
      // `recurring` invoices from PAYMENT.SALE.COMPLETED.
      invoice_type: "one_time",
      subscription_id: sub.id,
      currency: capture.currency ?? "USD",
      subtotal: capture.amount,
      tax: 0,
      amount_paid: capture.amount,
      balance_due: 0,
      payment_method: "PayPal",
      paid_at: nowIso,
      billing_email: capture.payerEmail ?? params.billingEmail ?? undefined,
      paypal_subscription_id: sub.paypal_subscription_id,
      next_billing_date: sub.current_period_end,
      next_billing_amount: priceOf(plan),
    },
    { onConflict: "paypal_txn_id", ignoreDuplicates: true },
  );

  // The charge has already gone through, so this does not fail the upgrade --
  // but a missing invoice for real money must be visible.
  if (error) {
    console.error("[billing] could not record the one-time upgrade invoice:", {
      tenant_id: sub.tenant_id,
      txn_id: capture.txnId,
      error,
    });
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json(
        { success: false, message: "Method Not Allowed" },
        { status: 405 },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await req.json();
    const action = body?.action ?? "create";
    const planId = body?.planId;
    const tenantSlug = body?.tenantSlug;
    const subscriptionId = body?.subscriptionId;

    if (!tenantSlug) {
      return Response.json(
        { success: false, message: "Tenant slug is required." },
        { status: 400 },
      );
    }

    // Where PayPal hands the buyer back when a revise needs their approval.
    // /payment/success re-reads the agreement from PayPal and applies the plan,
    // so the buyer landing there is what turns an approved revise into a live
    // plan without waiting for the webhook.
    const approvalRedirect = {
      returnUrl: `${FRONTEND_URL}/${tenantSlug}/payment/success`,
      cancelUrl: `${FRONTEND_URL}/${tenantSlug}/payment/cancel`,
    };

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const admin = createAdminClient();

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      console.error("User authentication failed:", userError);
      return Response.json(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("id, slug, plan_id")
      .eq("slug", tenantSlug)
      .single();

    if (tenantError || !tenant) {
      console.error("Tenant lookup failed:", tenantError);
      return Response.json(
        { success: false, message: "Tenant not found." },
        { status: 404 },
      );
    }

    const tenantId = tenant.id as string;

    const { data: billingMember, error: membershipError } = await admin
      .from("memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId)
      .in("role", ["tenant_admin", "billing_admin"])
      .eq("status", "active")
      .maybeSingle();

    if (membershipError || !billingMember) {
      console.error("Billing permission check failed:", membershipError);
      return Response.json(
        {
          success: false,
          message:
            "Forbidden: you do not have billing permissions for this tenant.",
        },
        { status: 403 },
      );
    }

    // Hosted card fields are disabled, so no SDK client token is minted;
    // reject clients that still ask for one.
    if (action === "sdk-token") {
      return Response.json(
        {
          success: false,
          message: "Card payments are not supported. Please use PayPal wallet.",
        },
        { status: 400 },
      );
    }

    const existing = await loadSubscription(admin, tenantId);

    if (!existing) {
      return Response.json(
        { success: false, message: "No subscription found for this tenant." },
        { status: 404 },
      );
    }

    // =================================================================
    // abort -- undo whatever is outstanding
    //
    // Both "Reactivate" (a scheduled cancellation) and "Cancel change" (a
    // scheduled downgrade) land here, as does abandoning an unpaid checkout.
    // No agreement is ever created: the tenant keeps the one they have and the
    // plan they are on.
    //
    // A scheduled downgrade was revised onto the agreement the day it was
    // scheduled, so undoing it has to revise BACK -- otherwise PayPal keeps
    // billing the cheaper plan for a change the tenant just cancelled.
    // =================================================================
    if (action === "abort") {
      const sub = existing;

      if (sub.next_plan_id) {
        const agreementId = sub.paypal_subscription_id;
        const lookup = agreementId ? await paypal.get(agreementId) : null;

        if (agreementId) {
          if (!lookup?.ok) {
            return Response.json(
              {
                success: false,
                message:
                  "Could not check your PayPal subscription. Please try again.",
              },
              { status: 502 },
            );
          }

          // PayPal cannot revive a CANCELLED or EXPIRED agreement -- calling
          // activate on one only returns an error. Say so instead of
          // reporting a reactivation that did not happen.
          if (isDead(lookup.status)) {
            logBilling("reactivate.refused", {
              tenant_id: tenantId,
              paypal_subscription_id: agreementId,
              paypal_status: lookup.status,
            });

            return Response.json(
              {
                success: false,
                message:
                  "Your PayPal subscription has already ended and cannot be reactivated. Your plan stays active until the end of the billing period; choose a plan to subscribe again.",
              },
              { status: 409 },
            );
          }

          // A scheduled cancellation suspended it; resume the same agreement.
          if (lookup.status === "SUSPENDED") {
            const resumed = await paypal.setState(
              agreementId,
              "activate",
              "Customer reactivated the subscription",
            );

            if (!resumed) {
              return Response.json(
                {
                  success: false,
                  message:
                    "PayPal could not resume your subscription. Please try again.",
                },
                { status: 502 },
              );
            }
          }

          // PayPal is on the plan the tenant was moving TO. Put it back on the
          // plan they are actually on, or the next cycle bills the wrong
          // amount for a change they just undid.
          const livePlan = await loadPlan(admin, sub.plan_id);
          const paypalPlanCode = String(lookup.data.plan_id ?? "");

          if (livePlan && paypalPlanCode && paypalPlanCode !== livePlan.code) {
            const revert = await paypal.revise(
              agreementId,
              livePlan.code,
              approvalRedirect,
            );

            if (!revert.ok) {
              console.error("[billing] could not revise back on undo:", {
                tenant_id: tenantId,
                paypal_subscription_id: agreementId,
                current_plan: livePlan.name,
                issue: revert.issue,
              });

              return Response.json(
                {
                  success: false,
                  message:
                    "PayPal could not restore your plan. Please try again in a moment.",
                },
                { status: 502 },
              );
            }

            // Going back up in price, so PayPal asks the buyer to confirm.
            //
            // The scheduled change is deliberately LEFT IN PLACE until they
            // do: clearing it now would leave the tenant on the dearer plan
            // locally while PayPal bills the cheaper one. pending_plan_id
            // carries the plan to settle on, and the UPDATED webhook clears
            // the schedule when the confirmation lands. If they never
            // confirm, the downgrade they scheduled simply goes ahead.
            if (revert.approveUrl) {
              const { error: pendingError } = await admin
                .from("subscriptions")
                .update({
                  pending_plan_id: livePlan.id,
                  pending_order_id: null,
                  pending_paypal_subscription_id: null,
                  pending_started_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq("tenant_id", tenantId);

              if (pendingError) {
                console.error("[billing] could not record the undo:", {
                  tenant_id: tenantId,
                  error: pendingError,
                });
              }

              logBilling("scheduled-change.undo-awaiting-approval", {
                tenant_id: tenantId,
                paypal_subscription_id: agreementId,
                current_plan: livePlan.name,
              });

              return Response.json({
                success: true,
                restored: false,
                planName: livePlan.name,
                approvalUrl: revert.approveUrl,
                message:
                  "Please confirm with PayPal to keep your current plan.",
              });
            }

            logBilling("scheduled-change.reverted-on-paypal", {
              tenant_id: tenantId,
              paypal_subscription_id: agreementId,
              current_plan: livePlan.name,
            });
          }
        }

        const { error: clearError } = await admin
          .from("subscriptions")
          .update({
            next_plan_id: null,
            next_plan_effective_at: null,
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq("tenant_id", tenantId);

        if (clearError) {
          console.error("[billing] could not clear the scheduled change:", {
            tenant_id: tenantId,
            error: clearError,
          });
          return Response.json(
            { success: false, message: "Failed to restore your plan." },
            { status: 500 },
          );
        }

        const currentPlan = await loadPlan(admin, sub.plan_id);

        logBilling("scheduled-change.reverted", {
          tenant_id: tenantId,
          paypal_subscription_id: agreementId,
          current_plan: currentPlan?.name,
          paypal_status: lookup?.status,
        });

        return Response.json({
          success: true,
          restored: true,
          message: "Your previous plan has been restored.",
          planName: currentPlan?.name ?? null,
        });
      }

      if (sub.pending_plan_id) {
        if (sub.pending_paypal_subscription_id) {
          const lookup = await paypal.get(sub.pending_paypal_subscription_id);

          if (lookup.ok && canCancel(lookup.status)) {
            await paypal.cancel(
              sub.pending_paypal_subscription_id,
              "Plan change cancelled by customer",
            );
          }
        }

        await clearPendingCheckout(admin, tenantId);

        logBilling("checkout.aborted", {
          tenant_id: tenantId,
          order_id: sub.pending_order_id,
          paypal_subscription_id: sub.pending_paypal_subscription_id,
        });

        // The tenant's plan never changed, so nothing was restored.
        return Response.json({
          success: true,
          restored: false,
          message: "The pending plan change was cancelled.",
        });
      }

      return Response.json({
        success: true,
        restored: false,
        message: "No pending plan change was found.",
      });
    }

    // =================================================================
    // capture-order -- the buyer paid the upgrade difference
    //
    //   capture the ONE-TIME order  ->  invoice it  ->  REVISE the existing
    //   agreement onto the new plan (same id)  ->  move the tenant
    //
    // No agreement is created here, ever.
    // =================================================================
    if (action === "capture-order") {
      const orderId = subscriptionId;

      if (!orderId) {
        return Response.json(
          { success: false, message: "Order ID is required." },
          { status: 400 },
        );
      }

      const sub = existing;

      if (sub.pending_order_id !== orderId) {
        // PayPal can re-navigate the browser here after the upgrade already
        // finished. If this tenant's order is COMPLETED, the work is done.
        const order = await fetchPaypalOrder(orderId);
        const completed =
          String(order.status ?? "").toUpperCase() === "COMPLETED";
        const purchaseUnit = (
          order.purchase_units as Array<{ custom_id?: string }> | undefined
        )?.[0];

        if (completed && purchaseUnit?.custom_id === tenantId) {
          const plan = await loadPlan(admin, sub.plan_id);

          return Response.json({
            success: true,
            planName: plan?.name ?? undefined,
            alreadyActivated: true,
          });
        }

        return Response.json(
          { success: false, message: "Upgrade not found for this tenant." },
          { status: 404 },
        );
      }

      // Resolve the target plan BEFORE capturing. Once PayPal holds the money,
      // a failed lookup would leave a charge with no invoice and no upgrade.
      const plan = await loadPlan(admin, sub.pending_plan_id);

      if (!plan) {
        console.error("[billing] pending upgrade has no plan:", {
          tenant_id: tenantId,
          order_id: orderId,
        });
        return Response.json(
          { success: false, message: "Target plan not found." },
          { status: 404 },
        );
      }

      const agreementId = sub.paypal_subscription_id;

      if (!agreementId) {
        return Response.json(
          { success: false, message: "No PayPal subscription to revise." },
          { status: 400 },
        );
      }

      const captureResult = await capturePaypalOrder(orderId);
      let capture: CapturedOrder = captureResult.ok ? captureResult : {};

      if (!captureResult.ok) {
        const alreadyCaptured =
          captureResult.issue === "ORDER_ALREADY_CAPTURED" ||
          /already/i.test(captureResult.error || "");

        if (!alreadyCaptured) {
          return Response.json(
            {
              success: false,
              message: captureResult.error || "Payment capture failed.",
            },
            { status: 400 },
          );
        }

        // This fallback carries no capture details, and the invoice below is
        // keyed on the capture id. Re-read the order so a paid upgrade is not
        // left without its invoice.
        capture = parseCompletedOrder(await fetchPaypalOrder(orderId));
      }

      const currentPlan = await loadPlan(admin, sub.plan_id);

      logBilling("upgrade.captured", {
        tenant_id: tenantId,
        paypal_subscription_id: agreementId,
        order_id: orderId,
        current_plan: currentPlan?.name,
        target_plan: plan.name,
        amount: capture.amount,
      });

      await recordUpgradeInvoice(admin, {
        sub,
        plan,
        capture,
        billingEmail: user.email ?? undefined,
      });

      // Upgrading supersedes a scheduled cancellation: resume the agreement so
      // it can be revised, and drop the pending downgrade/cancellation.
      const lookup = await paypal.get(agreementId);
      let liveStatus = lookup.status;

      if (lookup.ok && lookup.status === "SUSPENDED") {
        await paypal.setState(
          agreementId,
          "activate",
          "Customer upgraded the subscription",
        );

        liveStatus = (await paypal.get(agreementId)).status;
      }

      if (!canRevise(liveStatus)) {
        // The money is in but the agreement cannot take the new plan. Nothing
        // is invented here (never a second agreement): the pending order stays
        // so reconcile-subscriptions retries the revise, and support can see
        // exactly what is outstanding.
        //
        // A CANCELLED/EXPIRED agreement is the end of the line -- PayPal can
        // never revive it, so no retry will ever apply this plan.
        const stuck = isDead(liveStatus);

        console.error(
          stuck
            ? "[billing] PAID UPGRADE IS STUCK: the agreement is dead, so the " +
                "plan can never be applied. Apply it manually or refund the order."
            : "[billing] captured upgrade not applied yet: agreement is not ACTIVE",
          {
            tenant_id: tenantId,
            paypal_subscription_id: agreementId,
            paypal_status: liveStatus,
            order_id: orderId,
          },
        );

        return Response.json(
          stuck
            ? { success: false, message: UPGRADE_STUCK_MESSAGE }
            : {
                success: true,
                message: UPGRADE_PENDING_MESSAGE,
                planName: plan.name,
                nextBilling: priceOf(plan),
                subscriptionId: agreementId,
              },
          { status: stuck ? 502 : 200 },
        );
      }

      const revise = await paypal.revise(
        agreementId,
        plan.code,
        approvalRedirect,
      );

      if (!revise.ok) {
        // PLAN_PRODUCT_NOT_COMPATIBLE is permanent: PayPal only revises
        // between plans of the SAME product, so retrying can never succeed.
        // Both plans have to live under one product for upgrades to work.
        const stuck = revise.issue === "PLAN_PRODUCT_NOT_COMPATIBLE";

        console.error(
          stuck
            ? "[billing] PAID UPGRADE IS STUCK: the target plan is on a " +
                "different PayPal product, which /revise cannot bridge. Move " +
                "both plans under one product, then apply or refund this order."
            : "[billing] revise failed after a captured upgrade; will retry:",
          {
            tenant_id: tenantId,
            paypal_subscription_id: agreementId,
            order_id: orderId,
            current_plan: currentPlan?.name,
            target_plan: plan.name,
            issue: revise.issue,
          },
        );

        return Response.json(
          stuck
            ? { success: false, message: UPGRADE_STUCK_MESSAGE }
            : {
                success: true,
                message: UPGRADE_PENDING_MESSAGE,
                planName: plan.name,
                nextBilling: priceOf(plan),
                subscriptionId: agreementId,
              },
          { status: stuck ? 502 : 200 },
        );
      }

      // PayPal is asking the buyer to confirm the revise, which the upgrade
      // flow deliberately does not do any more: they have already paid the
      // difference, so they are sent straight back to billing.
      //
      // That means the plan is NOT live yet -- PayPal keeps billing the old
      // rate until someone approves. The pending order stays set so
      // reconcile-subscriptions retries, and BILLING.SUBSCRIPTION.UPDATED
      // applies it if the change is ever approved. The approval link is still
      // returned for a client that wants it, but nothing uses it today.
      if (revise.approveUrl) {
        console.error(
          "[billing] PAID UPGRADE NEEDS BUYER APPROVAL, which the flow no " +
            "longer asks for: the plan will not change until this is " +
            "approved. Check that the target plan is on the same PayPal " +
            "product as the current one.",
          {
            tenant_id: tenantId,
            paypal_subscription_id: agreementId,
            order_id: orderId,
            current_plan: currentPlan?.name,
            target_plan: plan.name,
          },
        );

        return Response.json({
          success: true,
          message: UPGRADE_PENDING_MESSAGE,
          planName: plan.name,
          nextBilling: priceOf(plan),
          subscriptionId: agreementId,
          approvalUrl: revise.approveUrl,
        });
      }

      const refreshed = await paypal.get(agreementId);

      // The billing cycle does not restart on an upgrade: the agreement keeps
      // its own next_billing_time and charges the new rate then.
      await applySubscriptionPlan(asBillingAdmin(admin), {
        tenantId,
        planId: plan.id,
        status: "active",
        seats: seatsOf(plan),
        periodEnd:
          nextBillingTime(refreshed.data) ?? sub.current_period_end ?? null,
      });

      await storePayPalPaymentMethod(asPaymentMethodAdmin(admin), {
        tenantId,
        subscriptionRowId: sub.id,
        paypalSubscriptionId: agreementId,
        subscriber: capture.payerId
          ? {
              payer_id: capture.payerId,
              email_address: capture.payerEmail ?? user.email ?? undefined,
            }
          : undefined,
        context: "subscription:capture-order",
      });

      logBilling("upgrade.applied", {
        tenant_id: tenantId,
        paypal_subscription_id: agreementId,
        current_plan: currentPlan?.name,
        target_plan: plan.name,
        amount: capture.amount,
      });

      return Response.json({
        success: true,
        message: "Payment received. Your new plan is active.",
        planName: plan.name,
        nextBilling: priceOf(plan),
        subscriptionId: agreementId,
      });
    }

    // =================================================================
    // resume-approval -- the buyer paid the upgrade difference but never
    // confirmed the new recurring rate with PayPal (they closed the tab).
    //
    // The money is already in and the plan is owed, so this NEVER charges
    // again: it only asks PayPal for a fresh approve link for the same
    // agreement and the same pending plan. Revising an ACTIVE agreement that
    // already has an unapproved revise simply replaces that pending change.
    // =================================================================
    if (action === "resume-approval") {
      const sub = existing;

      if (!sub.pending_order_id || !sub.pending_plan_id) {
        return Response.json(
          { success: false, message: "No upgrade is awaiting confirmation." },
          { status: 400 },
        );
      }

      // Only ever for an upgrade that is genuinely PAID. Without this check a
      // caller could use this action to skip the checkout entirely.
      const order = await fetchPaypalOrder(sub.pending_order_id);

      if (String(order.status ?? "").toUpperCase() !== "COMPLETED") {
        return Response.json(
          {
            success: false,
            message:
              "This upgrade has not been paid yet. Please complete the checkout first.",
          },
          { status: 409 },
        );
      }

      const plan = await loadPlan(admin, sub.pending_plan_id);
      const agreementId = sub.paypal_subscription_id;

      if (!plan || !agreementId) {
        return Response.json(
          { success: false, message: "Target plan not found." },
          { status: 404 },
        );
      }

      const lookup = await paypal.get(agreementId);

      if (!lookup.ok) {
        return Response.json(
          {
            success: false,
            message: "Could not reach PayPal. Please try again in a moment.",
          },
          { status: 502 },
        );
      }

      // PayPal is already on the target plan: the revise was approved and only
      // the local write was lost. Finish it here instead of sending the buyer
      // back to approve something that is already done.
      if (String(lookup.data.plan_id ?? "") === plan.code) {
        await applySubscriptionPlan(asBillingAdmin(admin), {
          tenantId,
          planId: plan.id,
          status: "active",
          seats: seatsOf(plan),
          periodEnd:
            nextBillingTime(lookup.data) ?? sub.current_period_end ?? null,
        });

        logBilling("upgrade.applied", {
          tenant_id: tenantId,
          paypal_subscription_id: agreementId,
          target_plan: plan.name,
          context: "resume-approval",
        });

        return Response.json({
          success: true,
          message: "Your new plan is active.",
          planName: plan.name,
        });
      }

      if (!canRevise(lookup.status)) {
        console.error("[billing] cannot resume upgrade approval:", {
          tenant_id: tenantId,
          paypal_subscription_id: agreementId,
          paypal_status: lookup.status,
          order_id: sub.pending_order_id,
        });

        return Response.json(
          { success: false, message: UPGRADE_STUCK_MESSAGE },
          { status: 502 },
        );
      }

      const revise = await paypal.revise(
        agreementId,
        plan.code,
        approvalRedirect,
      );

      if (!revise.ok) {
        return Response.json(
          { success: false, message: UPGRADE_STUCK_MESSAGE },
          { status: 502 },
        );
      }

      logBilling("upgrade.approval-resumed", {
        tenant_id: tenantId,
        paypal_subscription_id: agreementId,
        order_id: sub.pending_order_id,
        target_plan: plan.name,
        needs_approval: Boolean(revise.approveUrl),
      });

      // No approve link means PayPal took the change outright -- apply it.
      if (!revise.approveUrl) {
        const refreshed = await paypal.get(agreementId);

        await applySubscriptionPlan(asBillingAdmin(admin), {
          tenantId,
          planId: plan.id,
          status: "active",
          seats: seatsOf(plan),
          periodEnd:
            nextBillingTime(refreshed.data) ?? sub.current_period_end ?? null,
        });

        return Response.json({
          success: true,
          message: "Your new plan is active.",
          planName: plan.name,
        });
      }

      return Response.json({
        success: true,
        message: "Please confirm the new monthly rate with PayPal.",
        planName: plan.name,
        approvalUrl: revise.approveUrl,
      });
    }

    // =================================================================
    // cancel
    // =================================================================
    if (action === "cancel") {
      // Checked at runtime: a non-string reason would otherwise fail the
      // cancellation-reason insert, and that failure is only logged.
      const reason =
        typeof body?.reason === "string" && body.reason.trim()
          ? body.reason
          : undefined;

      const sub = await reconcilePendingCheckout(admin, existing);
      const currentPlan = await loadPlan(admin, sub.plan_id);

      if (priceOf(currentPlan) === 0) {
        return Response.json(
          { success: false, message: "You are already on the Free plan." },
          { status: 400 },
        );
      }

      const freePlan = await loadFreePlan(admin);

      if (!freePlan) {
        console.error("[billing] free plan lookup failed");
        return Response.json(
          { success: false, message: "Could not find the Free plan." },
          { status: 500 },
        );
      }

      return await scheduleCancellation(admin, {
        sub,
        currentPlan,
        freePlan,
        reason,
      });
    }

    // =================================================================
    // activate -- the buyer came back from PayPal's approval page
    // =================================================================
    if (action === "activate") {
      const sub = existing;

      // PayPal sometimes returns to the success page without a token (the
      // redirect landing twice, a manual revisit), so fall back to whatever
      // this tenant has outstanding.
      const targetSubscriptionId: string | null =
        subscriptionId ??
        sub.pending_paypal_subscription_id ??
        sub.paypal_subscription_id;

      if (!targetSubscriptionId) {
        return Response.json(
          { success: false, message: "Subscription ID is required." },
          { status: 400 },
        );
      }

      const lookup = await paypal.get(targetSubscriptionId);

      if (!lookup.ok) {
        return Response.json(
          {
            success: false,
            message: "Could not verify the subscription with PayPal.",
          },
          { status: 502 },
        );
      }

      const customId = String(lookup.data.custom_id ?? "");

      if (customId && customId !== tenantId) {
        console.error("[billing] PayPal subscription custom_id mismatch:", {
          tenant_id: tenantId,
          paypal_subscription_id: targetSubscriptionId,
        });
        return Response.json({
          success: false,
          message: "Subscription does not belong to this tenant.",
        });
      }

      // The agreement this tenant signed up with, awaiting approval.
      if (sub.pending_paypal_subscription_id === targetSubscriptionId) {
        if (lookup.status !== "ACTIVE" && lookup.status !== "APPROVED") {
          return Response.json({
            success: false,
            message:
              "This subscription was not approved with PayPal. Please complete the checkout before we can activate your plan.",
            status: lookup.status,
          });
        }

        const plan = await loadPlan(admin, sub.pending_plan_id);

        if (!plan) {
          return Response.json(
            { success: false, message: "Target plan not found." },
            { status: 404 },
          );
        }

        const activation = await activatePendingAgreement(
          asBillingAdmin(admin),
          paypal,
          {
            sub,
            agreementId: targetSubscriptionId,
            plan,
            paypalData: lookup.data,
            context: "subscription:activate",
          },
        );

        // Approved but not charged. Reporting success here is how a buyer
        // with no balance ends up believing they are on a paid plan, so say
        // what is actually true and let PAYMENT.SALE.COMPLETED finish it.
        if (!activation.applied) {
          return Response.json({
            success: false,
            message:
              activation.paymentStatus === "failed"
                ? "PayPal could not take your first payment, so your plan has not started. Check your PayPal balance or payment method and try again."
                : "PayPal has your approval but has not taken the payment yet. Your plan will start as soon as it clears — you don't need to pay again.",
            planName: plan.name,
            paymentStatus: activation.paymentStatus,
          });
        }

        return Response.json({
          success: true,
          message: "Subscription activated successfully.",
          planName: plan.name,
        });
      }

      // The tenant's existing agreement: either an upgrade whose revise the
      // buyer has just approved, or a duplicate return with nothing to do.
      if (
        sub.paypal_subscription_id === targetSubscriptionId &&
        sub.pending_plan_id
      ) {
        const plan = await loadPlan(admin, sub.pending_plan_id);
        const paypalPlanCode = String(lookup.data.plan_id ?? "");

        if (plan && paypalPlanCode === plan.code) {
          // Not necessarily an upgrade: a DOWNGRADE awaiting approval is
          // parked in pending_plan_id too, and applying that here would hand
          // the buyer the cheaper plan the moment they approved -- cutting
          // short the period they had already paid for at the higher rate.
          // The shared helper decides now-or-at-period-end from the prices.
          const livePlan = await loadPlan(admin, sub.plan_id);

          const { scheduledFor } = await applyApprovedPlanChange(
            asBillingAdmin(admin),
            {
              sub,
              plan,
              currentPlan: livePlan,
              paypalData: lookup.data,
              context: "subscription:activate",
            },
          );

          return Response.json({
            success: true,
            scheduled: scheduledFor !== null,
            effectiveAt: scheduledFor,
            message: scheduledFor
              ? "Plan change confirmed. Your current plan stays active until the end of the billing period."
              : "Subscription activated successfully.",
            planName: plan.name,
          });
        }
      }

      // A scheduled downgrade the buyer has just confirmed with PayPal. The
      // agreement now bills the cheaper plan from its next cycle, but the
      // tenant keeps the plan they PAID for until next_plan_effective_at, so
      // nothing is applied here.
      if (
        sub.paypal_subscription_id === targetSubscriptionId &&
        sub.next_plan_id
      ) {
        const nextPlan = await loadPlan(admin, sub.next_plan_id);
        const paypalPlanCode = String(lookup.data.plan_id ?? "");

        if (nextPlan && paypalPlanCode === nextPlan.code) {
          logBilling("downgrade.confirmed", {
            tenant_id: tenantId,
            paypal_subscription_id: targetSubscriptionId,
            target_plan: nextPlan.name,
            effective_at: sub.next_plan_effective_at,
          });

          return Response.json({
            success: true,
            scheduled: true,
            effectiveAt: sub.next_plan_effective_at,
            planName: nextPlan.name,
            message:
              "Plan change confirmed. Your current plan stays active until the end of the billing period.",
          });
        }
      }

      const currentPlan = await loadPlan(admin, sub.plan_id);

      return Response.json({
        success: true,
        message: "Subscription already activated.",
        planName: currentPlan?.name ?? null,
      });
    }

    // Anything past this point is treated as "create". An action this build
    // does not know about is almost always a version skew -- the caller was
    // deployed with a newer contract than this function -- and silently
    // falling through to create would either report a nonsense error or, with
    // a planId attached, open a real PayPal subscription nobody asked for.
    if (action !== "create") {
      console.error(`Unsupported subscription action: ${action}`);
      return Response.json(
        {
          success: false,
          message:
            `This action ("${action}") is not available on the deployed ` +
            `subscription function. Redeploy it to enable it.`,
        },
        { status: 400 },
      );
    }

    // =================================================================
    // create -- the tenant picked a plan
    // =================================================================
    if (!planId) {
      return Response.json(
        { success: false, message: "Plan ID is required." },
        { status: 400 },
      );
    }

    const { data: targetPlanRow, error: planError } = await admin
      .from("plans")
      .select(PLAN_COLUMNS)
      .eq("id", planId)
      .eq("is_active", true)
      .single();

    if (planError || !targetPlanRow) {
      console.error("Plan lookup failed:", planError);
      return Response.json(
        { success: false, message: "Plan not found." },
        { status: 404 },
      );
    }

    const targetPlan = targetPlanRow as PlanRow;

    // Settle any checkout still open first, so the decision below is taken
    // against the agreement the tenant actually has.
    const sub = await reconcilePendingCheckout(admin, existing);
    const currentPlan = await loadPlan(admin, sub.plan_id);

    const currentPrice = priceOf(currentPlan);
    const targetPrice = priceOf(targetPlan);

    const agreementId = sub.paypal_subscription_id;
    const lookup = agreementId ? await paypal.get(agreementId) : null;
    let agreementStatus = lookup?.status ?? "";

    // "Live" means PayPal can still act on it. A SUSPENDED agreement (a
    // scheduled cancellation) is live: it is resumed rather than replaced.
    const hasLiveAgreement = Boolean(
      agreementId &&
      lookup?.ok &&
      (agreementStatus === "ACTIVE" || agreementStatus === "SUSPENDED"),
    );

    logBilling("plan-change.requested", {
      tenant_id: tenantId,
      paypal_subscription_id: agreementId,
      paypal_status: lookup?.status,
      current_plan: currentPlan?.name,
      target_plan: targetPlan.name,
      amount: targetPrice,
    });

    if (sub.plan_id === targetPlan.id && !sub.next_plan_id) {
      return Response.json(
        {
          success: false,
          message: `You are already on the ${targetPlan.name} plan.`,
        },
        { status: 400 },
      );
    }

    // Choosing a PAID plan supersedes whatever was scheduled: the tenant is
    // staying. A cancellation left the agreement SUSPENDED, so it is resumed
    // first -- the row must never read "active" against an agreement PayPal
    // has stopped billing. (Picking Free instead falls through to
    // scheduleCancellation below, which rewrites the same fields.)
    if (targetPrice > 0 && sub.next_plan_id) {
      if (
        agreementId &&
        sub.cancel_at_period_end &&
        agreementStatus === "SUSPENDED"
      ) {
        const resumed = await paypal.setState(
          agreementId,
          "activate",
          "Customer chose a new plan",
        );

        if (!resumed) {
          return Response.json(
            {
              success: false,
              message:
                "PayPal could not resume your subscription. Please try again.",
            },
            { status: 502 },
          );
        }

        agreementStatus = "ACTIVE";
      }

      const { error: supersedeError } = await admin
        .from("subscriptions")
        .update({
          next_plan_id: null,
          next_plan_effective_at: null,
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId);

      if (supersedeError) {
        console.error("[billing] could not drop the scheduled change:", {
          tenant_id: tenantId,
          error: supersedeError,
        });
        return Response.json(
          { success: false, message: "Failed to record plan change." },
          { status: 500 },
        );
      }

      logBilling("scheduled-change.superseded", {
        tenant_id: tenantId,
        paypal_subscription_id: agreementId,
        target_plan: targetPlan.name,
      });

      // They picked the plan they are already on: the scheduled change was
      // simply cancelled, and nothing else needs to happen.
      if (sub.plan_id === targetPlan.id) {
        return Response.json({
          success: true,
          message: `Your plan change was cancelled. You stay on ${targetPlan.name}.`,
          subscriptionId: agreementId,
          approvalUrl: null,
          amountDue: 0,
        });
      }
    }

    // ---- Paid -> Free : a cancellation by another name -------------------
    if (targetPrice === 0) {
      const freePlan = targetPlan;

      if (currentPrice === 0 && !hasLiveAgreement) {
        return Response.json(
          { success: false, message: "You are already on the Free plan." },
          { status: 400 },
        );
      }

      return await scheduleCancellation(admin, {
        sub,
        currentPlan,
        freePlan,
      });
    }

    // A tenant that has an agreement id on file HAS an agreement until PayPal
    // itself says otherwise. A lookup that merely failed -- a timeout, a 5xx,
    // a rate limit -- is not PayPal saying otherwise, and falling through on
    // it would create a SECOND agreement while the first is still billing.
    // One tenant, one agreement: when we cannot see it, we change nothing.
    if (agreementId && !lookup?.ok) {
      console.error(
        "[billing] refusing to change plan: the tenant's PayPal subscription " +
          "could not be read, so a second one is not created",
        {
          tenant_id: tenantId,
          paypal_subscription_id: agreementId,
          http_status: lookup?.httpStatus,
          target_plan: targetPlan.name,
        },
      );

      return Response.json(
        {
          success: false,
          message:
            "We could not reach PayPal to check your subscription. Please try again in a moment.",
        },
        { status: 502 },
      );
    }

    // ---- Free -> Paid : the ONLY time an agreement is created ------------
    //
    // Reached only when PayPal was READ successfully and reported no usable
    // agreement: none on file, or one it will never bill again
    // (APPROVAL_PENDING that was abandoned, CANCELLED, EXPIRED). There is
    // nothing to revise in that state, so a new agreement is the only option.
    if (!hasLiveAgreement) {
      if (agreementId && lookup?.ok && !isDead(lookup.status)) {
        // APPROVAL_PENDING on the row: an older signup nobody finished.
        await paypal.cancel(agreementId, "Replaced by a new checkout");
      }

      // A signup this tenant already started. Handing back the same checkout
      // for the same plan keeps one agreement; for a different plan the old
      // one is cancelled, because an agreement the buyer could still approve
      // after we stopped tracking it would start billing for nothing.
      if (sub.pending_paypal_subscription_id) {
        const pendingLookup = await paypal.get(
          sub.pending_paypal_subscription_id,
        );

        if (pendingLookup.ok && pendingLookup.status === "APPROVAL_PENDING") {
          const approveUrl = (
            pendingLookup.data.links as
              Array<{ rel: string; href: string }> | undefined
          )?.find((link) => link.rel === "approve")?.href;

          if (sub.pending_plan_id === targetPlan.id && approveUrl) {
            logBilling("signup.resumed", {
              tenant_id: tenantId,
              paypal_subscription_id: sub.pending_paypal_subscription_id,
              target_plan: targetPlan.name,
            });

            return Response.json({
              success: true,
              message: "Please complete your PayPal checkout.",
              subscriptionId: sub.pending_paypal_subscription_id,
              approvalUrl: approveUrl,
              amountDue: targetPrice,
            });
          }

          await paypal.cancel(
            sub.pending_paypal_subscription_id,
            "Replaced by a new checkout",
          );
        }
      }

      const created = await createPaypalSubscription({
        planCode: targetPlan.code,
        tenantId,
        tenantSlug,
        email: user.email ?? "",
      });

      if (!created.ok || !created.subscriptionId || !created.approvalUrl) {
        return Response.json(
          {
            success: false,
            message: created.error ?? "Approval URL not returned by PayPal.",
            details: created.details ?? null,
            debug_id: created.debugId ?? null,
          },
          { status: 400 },
        );
      }

      const { error: pendingError } = await admin
        .from("subscriptions")
        .update({
          pending_plan_id: targetPlan.id,
          pending_order_id: null,
          pending_paypal_subscription_id: created.subscriptionId,
          pending_started_at: new Date().toISOString(),
          // The agreement exists at PayPal but nothing has been charged. Said
          // out loud from the start, so the window between "checkout created"
          // and "buyer came back" is not indistinguishable from a healthy
          // subscription that simply has no payment recorded yet.
          payment_status: "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId);

      if (pendingError) {
        console.error("[billing] could not record the pending signup:", {
          tenant_id: tenantId,
          error: pendingError,
        });

        await paypal.cancel(
          created.subscriptionId,
          "Could not record the checkout",
        );

        return Response.json(
          { success: false, message: "Failed to record plan change." },
          { status: 500 },
        );
      }

      logBilling("signup.created", {
        tenant_id: tenantId,
        paypal_subscription_id: created.subscriptionId,
        current_plan: currentPlan?.name,
        target_plan: targetPlan.name,
        amount: targetPrice,
      });

      return Response.json({
        success: true,
        message: "PayPal subscription created successfully.",
        subscriptionId: created.subscriptionId,
        approvalUrl: created.approvalUrl,
        amountDue: targetPrice,
      });
    }

    // ---- Paid -> Paid downgrade : scheduled, same agreement --------------
    const periodEnd = sub.current_period_end
      ? new Date(sub.current_period_end)
      : null;
    const hasPaidTime = periodEnd !== null && periodEnd.getTime() > Date.now();

    if (targetPrice < currentPrice && hasPaidTime && periodEnd) {
      // ASK PAYPAL FIRST, then record what it actually accepted.
      //
      // The schedule used to be written before this call, on the reasoning
      // that a failed revise should still leave the cron something to apply.
      // But PayPal answers a plan change with an approve link when it wants
      // the buyer to confirm, and a buyer who closes that page has confirmed
      // nothing -- while the row already said the downgrade was scheduled.
      // Clicking "Downgrade" and then Back was enough to change the plan.
      //
      // Nothing is committed here until either PayPal applies the change
      // outright, or BILLING.SUBSCRIPTION.UPDATED says the buyer approved it.
      const revise = await paypal.revise(
        agreementId!,
        targetPlan.code,
        approvalRedirect,
      );

      if (!revise.ok) {
        console.error("[billing] downgrade revise failed; nothing scheduled:", {
          tenant_id: tenantId,
          paypal_subscription_id: agreementId,
          current_plan: currentPlan?.name,
          target_plan: targetPlan.name,
          issue: revise.issue,
        });

        return Response.json(
          {
            success: false,
            message:
              "PayPal could not change your plan. Please try again in a moment.",
          },
          { status: 502 },
        );
      }

      // Waiting on the buyer. The intent is parked in pending_* -- which is
      // what "the buyer has not finished this" already means everywhere else
      // -- and deliberately NOT in next_plan_*, which the billing page and
      // the cron both read as a committed change. An abandoned one expires on
      // the same TTL as any other unfinished checkout.
      if (revise.approveUrl) {
        const { error: pendingError } = await admin
          .from("subscriptions")
          .update({
            pending_plan_id: targetPlan.id,
            pending_order_id: null,
            pending_paypal_subscription_id: null,
            pending_started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("tenant_id", tenantId);

        if (pendingError) {
          console.error("[billing] could not record the pending downgrade:", {
            tenant_id: tenantId,
            error: pendingError,
          });
        }

        logBilling("downgrade.awaiting-approval", {
          tenant_id: tenantId,
          paypal_subscription_id: agreementId,
          current_plan: currentPlan?.name,
          target_plan: targetPlan.name,
        });

        return Response.json({
          success: true,
          scheduled: false,
          message:
            "Please confirm the change with PayPal. Nothing changes until you do.",
          subscriptionId: agreementId,
          approvalUrl: revise.approveUrl,
          amountDue: 0,
        });
      }

      // PayPal took the change without asking the buyer, so it is settled:
      // it bills the lower rate from the next cycle. The tenant keeps the
      // plan they paid for until periodEnd -- entitlements come from
      // subscriptions.plan_id, which does not move until then.
      const { error: scheduleError } = await admin
        .from("subscriptions")
        .update({
          next_plan_id: targetPlan.id,
          next_plan_effective_at: periodEnd.toISOString(),
          cancel_at_period_end: false,
          pending_plan_id: null,
          pending_order_id: null,
          pending_paypal_subscription_id: null,
          pending_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId);

      if (scheduleError) {
        console.error("[billing] could not schedule the downgrade:", {
          tenant_id: tenantId,
          error: scheduleError,
        });
        return Response.json(
          { success: false, message: "Failed to schedule plan change." },
          { status: 500 },
        );
      }

      logBilling("downgrade.scheduled", {
        tenant_id: tenantId,
        paypal_subscription_id: agreementId,
        current_plan: currentPlan?.name,
        target_plan: targetPlan.name,
        amount: targetPrice,
        effective_at: periodEnd.toISOString(),
        revised: true,
        needs_approval: false,
      });

      return Response.json({
        success: true,
        scheduled: true,
        effectiveAt: periodEnd.toISOString(),
        message:
          "Plan change scheduled. Your current plan stays active until the end of the billing period.",
        subscriptionId: agreementId,
        approvalUrl: null,
        amountDue: 0,
      });
    }

    // ---- Paid -> Paid upgrade --------------------------------------------
    //
    // The difference, and nothing else: Pro $29 -> Business $59 is $30 today.
    // No prorated days, no credit for unused time -- the tenant has already
    // paid $29 for this period and pays the $30 that makes it a $59 period.
    const amountDue = round2(Math.max(0, targetPrice - currentPrice));

    if (amountDue > 0) {
      // An upgrade order this tenant already started. It must be resolved
      // before another one is created -- a second order for the same upgrade
      // is a second real charge.
      if (sub.pending_order_id) {
        const existingOrder = await fetchPaypalOrder(sub.pending_order_id);
        const orderStatus = String(existingOrder.status ?? "").toUpperCase();

        // ALREADY PAID. The money is in and only the PayPal-side plan move is
        // outstanding (reconcile-subscriptions retries it). Charging again
        // here would bill the same upgrade twice, so this is refused outright
        // -- whatever plan was asked for.
        if (orderStatus === "COMPLETED") {
          const paidPlan = await loadPlan(admin, sub.pending_plan_id);

          logBilling("upgrade.awaiting-apply", {
            tenant_id: tenantId,
            paypal_subscription_id: agreementId,
            order_id: sub.pending_order_id,
            current_plan: currentPlan?.name,
            target_plan: paidPlan?.name,
          });

          return Response.json(
            {
              success: false,
              message:
                `Your payment for the ${paidPlan?.name ?? "upgrade"} upgrade ` +
                `has already been received and is still being applied. ` +
                `Please wait a few minutes rather than paying again — ` +
                `contact support if your plan has not changed within an hour.`,
            },
            { status: 409 },
          );
        }

        // Not paid yet: hand back the same checkout instead of opening a
        // second one. PayPal expires an unpaid order on its own, and the fetch
        // then returns nothing, so a stale one never blocks a fresh checkout.
        if (
          sub.pending_plan_id === targetPlan.id &&
          (orderStatus === "CREATED" || orderStatus === "APPROVED")
        ) {
          const approveUrl = (
            existingOrder.links as
              Array<{ rel: string; href: string }> | undefined
          )?.find((link) => link.rel === "approve")?.href;

          if (approveUrl) {
            logBilling("upgrade.order-resumed", {
              tenant_id: tenantId,
              paypal_subscription_id: agreementId,
              order_id: sub.pending_order_id,
              target_plan: targetPlan.name,
              amount: amountDue,
            });

            return Response.json({
              success: true,
              message:
                "Upgrade payment created. Please complete payment to activate your new plan.",
              subscriptionId: sub.pending_order_id,
              approvalUrl: approveUrl,
              amountDue,
            });
          }
        }
      }

      const description =
        `ServiceDesk ${targetPlan.name} upgrade ` +
        `($${targetPrice.toFixed(2)} - $${currentPrice.toFixed(2)} ` +
        `${currentPlan?.name ?? "current plan"})`;

      const order = await createPaypalOrder({
        amount: amountDue,
        description,
        customId: tenantId,
        return_url: `${FRONTEND_URL}/${tenantSlug}/payment/success`,
        cancel_url: `${FRONTEND_URL}/${tenantSlug}/payment/cancel`,
      });

      if (!order.ok || !order.orderId) {
        return Response.json(
          {
            success: false,
            message: order.error || "Failed to create payment.",
          },
          { status: 400 },
        );
      }

      const { error: pendingError } = await admin
        .from("subscriptions")
        .update({
          pending_plan_id: targetPlan.id,
          pending_order_id: order.orderId,
          pending_paypal_subscription_id: null,
          pending_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId);

      if (pendingError) {
        console.error("[billing] could not record the pending upgrade:", {
          tenant_id: tenantId,
          error: pendingError,
        });
        return Response.json(
          { success: false, message: "Failed to record plan change." },
          { status: 500 },
        );
      }

      logBilling("upgrade.order-created", {
        tenant_id: tenantId,
        paypal_subscription_id: agreementId,
        order_id: order.orderId,
        current_plan: currentPlan?.name,
        target_plan: targetPlan.name,
        amount: amountDue,
      });

      return Response.json({
        success: true,
        message:
          "Upgrade payment created. Please complete payment to activate your new plan.",
        subscriptionId: order.orderId,
        approvalUrl: order.approveUrl,
        amountDue,
      });
    }

    // Nothing to collect today (same price, or a downgrade with no paid time
    // left): revise the existing agreement straight away.
    let liveStatus = agreementStatus;

    if (agreementId && liveStatus === "SUSPENDED") {
      await paypal.setState(agreementId, "activate", "Customer changed plan");

      liveStatus = (await paypal.get(agreementId)).status;
    }

    if (!agreementId || !canRevise(liveStatus)) {
      console.error("[billing] agreement cannot be revised:", {
        tenant_id: tenantId,
        paypal_subscription_id: agreementId,
        paypal_status: liveStatus,
      });
      return Response.json(
        {
          success: false,
          message:
            "PayPal could not change your subscription right now. Please try again in a moment.",
        },
        { status: 502 },
      );
    }

    const revise = await paypal.revise(
      agreementId,
      targetPlan.code,
      approvalRedirect,
    );

    if (!revise.ok) {
      return Response.json(
        {
          success: false,
          message:
            "PayPal could not change your subscription right now. Please try again in a moment.",
        },
        { status: 502 },
      );
    }

    if (revise.approveUrl) {
      // Record what the approval is for so BILLING.SUBSCRIPTION.UPDATED can
      // apply it. No order is attached: there is nothing to pay today.
      await admin
        .from("subscriptions")
        .update({
          pending_plan_id: targetPlan.id,
          pending_order_id: null,
          pending_paypal_subscription_id: null,
          pending_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId);

      return Response.json({
        success: true,
        message: "Please confirm your plan change with PayPal.",
        subscriptionId: agreementId,
        approvalUrl: revise.approveUrl,
        amountDue: 0,
      });
    }

    const refreshed = await paypal.get(agreementId);

    await applySubscriptionPlan(asBillingAdmin(admin), {
      tenantId,
      planId: targetPlan.id,
      status: "active",
      seats: seatsOf(targetPlan),
      periodEnd:
        nextBillingTime(refreshed.data) ?? sub.current_period_end ?? null,
    });

    logBilling("plan-change.applied", {
      tenant_id: tenantId,
      paypal_subscription_id: agreementId,
      current_plan: currentPlan?.name,
      target_plan: targetPlan.name,
      amount: 0,
    });

    return Response.json({
      success: true,
      message: "Your plan has been changed.",
      subscriptionId: agreementId,
      approvalUrl: null,
      amountDue: 0,
    });
  } catch (error) {
    console.error("Subscription Edge Function Error:", error);
    return Response.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 },
    );
  }
});
