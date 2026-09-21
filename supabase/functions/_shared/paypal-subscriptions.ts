// The PayPal recurring-agreement calls and the local "apply a plan change"
// write, shared by every function that changes billing state.
//
// ONE AGREEMENT PER TENANT
// ------------------------
// A paying tenant has exactly one PayPal recurring subscription for its whole
// life as a customer. A paid -> paid plan change REVISES that agreement, so
// `subscriptions.paypal_subscription_id` never changes; only Free -> Paid
// creates an agreement, because a free tenant has none (its
// `paypal_subscription_id` is NULL -- there are no synthetic ids).
//
// Every call here therefore takes a real agreement id. Callers must never pass
// a placeholder, and must check the agreement's live status before choosing an
// action: PayPal refuses to revise anything that is not ACTIVE, and can never
// revive a CANCELLED agreement.

import { storePayPalPaymentMethod } from "./paypal-payment-method.ts";

// PayPal responses are free-form JSON; each reader validates the fields it
// needs.
type AnyRecord = Record<string, unknown>;

/** Every billing decision reads the same columns. */
export const SUBSCRIPTION_COLUMNS = [
  "id",
  "tenant_id",
  "plan_id",
  "paypal_subscription_id",
  "status",
  "seats",
  "current_period_start",
  "current_period_end",
  "cancel_at_period_end",
  "next_plan_id",
  "next_plan_effective_at",
  "pending_plan_id",
  "pending_order_id",
  "pending_paypal_subscription_id",
  "pending_started_at",
  "payment_failure_count",
  "last_payment_failure_at",
  "grace_period_ends_at",
  "cancelled_at",
  "cancellation_source",
  "paypal_status",
  "payment_status",
].join(", ");

export type SubscriptionRow = {
  id: string;
  tenant_id: string;
  plan_id: string;
  paypal_subscription_id: string | null;
  status: string;
  seats: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  next_plan_id: string | null;
  next_plan_effective_at: string | null;
  pending_plan_id: string | null;
  pending_order_id: string | null;
  pending_paypal_subscription_id: string | null;
  pending_started_at: string | null;
  /** Consecutive failed recurring charges; 0 while the agreement is healthy. */
  payment_failure_count: number | null;
  last_payment_failure_at: string | null;
  /**
   * Set when PayPal SUSPENDS the agreement for non-payment. The tenant keeps
   * their plan until it passes; the cron drops them to Free afterwards.
   */
  grace_period_ends_at: string | null;
  cancelled_at: string | null;
  /** Who ended it; null while the subscription is live. */
  cancellation_source: CancellationSource | null;
  /** PayPal's last known status for the agreement. Display cache only. */
  paypal_status: PayPalSubscriptionStatus | null;
  /** Whether PayPal has collected. A paid plan is only live while 'paid'. */
  payment_status: PaymentStatus | null;
};

/**
 * Who ended the subscription.
 *
 * It decides whether "Reactivate" is offered at all: only a `customer`
 * cancellation leaves a SUSPENDED agreement PayPal can resume. A `paypal` or
 * `system` one leaves a CANCELLED agreement that can never come back, so the
 * tenant has to subscribe again.
 */
export type CancellationSource = "customer" | "paypal" | "system";

/**
 * How long a tenant keeps their plan after PayPal gives up retrying.
 *
 * Long enough for a billing admin to notice the mail and fix a card over a
 * weekend, short enough that unpaid access is not indefinite.
 */
export const PAYMENT_GRACE_DAYS = 7;

/** Every field that says "this subscription is in payment trouble". */
export const HEALTHY_PAYMENT_STATE = {
  payment_failure_count: 0,
  last_payment_failure_at: null,
  grace_period_ends_at: null,
} as const;

export const PLAN_COLUMNS = "id, name, code, price_month, seat_limit";

export type PlanRow = {
  id: string;
  name: string;
  code: string;
  price_month: number | string;
  seat_limit: number | null;
};

export function priceOf(plan: PlanRow | null | undefined): number {
  return Number(plan?.price_month ?? 0);
}

export function seatsOf(plan: PlanRow | null | undefined): number {
  return plan?.seat_limit ?? 1;
}

