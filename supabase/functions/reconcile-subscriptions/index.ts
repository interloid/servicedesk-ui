import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPayPalTokenProvider } from "../_shared/paypal-auth.ts";
import {
  applySubscriptionPlan,
  canCancel,
  canRevise,
  createPayPalSubscriptionsClient,
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

// Hourly backstop for everything that has to happen without a browser open.
//
//   1. a scheduled plan change that has come due -> REVISE the tenant's one
//      agreement onto the new plan
//   2. a scheduled cancellation that has come due -> cancel that agreement for
//      good, move the tenant to Free and forget the agreement id
//   3. an upgrade whose order was captured but whose revise did not go
//      through -> retry the revise (the money is already in)
//   4. a checkout nobody finished -> drop it
//
// Every step is idempotent. Plan changes are applied through
// apply_subscription_plan with the change itself as the claim, so a second
// run (an overlap, a manual re-trigger) writes nothing. No step can create a
// PayPal subscription: the only place that happens is a Free -> Paid signup.

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
const billingAdmin = admin as unknown as BillingAdminClient;

const getAccessToken = createPayPalTokenProvider({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  baseUrl: BASE_URL,
});

const paypal = createPayPalSubscriptionsClient({
  baseUrl: BASE_URL,
  getAccessToken,
});

// Matches the subscription function: a checkout nobody finished in a day is
// not a plan change any more.
const PENDING_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

async function loadPlan(planId: string | null): Promise<PlanRow | null> {
  if (!planId) return null;

  const { data } = await admin
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .maybeSingle();

  return (data as PlanRow | null) ?? null;
}

async function fetchOrder(orderId: string): Promise<Record<string, unknown>> {
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

async function clearPendingCheckout(tenantId: string) {
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
    throw error;
  }
}

/**
 * Writes any recurring charges the SALE webhook did not record.
 *
 * Idempotent through the unique paypal_txn_id, so a re-run adds nothing. It
 * covers only the tenant's one agreement -- there is never another to look at.
 */
async function backfillInvoices(
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
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.error(
      `PayPal transactions for ${paypalSubscriptionId} failed:`,
      response.status,
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

type Outcome = "applied" | "notReady" | "skipped";

/**
 * A cancellation that has reached its period end: the agreement is cancelled
 * for good, the tenant moves to Free and the id is dropped so nothing can ever
 * call PayPal with it again.
 *
 * Re-running is safe: PayPal reports an already-cancelled agreement as
 * CANCELLED (no second call is made), and the plan write is claimed on
 * next_plan_id, which the first run cleared.
 */
async function finishCancellation(
  sub: SubscriptionRow,
  freePlan: PlanRow,
): Promise<Outcome> {
  const agreementId = sub.paypal_subscription_id;

  if (agreementId) {
    const lookup = await paypal.get(agreementId);

    if (!lookup.ok) {
      // PayPal is unreachable or erroring. Leave the change pending; the plan
      // is only moved once the agreement is provably stopped.
      return "notReady";
    }

    if (canCancel(lookup.status)) {
      const cancelled = await paypal.cancel(
        agreementId,
        "Subscription cancelled by customer",
      );

      if (!cancelled) {
        return "notReady";
      }
    }
  }

  const applied = await applySubscriptionPlan(billingAdmin, {
    tenantId: sub.tenant_id,
    planId: freePlan.id,
    status: "active",
    seats: seatsOf(freePlan),
    periodStart: new Date().toISOString(),
    clearPeriodEnd: true,
    clearPaypalSubscriptionId: true,
    expectedNextPlanId: sub.next_plan_id,
  });

  logBilling("cron.cancellation.applied", {
    tenant_id: sub.tenant_id,
    paypal_subscription_id: agreementId,
    target_plan: freePlan.name,
    applied,
  });

  return applied ? "applied" : "skipped";
}

/**
 * A scheduled paid downgrade that has come due: the SAME agreement is revised
 * onto the cheaper plan. Nothing is created and nothing is cancelled.
 */
async function applyScheduledPlanChange(
  sub: SubscriptionRow,
  targetPlan: PlanRow,
  freePlan: PlanRow | null,
): Promise<{ outcome: Outcome; invoicesWritten: number }> {
  const agreementId = sub.paypal_subscription_id;

  if (!agreementId) {
    // No agreement to revise (the tenant is effectively unbilled): apply the
    // plan locally so the row cannot stay stuck on a change that can never
    // happen.
    const applied = await applySubscriptionPlan(billingAdmin, {
      tenantId: sub.tenant_id,
      planId: targetPlan.id,
      status: "active",
      seats: seatsOf(targetPlan),
      expectedNextPlanId: sub.next_plan_id,
    });

    return { outcome: applied ? "applied" : "skipped", invoicesWritten: 0 };
  }

  const lookup = await paypal.get(agreementId);

  if (!lookup.ok) {
    return { outcome: "notReady", invoicesWritten: 0 };
  }

  // A dead agreement can never take a new plan, and the paid period it was
  // scheduled against has just ended -- there is nothing left to bill the
  // tenant with. Free is the only consistent end state; retrying the revise
  // forever would leave the change stuck for good.
  if (!canRevise(lookup.status)) {
    if (lookup.status === "CANCELLED" || lookup.status === "EXPIRED") {
      const landingPlan = freePlan ?? targetPlan;

      const applied = await applySubscriptionPlan(billingAdmin, {
        tenantId: sub.tenant_id,
        planId: landingPlan.id,
        status: "active",
        seats: seatsOf(landingPlan),
        periodStart: new Date().toISOString(),
        clearPeriodEnd: true,
        clearPaypalSubscriptionId: true,
        expectedNextPlanId: sub.next_plan_id,
      });

      logBilling("cron.plan-change.agreement-dead", {
        tenant_id: sub.tenant_id,
        paypal_subscription_id: agreementId,
        paypal_status: lookup.status,
        target_plan: landingPlan.name,
        applied,
      });

      return { outcome: applied ? "applied" : "skipped", invoicesWritten: 0 };
    }

    // SUSPENDED / APPROVAL_PENDING: it may still recover, so try again later.
    return { outcome: "notReady", invoicesWritten: 0 };
  }

  // PayPal already bills this plan: an earlier run revised the agreement and
  // only the local write was lost. Revising to the same plan again would just
  // be rejected, which would leave the change stuck for good.
  const alreadyOnPlan = String(lookup.data.plan_id ?? "") === targetPlan.code;

  const revise = alreadyOnPlan
    ? { ok: true, approveUrl: null as string | null, issue: null }
    : await paypal.revise(agreementId, targetPlan.code);

  if (!revise.ok) {
    console.error("[billing] scheduled revise failed:", {
      tenant_id: sub.tenant_id,
      paypal_subscription_id: agreementId,
      target_plan: targetPlan.name,
      issue: revise.issue,
    });

    return { outcome: "notReady", invoicesWritten: 0 };
  }

  // PayPal wants the buyer to confirm. A downgrade normally does not, so this
  // is logged loudly; the change stays pending and
  // BILLING.SUBSCRIPTION.UPDATED applies it if the buyer ever approves.
  if (revise.approveUrl) {
    console.error(
      "[billing] scheduled plan change needs buyer approval; not applied:",
      {
        tenant_id: sub.tenant_id,
        paypal_subscription_id: agreementId,
        target_plan: targetPlan.name,
      },
    );

    return { outcome: "notReady", invoicesWritten: 0 };
  }

  const refreshed = alreadyOnPlan ? lookup : await paypal.get(agreementId);
  const periodEnd = nextBillingTime(refreshed.data);

  const applied = await applySubscriptionPlan(billingAdmin, {
    tenantId: sub.tenant_id,
    planId: targetPlan.id,
    status: "active",
    seats: seatsOf(targetPlan),
    periodStart: new Date().toISOString(),
    periodEnd: periodEnd ?? sub.current_period_end ?? null,
    expectedNextPlanId: sub.next_plan_id,
  });

  logBilling("cron.plan-change.applied", {
    tenant_id: sub.tenant_id,
    paypal_subscription_id: agreementId,
    target_plan: targetPlan.name,
    amount: priceOf(targetPlan),
    applied,
  });

  if (!applied) {
    return { outcome: "skipped", invoicesWritten: 0 };
  }

  const invoicesWritten = await backfillInvoices(
    sub.tenant_id,
    agreementId,
    periodEnd ?? sub.current_period_end ?? null,
  );

  return { outcome: "applied", invoicesWritten };
}

/**
 * An upgrade whose one-time order was captured but whose revise never landed
 * (PayPal was down, the browser died between the two). The money is in, so the
 * plan is owed: retry the revise on the SAME agreement.
 */
async function retryCapturedUpgrade(sub: SubscriptionRow): Promise<Outcome> {
  const orderId = sub.pending_order_id;
  const agreementId = sub.paypal_subscription_id;

  if (!orderId) return "skipped";

  const order = await fetchOrder(orderId);
  const completed = String(order.status ?? "").toUpperCase() === "COMPLETED";

  const startedAt = sub.pending_started_at
    ? new Date(sub.pending_started_at).getTime()
    : 0;
  const expired = Date.now() - startedAt > PENDING_CHECKOUT_TTL_MS;

  if (!completed) {
    // Never paid: after the TTL it is simply an abandoned checkout.
    if (expired) {
      await clearPendingCheckout(sub.tenant_id);

      logBilling("cron.checkout.expired", {
        tenant_id: sub.tenant_id,
        order_id: orderId,
      });

      return "applied";
    }

    return "notReady";
  }

  const targetPlan = await loadPlan(sub.pending_plan_id);

  if (!targetPlan || !agreementId) {
    return "notReady";
  }

  const lookup = await paypal.get(agreementId);

  if (!lookup.ok || !canRevise(lookup.status)) {
    return "notReady";
  }

  // PayPal already bills this plan: the revise went through and only the
  // local write was lost.
  const alreadyOnPlan = String(lookup.data.plan_id ?? "") === targetPlan.code;

  const revise = alreadyOnPlan
    ? { ok: true, approveUrl: null as string | null }
    : await paypal.revise(agreementId, targetPlan.code);

  if (!revise.ok || revise.approveUrl) {
    return "notReady";
  }

  const refreshed = alreadyOnPlan ? lookup : await paypal.get(agreementId);

  await applySubscriptionPlan(billingAdmin, {
    tenantId: sub.tenant_id,
    planId: targetPlan.id,
    status: "active",
    seats: seatsOf(targetPlan),
    periodEnd:
      nextBillingTime(refreshed.data) ?? sub.current_period_end ?? null,
  });

  logBilling("cron.upgrade.recovered", {
    tenant_id: sub.tenant_id,
    paypal_subscription_id: agreementId,
    order_id: orderId,
    target_plan: targetPlan.name,
    amount: priceOf(targetPlan),
  });

  return "applied";
}

/** A Free -> Paid checkout the buyer never approved. */
async function expireAbandonedSignup(sub: SubscriptionRow): Promise<Outcome> {
  const pendingId = sub.pending_paypal_subscription_id;

  if (!pendingId) return "skipped";

  const lookup = await paypal.get(pendingId);

  // Approved in the meantime: the ACTIVATED webhook (or the next page load)
  // applies it. Nothing to expire.
  if (
    lookup.ok &&
    (lookup.status === "ACTIVE" || lookup.status === "APPROVED")
  ) {
    return "notReady";
  }

  const startedAt = sub.pending_started_at
    ? new Date(sub.pending_started_at).getTime()
    : 0;

  if (Date.now() - startedAt <= PENDING_CHECKOUT_TTL_MS) {
    return "notReady";
  }

  if (lookup.ok && canCancel(lookup.status)) {
    await paypal.cancel(pendingId, "Checkout abandoned");
  }

  await clearPendingCheckout(sub.tenant_id);

  logBilling("cron.checkout.expired", {
    tenant_id: sub.tenant_id,
    paypal_subscription_id: pendingId,
    paypal_status: lookup.status,
  });

  return "applied";
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

  // No secret check here on purpose: the function runs behind the gateway with
  // verify_jwt = true, and pg_cron calls it with the service role key as a
  // bearer token (see the note on [functions.reconcile-subscriptions] in
  // supabase/config.toml). An x-cron-secret header was tried before and
  // arrived empty, which 401'd every scheduled run.

  const summary = {
    examined: 0,
    applied: 0,
    notReady: 0,
    abandoned: 0,
    failed: 0,
    invoicesWritten: 0,
  };

  try {
    const nowIso = new Date().toISOString();

    // Plan changes that have come due.
    const { data: dueRows, error: dueError } = await admin
      .from("subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .not("next_plan_id", "is", null)
      .lte("next_plan_effective_at", nowIso);

    if (dueError) {
      throw dueError;
    }

    // Checkouts that need finishing or expiring.
    const { data: pendingRows, error: pendingError } = await admin
      .from("subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .not("pending_plan_id", "is", null);

    if (pendingError) {
      throw pendingError;
    }

    const due = (dueRows ?? []) as unknown as SubscriptionRow[];
    const pending = (pendingRows ?? []) as unknown as SubscriptionRow[];

    summary.examined = due.length + pending.length;

    if (summary.examined === 0) {
      return Response.json({ success: true, ...summary });
    }

    const { data: freePlanRow } = await admin
      .from("plans")
      .select(PLAN_COLUMNS)
      .eq("price_month", 0)
      .eq("is_active", true)
      .order("seat_limit", { ascending: true })
      .limit(1)
      .maybeSingle();

    const freePlan = (freePlanRow as PlanRow | null) ?? null;

    for (const sub of due) {
      try {
        const targetPlan = await loadPlan(sub.next_plan_id);

        if (!targetPlan) {
          throw new Error(
            `Plan ${sub.next_plan_id} scheduled for tenant ` +
              `${sub.tenant_id} no longer exists.`,
          );
        }

        const isCancellation =
          sub.cancel_at_period_end === true || priceOf(targetPlan) === 0;

        const result = isCancellation
          ? {
              outcome: await finishCancellation(sub, freePlan ?? targetPlan),
              invoicesWritten: 0,
            }
          : await applyScheduledPlanChange(sub, targetPlan, freePlan);

        summary.invoicesWritten += result.invoicesWritten;

        if (result.outcome === "applied") summary.applied += 1;
        else if (result.outcome === "notReady") summary.notReady += 1;
        else summary.abandoned += 1;
      } catch (subError) {
        summary.failed += 1;

        console.error(
          `Reconciling subscription for tenant ${sub.tenant_id} failed:`,
          subError,
        );
      }
    }

    for (const sub of pending) {
      try {
        const outcome = sub.pending_order_id
          ? await retryCapturedUpgrade(sub)
          : await expireAbandonedSignup(sub);

        if (outcome === "applied") summary.applied += 1;
        else if (outcome === "notReady") summary.notReady += 1;
        else summary.abandoned += 1;
      } catch (pendingCheckoutError) {
        summary.failed += 1;

        console.error(
          `Reconciling checkout for tenant ${sub.tenant_id} failed:`,
          pendingCheckoutError,
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