// The call sites build their Supabase client from different import specifiers,
// so the client is accepted structurally instead of by type.
export type BillingAdminClient = {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural client (see deno note)
  from: (table: string) => any;
  rpc: (
    fn: string,
    args: AnyRecord,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/** PayPal statuses a subscription can be in. */
export type PayPalSubscriptionStatus =
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "ACTIVE"
  | "SUSPENDED"
  | "CANCELLED"
  | "EXPIRED"
  | "";

export interface PayPalSubscriptionLookup {
  /** False when PayPal could not be reached or returned an error. */
  ok: boolean;
  status: PayPalSubscriptionStatus;
  httpStatus: number;
  data: AnyRecord;
}

/**
 * PayPal's status as a storable value: the lookup helpers use "" to mean
 * "could not read it", which is not a status and must not be written as one.
 */
export function storableStatus(
  status: PayPalSubscriptionStatus,
): Exclude<PayPalSubscriptionStatus, ""> | null {
  return status === "" ? null : status;
}

/** Only an ACTIVE agreement can be revised onto another plan. */
export function canRevise(status: PayPalSubscriptionStatus): boolean {
  return status === "ACTIVE";
}

/** A cancel call only makes sense while PayPal can still bill the agreement. */
export function canCancel(status: PayPalSubscriptionStatus): boolean {
  return (
    status === "ACTIVE" ||
    status === "SUSPENDED" ||
    status === "APPROVAL_PENDING" ||
    status === "APPROVED"
  );
}

/** PayPal can never revive these, whatever the local state says. */
export function isDead(status: PayPalSubscriptionStatus): boolean {
  return status === "CANCELLED" || status === "EXPIRED";
}

export function createPayPalSubscriptionsClient({
  baseUrl,
  getAccessToken,
}: {
  baseUrl: string;
  getAccessToken: () => Promise<string>;
}) {
  const authHeaders = async () => ({
    Authorization: `Bearer ${await getAccessToken()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  /** Reads the live agreement. Never throws: callers branch on `ok`. */
  const get = async (
    subscriptionId: string,
  ): Promise<PayPalSubscriptionLookup> => {
    const response = await fetch(
      `${baseUrl}/v1/billing/subscriptions/${subscriptionId}`,
      { headers: await authHeaders() },
    );

    const data = (await response.json().catch(() => ({}))) as AnyRecord;

    if (!response.ok) {
      console.error("[paypal] subscription lookup failed:", {
        paypal_subscription_id: subscriptionId,
        http_status: response.status,
        paypal_status: data?.name ?? null,
      });

      return { ok: false, status: "", httpStatus: response.status, data };
    }

    return {
      ok: true,
      status: String(
        data.status ?? "",
      ).toUpperCase() as PayPalSubscriptionStatus,
      httpStatus: response.status,
      data,
    };
  };

  /**
   * Cancels an agreement for good.
   *
   * Two responses mean there is nothing left to cancel, and both are normal:
   *   404 RESOURCE_NOT_FOUND        -- an abandoned APPROVAL_PENDING agreement
   *     PayPal has purged; the id 404s forever after.
   *   422 SUBSCRIPTION_STATUS_INVALID -- it exists but is already CANCELLED or
   *     EXPIRED, or was never approved.
   * Both resolve to `true` so a caller is never blocked by work already done.
   */
  const cancel = async (
    subscriptionId: string,
    reason: string,
  ): Promise<boolean> => {
    const response = await fetch(
      `${baseUrl}/v1/billing/subscriptions/${subscriptionId}/cancel`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ reason }),
      },
    );

    if (response.ok) return true;

    const body = await response.text();

    if (
      response.status === 404 ||
      (response.status === 422 && body.includes("SUBSCRIPTION_STATUS_INVALID"))
    ) {
      return true;
    }

    console.error("[paypal] subscription cancel failed:", {
      paypal_subscription_id: subscriptionId,
      http_status: response.status,
      body,
    });

    return false;
  };

  /**
   * Suspend / resume. A scheduled cancellation SUSPENDS rather than cancels,
   * because PayPal can never revive a CANCELLED agreement and "Reactivate"
   * has to keep billing on the same one without a new checkout. The agreement
   * is cancelled for good at the period end.
   */
  const setState = async (
    subscriptionId: string,
    state: "suspend" | "activate",
    reason: string,
  ): Promise<boolean> => {
    const response = await fetch(
      `${baseUrl}/v1/billing/subscriptions/${subscriptionId}/${state}`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ reason }),
      },
    );

    if (response.ok) return true;

    console.error(`[paypal] subscription ${state} failed:`, {
      paypal_subscription_id: subscriptionId,
      http_status: response.status,
      body: await response.text(),
    });

    return false;
  };

  /**
   * Moves the EXISTING agreement onto another plan, keeping its id. This is
   * the only way a paid tenant changes plan.
   *
   * PayPal may answer with an `approve` link when the buyer has to confirm the
   * change (it does for a price increase). The plan is then live only once the
   * buyer approves, which arrives as BILLING.SUBSCRIPTION.UPDATED.
   *
   * `redirect` is REQUIRED whenever a buyer could be sent to that approve
   * link. PayPal's hosted approval page needs a return_url to hand the buyer
   * back to, and without one it refuses to render -- the buyer gets
   * "Things don't appear to be working at the moment" instead of the
   * confirmation screen. Callers with no browser in the loop (the cron) may
   * omit it: they only log the link, never open it.
   */
  const revise = async (
    subscriptionId: string,
    planCode: string,
    redirect?: { returnUrl: string; cancelUrl: string; brandName?: string },
  ): Promise<{
    ok: boolean;
    httpStatus: number;
    approveUrl: string | null;
    issue: string | null;
    data: AnyRecord;
  }> => {
    const response = await fetch(
      `${baseUrl}/v1/billing/subscriptions/${subscriptionId}/revise`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          plan_id: planCode,
          ...(redirect
            ? {
                application_context: {
                  brand_name: redirect.brandName ?? "ServiceDesk",
                  user_action: "SUBSCRIBE_NOW",
                  return_url: redirect.returnUrl,
                  cancel_url: redirect.cancelUrl,
                },
              }
            : {}),
        }),
      },
    );

    const data = (await response.json().catch(() => ({}))) as AnyRecord;

    const links = data.links as
      Array<{ rel: string; href: string }> | undefined;
    const details = Array.isArray(data.details) ? data.details : [];

    if (!response.ok) {
      console.error("[paypal] subscription revise failed:", {
        paypal_subscription_id: subscriptionId,
        plan_code: planCode,
        http_status: response.status,
        issue: (details[0] as { issue?: string } | undefined)?.issue ?? null,
        name: data?.name ?? null,
      });
    }

    return {
      ok: response.ok,
      httpStatus: response.status,
      approveUrl: links?.find((link) => link.rel === "approve")?.href ?? null,
      issue: (details[0] as { issue?: string } | undefined)?.issue ?? null,
      data,
    };
  };

  return { get, cancel, setState, revise };
}

export type PayPalSubscriptionsClient = ReturnType<
  typeof createPayPalSubscriptionsClient
>;

/** PayPal reports the next charge here; it is our period end. */
export function nextBillingTime(
  subscription: AnyRecord | null | undefined,
): string | null {
  const billingInfo = subscription?.billing_info as
    { next_billing_time?: string } | undefined;

  return billingInfo?.next_billing_time ?? null;
}

export type PaymentStatus = "pending" | "paid" | "failed";

/**
 * Whether PayPal has actually COLLECTED on this agreement.
 *
 * The agreement's own status cannot answer this. APPROVED means the buyer
 * approved it and nothing has been charged; ACTIVE means PayPal considers it
 * live, which it also does while a failed first charge sits on it as an
 * outstanding balance. Reading status alone is how an unfunded buyer ends up
 * on a paid plan.
 *
 * billing_info is the honest source:
 *
 *   last_payment            a completed charge -- the only proof of money
 *   failed_payments_count   charges PayPal tried and lost
 *   outstanding_balance     what the agreement still owes
 *
 * A failure is reported even when a previous cycle was paid: the balance is
 * owed now, and the dunning flow is what handles it.
 */
export function paymentStatusOf(
  subscription: AnyRecord | null | undefined,
): PaymentStatus {
  const billingInfo = subscription?.billing_info as
    | {
        last_payment?: { amount?: { value?: string } };
        failed_payments_count?: number;
        outstanding_balance?: { value?: string };
      }
    | undefined;

  if (!billingInfo) {
    return "pending";
  }

  const outstanding = Number(billingInfo.outstanding_balance?.value ?? 0);
  const failures = Number(billingInfo.failed_payments_count ?? 0);

  if (failures > 0 || outstanding > 0) {
    return "failed";
  }

  const lastPaid = Number(billingInfo.last_payment?.amount?.value ?? 0);

  // A zero-value last_payment is not a payment. Free trials and $0 plans do
  // not reach here: only a PAID plan is gated on this.
  return lastPaid > 0 ? "paid" : "pending";
}

/** The plan code PayPal currently bills the agreement on. */
export function currentPlanCode(
  subscription: AnyRecord | null | undefined,
): string | null {
  const planId = subscription?.plan_id;

  return typeof planId === "string" && planId ? planId : null;
}

export interface ApplyPlanParams {
  tenantId: string;
  /** Null keeps the current plan (e.g. only refreshing the period). */
  planId?: string | null;
  status?: "trialing" | "active" | "past_due" | "cancelled" | "expired";
  seats?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  /** Writes NULL over current_period_end (a Free plan has no billing period). */
  clearPeriodEnd?: boolean;
  paypalSubscriptionId?: string | null;
  /** Writes NULL over paypal_subscription_id (the tenant has no agreement). */
  clearPaypalSubscriptionId?: boolean;
  /** Defaults to true: a plan change always ends the checkout that caused it. */
  clearPending?: boolean;
  /** Defaults to true: a plan change supersedes any scheduled change. */
  clearNext?: boolean;
  /**
   * Turns the call into a claim: the write only lands while next_plan_id still
   * matches, so a second concurrent run (a cron overlap, a redelivered
   * webhook) applies nothing and returns false.
   */
  expectedNextPlanId?: string | null;
}

/**
 * Writes a plan change to `subscriptions` AND `tenants` in one transaction, so
 * the two can never disagree. Returns false when the claim did not match.
 */
export async function applySubscriptionPlan(
  admin: BillingAdminClient,
  params: ApplyPlanParams,
): Promise<boolean> {
  const { data, error } = await admin.rpc("apply_subscription_plan", {
    p_tenant_id: params.tenantId,
    p_plan_id: params.planId ?? null,
    p_status: params.status ?? null,
    p_seats: params.seats ?? null,
    p_current_period_start: params.periodStart ?? null,
    p_current_period_end: params.periodEnd ?? null,
    p_clear_period_end: params.clearPeriodEnd ?? false,
    p_paypal_subscription_id: params.paypalSubscriptionId ?? null,
    p_clear_paypal_subscription_id: params.clearPaypalSubscriptionId ?? false,
    p_clear_pending: params.clearPending ?? true,
    p_clear_next: params.clearNext ?? true,
    p_expected_next_plan_id: params.expectedNextPlanId ?? null,
  });

  if (error) {
    console.error("[billing] apply_subscription_plan failed:", {
      tenant_id: params.tenantId,
      plan_id: params.planId,
      error,
    });
    throw new Error("Failed to save the plan change.");
  }

  return data === true;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Puts the tenant onto `plan` on the strength of `agreementId`, and records
 * the payment method.
 *
 * THE PAID PLAN IS NOT APPLIED UNTIL PAYPAL HAS COLLECTED. An approved
 * agreement is not a paid one: see paymentStatusOf. When nothing has been
 * charged the agreement is still recorded -- the tenant keeps whatever plan
 * they had, the checkout stays pending, and PAYMENT.SALE.COMPLETED applies
 * the plan when the money actually lands.
 *
 * The return value says whether the plan was applied, so callers can tell the
 * buyer the truth.
 *
 * If the row still points at a DIFFERENT live agreement (a replacement created
 * before this architecture, or one that was mid-flight when it shipped), that
 * one is cancelled here: two live agreements would bill the tenant twice.
 *
 * Shared by the `activate` action and the ACTIVATED webhook so the two can
 * never drift apart.
 */
export async function activatePendingAgreement(
  admin: BillingAdminClient,
  paypal: PayPalSubscriptionsClient,
  params: {
    sub: Pick<SubscriptionRow, "id" | "tenant_id" | "paypal_subscription_id">;
    agreementId: string;
    plan: PlanRow;
    paypalData: AnyRecord;
    context: string;
  },
): Promise<{ applied: boolean; paymentStatus: PaymentStatus }> {
  const { sub, agreementId, plan, paypalData } = params;
  const now = new Date().toISOString();
  const periodEnd =
    nextBillingTime(paypalData) ??
    new Date(Date.now() + 30 * DAY_MS).toISOString();

  const previousAgreementId = sub.paypal_subscription_id;
  const paymentStatus = paymentStatusOf(paypalData);

  // Approved but unfunded: record what PayPal told us and stop. Applying the
  // plan here is exactly the bug -- a buyer with no balance would get the paid
  // plan for free until the cron or a failed-payment webhook caught up.
  if (paymentStatus !== "paid" && priceOf(plan) > 0) {
    await admin
      .from("subscriptions")
      .update({
        payment_status: paymentStatus,
        paypal_status: storableStatus(
          String(paypalData?.status ?? "") as PayPalSubscriptionStatus,
        ),
        updated_at: now,
      })
      .eq("tenant_id", sub.tenant_id);

    logBilling("agreement.unpaid", {
      tenant_id: sub.tenant_id,
      paypal_subscription_id: agreementId,
      target_plan: plan.name,
      payment_status: paymentStatus,
      context: params.context,
    });

    return { applied: false, paymentStatus };
  }

  await applySubscriptionPlan(admin, {
    tenantId: sub.tenant_id,
    planId: plan.id,
    status: "active",
    seats: seatsOf(plan),
    periodStart: now,
    periodEnd,
    paypalSubscriptionId: agreementId,
  });

  // A NEW agreement wipes the last one's ending. Left behind, a stale
  // cancellation_source would tell the billing page this live subscription
  // cannot be reactivated, and a stale cancelled_at would date it to the
  // previous subscription.
  //
  // Deliberately not folded into apply_subscription_plan: that runs on every
  // plan change, including the cron's move to Free, where the cancellation is
  // the reason for the write and must survive it.
  await admin
    .from("subscriptions")
    .update({
      cancelled_at: null,
      cancellation_source: null,
      paypal_status: "ACTIVE",
      payment_status: "paid",
      ...HEALTHY_PAYMENT_STATE,
      updated_at: now,
    })
    .eq("tenant_id", sub.tenant_id);

  logBilling("agreement.activated", {
    tenant_id: sub.tenant_id,
    paypal_subscription_id: agreementId,
    target_plan: plan.name,
    period_end: periodEnd,
    context: params.context,
  });

  if (previousAgreementId && previousAgreementId !== agreementId) {
    const previous = await paypal.get(previousAgreementId);

    if (previous.ok && canCancel(previous.status)) {
      const cancelled = await paypal.cancel(
        previousAgreementId,
        `Superseded by ${agreementId}`,
      );

      logBilling("agreement.superseded", {
        tenant_id: sub.tenant_id,
        paypal_subscription_id: previousAgreementId,
        paypal_status: previous.status,
        cancelled,
      });
    }
  }

  await storePayPalPaymentMethod(admin, {
    tenantId: sub.tenant_id,
    subscriptionRowId: sub.id,
    paypalSubscriptionId: agreementId,
    subscriber: paypalData.subscriber,
    fetchSubscriber: async () => {
      const fresh = await paypal.get(agreementId);
      return fresh.data.subscriber ?? null;
    },
    context: params.context,
  });

  return { applied: true, paymentStatus: "paid" };
}

/** Rounds money to cents without float drift creeping into a PayPal amount. */
export function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * One structured line per billing decision. Ids, plans, amounts and PayPal
 * status only -- never tokens, card data or payer identity.
 */
export function logBilling(
  action: string,
  fields: Record<string, string | number | boolean | null | undefined>,
) {
  console.log(
    `[billing] ${action}`,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      ),
    ),
  );
}
