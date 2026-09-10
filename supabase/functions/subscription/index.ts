import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  storePayPalPaymentMethod,
  type PayPalSubscriber,
} from "../_shared/paypal-payment-method.ts";

type SubscriptionSwitchRow = {
  id: string;
  plan_id: string;
  paypal_subscription_id: string;
  old_paypal_subscription_id?: string | null;
  status: string;
  tenant_id: string;
  effective_at?: string | null;
};

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

async function getAccessToken(): Promise<string> {
  const credentials = `${CLIENT_ID}:${CLIENT_SECRET}`;
  const encodedCredentials = btoa(credentials);
  const tokenUrl = `${BASE_URL}/v1/oauth2/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodedCredentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  const responseText = await response.text();
  let data: {
    access_token?: string;
    error?: string;
    error_description?: string;
    message?: string;
    raw?: string;
  } = {};

  try {
    data = JSON.parse(responseText);
  } catch {
    data = { raw: responseText };
  }

  if (!response.ok) {
    console.error("PayPal Auth Error:", {
      status: response.status,
      error: data?.error,
      description: data?.error_description,
      message: data?.message,
    });
    throw new Error(
      `PayPal Auth Error: ${
        data?.error_description ?? data?.message ?? JSON.stringify(data)
      }`,
    );
  }

  if (!data?.access_token) {
    throw new Error(
      "PayPal authentication succeeded but no access token was returned.",
    );
  }

  return data.access_token;
}

/**
 * Mints the browser-safe client token PayPal's JS SDK v6 needs for
 * `createInstance({ clientToken, ... })`.
 *
 * `response_type=client_token` returns a short-lived (~15 min) token derived
 * from the merchant credentials. The credentials themselves never leave this
 * function -- the browser only ever receives the token, and it is minted only
 * after the caller's billing membership has been checked.
 *
 * `domains[]` binds the token to the origins allowed to use it. PayPal rejects
 * bare hosts like `localhost`, so it is sent only when PAYPAL_TOKEN_DOMAINS is
 * configured with real domains; omitting it yields an unbound token, which is
 * what local development uses.
 */
async function getSdkClientToken(): Promise<{
  token: string;
  expiresIn: number;
}> {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    response_type: "client_token",
  });

  const domains = (Deno.env.get("PAYPAL_TOKEN_DOMAINS") ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);

  for (const domain of domains) {
    params.append("domains[]", domain);
  }

  const response = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
    message?: string;
  };

  if (!response.ok || !data?.access_token) {
    // Never log the token itself, only why it could not be made.
    console.error("[PayPal] client token request failed:", {
      status: response.status,
      error: data?.error ?? data?.error_description ?? data?.message,
      domains: domains.length,
    });
    throw new Error(
      data?.error_description ??
        data?.message ??
        "PayPal did not return a client token.",
    );
  }

  console.log(
    `[PayPal] client token created (domains=${domains.length}, expires_in=${
      data.expires_in ?? 900
    })`,
  );

  return { token: data.access_token, expiresIn: data.expires_in ?? 900 };
}

// "FREE-<tenant>" placeholders are not real PayPal agreements and must never
// be sent to the cancel endpoint.
function isRealAgreement(id?: string | null): boolean {
  return Boolean(id && !id.startsWith("FREE-"));
}

async function cancelPayPalSubscription(
  accessToken: string,
  paypalSubscriptionId: string,
) {
  const response = await fetch(
    `${BASE_URL}/v1/billing/subscriptions/${paypalSubscriptionId}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Plan changed by customer" }),
    },
  );

  if (response.ok) return;

  const data = await response.text();

  // Cancelling is only meaningful for an agreement PayPal can still bill.
  // Two responses mean there is nothing left to cancel, and both are normal:
  //
  //   404 RESOURCE_NOT_FOUND       — PayPal has purged the record. Abandoned
  //     APPROVAL_PENDING subscriptions are not durable: the buyer never
  //     approved, so PayPal drops them and the id 404s forever after.
  //   422 SUBSCRIPTION_STATUS_INVALID — the agreement exists but is not in a
  //     cancellable state (APPROVAL_PENDING, or already CANCELLED/EXPIRED).
  //
  // Treating either as failure is what turned an abandoned checkout into a
  // hard error and blocked the plan change behind it.
  if (
    response.status === 404 ||
    (response.status === 422 && data.includes("SUBSCRIPTION_STATUS_INVALID"))
  ) {
    console.log(
      `PayPal subscription ${paypalSubscriptionId} is not cancellable ` +
        `(${response.status}); nothing to cancel.`,
    );
    return;
  }

  console.error(
    `PayPal cancel subscription ${paypalSubscriptionId} failed:`,
    response.status,
    data,
  );
  throw new Error(
    `Failed to cancel existing PayPal subscription: ${response.status}`,
  );
}

async function getPayPalSubscription(
  accessToken: string,
  subscriptionId: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(
    `${BASE_URL}/v1/billing/subscriptions/${subscriptionId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );

  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    console.error("PayPal subscription lookup failed:", {
      status: response.status,
      response: data,
    });
  }

  return { ok: response.ok, data };
}

async function capturePaypalOrder(
  accessToken: string,
  orderId: string,
): Promise<
  | {
      ok: true;
      payerId?: string;
      payerEmail?: string;
      txnId?: string;
      amount?: number;
      currency?: string;
    }
  | { ok: false; error: string; issue?: string }
> {
  const response = await fetch(
    `${BASE_URL}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );

  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    console.error("PayPal order capture failed:", {
      status: response.status,
      response: data,
    });
    const details = Array.isArray(data.details) ? data.details : [];
    const firstDetail = details[0] as { issue?: string } | undefined;
    return {
      ok: false,
      issue: firstDetail?.issue,
      error:
        firstDetail?.issue ??
        (data as { message?: string }).message ??
        "Capture failed",
    };
  }

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

  const capture = purchaseUnits?.[0]?.payments?.captures?.[0];
  const txnId = capture?.id;
  const amount = Number(capture?.amount?.value ?? 0);
  const currency = capture?.amount?.currency ?? "USD";

  return {
    ok: true,
    payerId: payer?.payer_id,
    payerEmail: payer?.email_address,
    txnId,
    amount,
    currency,
  };
}

async function createPaypalOrder(
  accessToken: string,
  params: {
    amount: number;
    description: string;
    customId: string;
    return_url: string;
    cancel_url: string;
  },
): Promise<{
  ok: boolean;
  orderId?: string;
  approveUrl?: string;
  error?: string;
}> {
  const response = await fetch(`${BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
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

  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    console.error("PayPal order creation failed:", {
      status: response.status,
      response: data,
    });
    return {
      ok: false,
      error: (data as { message?: string }).message || "Order creation failed",
    };
  }

  const orderId = data.id as string;
  const links = data.links as Array<{ rel: string; href: string }> | undefined;
  const approveUrl = links?.find((l) => l.rel === "approve")?.href;

  return { ok: true, orderId, approveUrl };
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

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
        {
          success: false,
          message: "Tenant not found.",
          details: tenantError?.message ?? null,
        },
        { status: 404 },
      );
    }

    const tenantId = tenant.id;

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

    // The browser needs a PayPal token to render hosted card fields. It is
    // minted only after the membership check above, so a token that can confirm
    // this tenant's subscription is never handed to someone who could not
    // change the plan anyway.
    if (action === "sdk-token") {
      return Response.json(
        {
          success: false,
          message: "Card payments are not supported. Please use PayPal wallet.",
        },
        { status: 400 },
      );
    }

    if (action === "abort") {
      const { data: pendingSwitch, error: switchLookupError } = await admin
        .from("subscription_switches")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (switchLookupError) {
        console.error("Pending switch lookup failed:", switchLookupError);
        return Response.json(
          {
            success: false,
            message: "Failed to look up the pending plan change.",
            details: switchLookupError.message,
          },
          { status: 500 },
        );
      }

      if (!pendingSwitch) {
        return Response.json({
          success: true,
          restored: false,
          message: "No pending plan change was found.",
        });
      }

      try {
        const accessToken = await getAccessToken();
        const { ok, data: paypalSub } = await getPayPalSubscription(
          accessToken,
          pendingSwitch.paypal_subscription_id,
        );
        const paypalStatus = String(paypalSub?.status ?? "").toUpperCase();

        if (ok && paypalStatus !== "ACTIVE" && paypalStatus !== "SUSPENDED") {
          await cancelPayPalSubscription(
            accessToken,
            pendingSwitch.paypal_subscription_id,
          );
        }
      } catch (error) {
        console.error("Abandoned PayPal subscription cancel failed:", error);
      }

      const now = new Date().toISOString();
      const restorePlanId = pendingSwitch.old_plan_id ?? tenant.plan_id ?? null;

      if (restorePlanId) {
        const { error: restoreSubError } = await admin
          .from("subscriptions")
          .update({
            plan_id: restorePlanId,
            paypal_subscription_id:
              pendingSwitch.old_paypal_subscription_id ?? `FREE-${tenantId}`,
            status: pendingSwitch.old_status ?? "active",
            seats: pendingSwitch.old_seats ?? 1,
            current_period_end: pendingSwitch.old_current_period_end ?? null,
            updated_at: now,
          })
          .eq("tenant_id", tenantId);

        if (restoreSubError) {
          console.error("Subscription restore failed:", restoreSubError);
          return Response.json(
            {
              success: false,
              message: `Failed to restore your previous plan: ${restoreSubError.message}`,
            },
            { status: 500 },
          );
        }

        const { error: restoreTenantError } = await admin
          .from("tenants")
          .update({ plan_id: restorePlanId, updated_at: now })
          .eq("id", tenantId);

        if (restoreTenantError) {
          console.error("Tenant plan restore failed:", restoreTenantError);
        }
      }

      const { error: cancelSwitchError } = await admin
        .from("subscription_switches")
        .update({ status: "cancelled", updated_at: now })
        .eq("id", pendingSwitch.id);

      if (cancelSwitchError) {
        console.error("Pending switch cancel failed:", cancelSwitchError);
      }

      const { data: restoredPlan } = await admin
        .from("plans")
        .select("name")
        .eq("id", restorePlanId as string)
        .maybeSingle();

      return Response.json({
        success: true,
        restored: true,
        message: "Your previous plan has been restored.",
        planName: restoredPlan?.name ?? null,
      });
    }

    // Capture the one-time upgrade PayPal order, then put the buyer onto the
    // target plan for recurring billing WITHOUT charging them again today:
    //   - existing agreement ACTIVE  -> revise it onto the new plan (no second
    //     subscription), PayPal bills the full rate at the next cycle.
    //   - agreement CANCELLED/etc.   -> it cannot be revised, so create a
    //     replacement subscription with a zero setup fee (the order already
    //     covered today's upgrade delta) and hand back its approve link. The
    //     standard ACTIVATED webhook / activate path then switches the plan.
    if (action === "capture-order") {
      const orderId = subscriptionId;

      if (!orderId) {
        return Response.json(
          { success: false, message: "Order ID is required." },
          { status: 400 },
        );
      }

      const { data: pendingSwitch, error: switchLookupError } = await admin
        .from("subscription_switches")
        .select("*")
        .eq("paypal_subscription_id", orderId)
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "approved"])
        .maybeSingle();

      if (switchLookupError) {
        console.error("Order switch lookup failed:", switchLookupError);
        return Response.json(
          { success: false, message: "Failed to look up the upgrade." },
          { status: 500 },
        );
      }

      if (!pendingSwitch) {
        // The switch may already be applied from a previous capture (PayPal can
        // re-navigate the browser to this page). Treat that as success instead
        // of a hard 404.
        const { data: appliedSwitch, error: appliedLookupError } = await admin
          .from("subscription_switches")
          .select("*")
          .eq("paypal_subscription_id", orderId)
          .eq("tenant_id", tenantId)
          .eq("status", "applied")
          .maybeSingle();

        if (appliedLookupError) {
          console.error("Applied switch lookup failed:", appliedLookupError);
          return Response.json(
            { success: false, message: "Failed to look up the upgrade." },
            { status: 500 },
          );
        }

        if (appliedSwitch) {
          console.log(
            `[subscription] capture-order re-entry: order ${orderId} already applied for tenant ${tenantId}.`,
          );
          const { data: appliedPlan } = await admin
            .from("plans")
            .select("name")
            .eq("id", appliedSwitch.plan_id)
            .maybeSingle();

          return Response.json({
            success: true,
            planName: appliedPlan?.name ?? undefined,
            alreadyActivated: true,
          });
        }

        return Response.json(
          { success: false, message: "Upgrade not found for this tenant." },
          { status: 404 },
        );
      }

      const accessToken = await getAccessToken();

      const captureResult = await capturePaypalOrder(accessToken, orderId);

      if (!captureResult.ok) {
        console.error("Order capture failed:", {
          issue: captureResult.issue,
          error: captureResult.error,
          orderId,
        });
        // If the order was already captured (e.g. a double submit or a retry
        // after a refresh), the money is in and we proceed with the upgrade.
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
        console.log(
          `[subscription] order ${orderId} already captured, continuing upgrade.`,
        );
      }

      const { data: plan, error: planError } = await admin
        .from("plans")
        .select("id, name, seat_limit, code, price_month")
        .eq("id", pendingSwitch.plan_id)
        .single();

      if (planError || !plan) {
        console.error("Plan lookup for subscription failed:", planError);
        return Response.json(
          { success: false, message: "Target plan not found." },
          { status: 404 },
        );
      }

      // Record the one-time upgrade payment as an invoice so the billing
      // dashboard's "Last payment" reflects what was actually charged today.
      // The invoice is typed one_time so the PDF describes it as a one-time
      // upgrade charge (never "recurring"), and the upcoming billing panel is
      // informational only -- the next monthly charge is NOT part of this total.
      const nowDateStr = new Date().toISOString();
      if (
        captureResult.txnId &&
        captureResult.amount &&
        captureResult.amount > 0
      ) {
        const { data: upgradeSub } = await admin
          .from("subscriptions")
          .select("paypal_subscription_id, current_period_end")
          .eq("tenant_id", tenantId)
          .maybeSingle();

        await admin
          .from("invoices")
          .insert({
            tenant_id: tenantId,
            paypal_txn_id: captureResult.txnId,
            amount: captureResult.amount,
            status: "paid",
            storage_path: null,
            period_start: nowDateStr.substring(0, 10),
            period_end: nowDateStr.substring(0, 10),
            plan_name: plan.name,
            seats: plan.seat_limit ?? 1,

            invoice_type: "one_time",
            currency: captureResult.currency ?? "USD",
            subtotal: captureResult.amount,
            tax: 0,
            amount_paid: captureResult.amount,
            balance_due: 0,
            payment_method: "PayPal",
            paid_at: nowDateStr,
            billing_email: captureResult.payerEmail ?? user.email ?? undefined,
            paypal_subscription_id: upgradeSub?.paypal_subscription_id ?? null,
            next_billing_date: upgradeSub?.current_period_end ?? null,
            next_billing_amount: Number(plan.price_month ?? 0),
          })
          .then(() => {})
          .catch((err: unknown) => {
            console.warn(
              "[subscription] could not record upgrade invoice:",
              err,
            );
          });
      }

      // Revise the EXISTING PayPal subscription onto the target plan. The
      // same subscription is kept, so nothing else is created and no second,
      // separate approval is needed: today's only charge is the captured
      // order, and PayPal bills the full plan rate at the next cycle.
      const existingSubscriptionId = pendingSwitch.old_paypal_subscription_id;

      if (
        !existingSubscriptionId ||
        existingSubscriptionId.startsWith("FREE-")
      ) {
        return Response.json(
          {
            success: false,
            message: "No active PayPal subscription to revise.",
          },
          { status: 400 },
        );
      }

      // PayPal can only revise a subscription whose status is ACTIVE. If the
      // current agreement is CANCELLED/EXPIRED/SUSPENDED/APPROVAL_PENDING
      // there is nothing to revise, so create a replacement subscription: the
      // upgrade value was already captured from the one-time order, so it
      // carries a zero setup fee and PayPal bills the full rate next cycle.
      const existingLookup = await getPayPalSubscription(
        accessToken,
        existingSubscriptionId,
      );
      const existingPaypalStatus = existingLookup.ok
        ? String(existingLookup.data.status ?? "").toUpperCase()
        : "";

      if (existingPaypalStatus !== "ACTIVE") {
        console.log(
          `[subscription] existing sub ${existingSubscriptionId} is "${existingPaypalStatus || "UNKNOWN"}"; creating replacement for upgrade (${tenantId}).`,
        );

        const { data: tenantRow } = await admin
          .from("tenants")
          .select("slug")
          .eq("id", tenantId)
          .maybeSingle();
        const tenantSlug = tenantRow?.slug ?? "";

        const subCreateResponse = await fetch(
          `${BASE_URL}/v1/billing/subscriptions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              plan_id: plan.code,
              custom_id: tenantId,
              subscriber: {
                email_address: captureResult.payerEmail ?? user.email ?? "",
                name: { given_name: "Valued", surname: "Customer" },
                address: { country_code: "US" },
              },
              payment_schedule: {
                setup_fee: { value: "0.00", currency_code: "USD" },
              },
              application_context: {
                brand_name: "ServiceDesk",
                user_action: "SUBSCRIBE_NOW",
                landing_page: "LOGIN",
                return_url: `${FRONTEND_URL}/${tenantSlug}/payment/success`,
                cancel_url: `${FRONTEND_URL}/${tenantSlug}/payment/cancel`,
              },
            }),
          },
        );

        const subCreateResult = (await subCreateResponse.json()) as {
          id?: string;
          status?: string;
          message?: string;
          links?: { rel: string; href: string }[];
        };

        if (!subCreateResponse.ok || !subCreateResult.id) {
          console.error("Replacement subscription creation failed:", {
            status: subCreateResponse.status,
            response: subCreateResult,
          });
          return Response.json(
            {
              success: false,
              message:
                subCreateResult.message ??
                "Failed to set up your new subscription. No charge was made for it; please try again.",
            },
            { status: 400 },
          );
        }

        const replacementSubId = subCreateResult.id;

        // The UNIQUE column currently holds the captured ORDER id; switching it
        // to the fresh subscription id cannot collide with the original signup
        // switch, and it puts the activation on the standard approval -> webhook
        // -> activate path (which updates the subscriptions row by tenant_id).
        const { error: rekeyError } = await admin
          .from("subscription_switches")
          .update({
            paypal_subscription_id: replacementSubId,
            status: "pending",
            updated_at: nowDateStr,
          })
          .eq("id", pendingSwitch.id);

        if (rekeyError) {
          console.error("Switch rekey to replacement sub failed:", rekeyError);
          return Response.json(
            {
              success: false,
              message:
                "Payment received, but we could not finalize your plan. Please contact support.",
            },
            { status: 500 },
          );
        }

        console.log(
          `[subscription] replacement subscription ${replacementSubId} created (zero setup fee) for upgrade to ${plan.name}.`,
        );

        return Response.json({
          success: true,
          message:
            "Payment received. Please confirm your new subscription to activate the plan.",
          planName: plan.name,
          nextBilling: Number(plan.price_month ?? 0),
          subscriptionId: replacementSubId,
          approvalUrl:
            subCreateResult.links?.find((l) => l.rel === "approve")?.href ??
            null,
        });
      }

      const reviseResponse = await fetch(
        `${BASE_URL}/v1/billing/subscriptions/${existingSubscriptionId}/revise`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            plan_id: plan.code,
          }),
        },
      );

      const reviseResult = await reviseResponse.json();

      if (!reviseResponse.ok) {
        console.error("PayPal subscription revise failed:", {
          status: reviseResponse.status,
          response: reviseResult,
        });
        return Response.json(
          {
            success: false,
            message:
              reviseResult?.message ??
              "Failed to update your subscription plan.",
          },
          { status: 400 },
        );
      }

      // Kept pending and still keyed on the ORDER id. If PayPal needs buyer
      // approval for the revise, the returned link leads back to the success
      // page with the subscription id; `activate` then finds this switch via
      // old_paypal_subscription_id (the switch's own paypal_subscription_id
      // stays the order id here, since that column is UNIQUE and the original
      // signup switch already holds the real subscription id).
      const approveLink = reviseResult?.links?.find(
        (link: { rel: string; href: string }) => link.rel === "approve",
      )?.href;

      if (approveLink) {
        return Response.json({
          success: true,
          message: "Payment received. Please confirm your plan change.",
          planName: plan.name,
          nextBilling: Number(plan.price_month ?? 0),
          subscriptionId: existingSubscriptionId,
          approvalUrl: approveLink,
        });
      }

      // Revise applied without buyer approval. Activate the plan in the app
      // immediately; PayPal charges the full plan rate at the next cycle.
      const refreshed = await getPayPalSubscription(
        accessToken,
        existingSubscriptionId,
      );
      const nextBillingTime = (
        refreshed.data as {
          billing_info?: { next_billing_time?: string };
        } | null
      )?.billing_info?.next_billing_time;

      const { data: activatedSub, error: activationError } = await admin
        .from("subscriptions")
        .update({
          plan_id: pendingSwitch.plan_id,
          paypal_subscription_id: existingSubscriptionId,
          status: "active",
          seats: plan.seat_limit ?? 1,
          current_period_end:
            nextBillingTime ??
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: nowDateStr,
        })
        .eq("tenant_id", tenantId)
        .select("id")
        .maybeSingle();

      if (activationError) {
        console.error(
          "Subscription activation after revise failed:",
          activationError,
        );
        return Response.json(
          {
            success: false,
            message: `Failed to activate subscription: ${activationError.message}`,
          },
          { status: 500 },
        );
      }

      await admin
        .from("tenants")
        .update({ plan_id: pendingSwitch.plan_id, updated_at: nowDateStr })
        .eq("id", tenantId);

      await admin
        .from("subscription_switches")
        .update({ status: "applied", updated_at: nowDateStr })
        .eq("id", pendingSwitch.id);

      await storePayPalPaymentMethod(admin, {
        tenantId,
        subscriptionRowId: activatedSub?.id ?? null,
        paypalSubscriptionId: existingSubscriptionId,
        subscriber: captureResult.payerId
          ? ({
              payer_id: captureResult.payerId,
              email_address:
                captureResult.payerEmail ?? user.email ?? undefined,
            } as PayPalSubscriber)
          : undefined,
        context: "subscription:capture-order:revise",
      });

      return Response.json({
        success: true,
        message: "Payment received. Your new plan is active.",
        planName: plan.name,
        nextBilling: Number(plan.price_month ?? 0),
        subscriptionId: existingSubscriptionId,
      });
    }

    // Dedicated cancel action: cancels the active subscription and moves
    // the tenant to the Free plan. If paid time remains the change is
    // deferred to the end of the billing period.
    if (action === "cancel") {
      const reason = body?.reason as string | undefined;

      const { data: currentSub, error: subLookupError } = await admin
        .from("subscriptions")
        .select(
          "id, status, plan_id, paypal_subscription_id, current_period_end, seats",
        )
        .eq("tenant_id", tenantId)
        .in("status", ["active", "trialing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subLookupError) {
        console.error("Subscription lookup for cancel failed:", subLookupError);
        return Response.json(
          {
            success: false,
            message: "Failed to look up your subscription.",
            details: subLookupError.message,
          },
          { status: 500 },
        );
      }

      if (!currentSub) {
        return Response.json(
          { success: false, message: "No active subscription found." },
          { status: 404 },
        );
      }

      const paypalSubId = currentSub.paypal_subscription_id || "";
      const isFree = paypalSubId.startsWith("FREE-");

      if (isFree) {
        return Response.json(
          { success: false, message: "You are already on the Free plan." },
          { status: 400 },
        );
      }

      // Find the Free plan
      const { data: freePlan, error: freePlanError } = await admin
        .from("plans")
        .select("id, price_month")
        .eq("price_month", 0)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (freePlanError || !freePlan) {
        console.error("Free plan lookup failed:", freePlanError);
        return Response.json(
          { success: false, message: "Could not find the Free plan." },
          { status: 500 },
        );
      }

      const { data: currentPlan } = await admin
        .from("plans")
        .select("price_month")
        .eq("id", currentSub.plan_id)
        .maybeSingle();

      const periodEnd = currentSub.current_period_end
        ? new Date(currentSub.current_period_end)
        : null;

      const hasPaidTime =
        periodEnd !== null &&
        periodEnd.getTime() > Date.now() &&
        currentPlan &&
        Number(currentPlan.price_month) > 0;

      const accessToken = await getAccessToken();

      // Cancel any existing pending switches first
      await admin
        .from("subscription_switches")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "approved"]);

      if (hasPaidTime && periodEnd) {
        // Deferred: tenant keeps the current plan until the period ends
        const { error: cancelSwitchError } = await admin
          .from("subscription_switches")
          .insert({
            tenant_id: tenantId,
            plan_id: freePlan.id,
            paypal_subscription_id: `FREE-${tenantId}-${Date.now()}`,
            old_paypal_subscription_id: paypalSubId,
            old_plan_id: currentSub.plan_id,
            old_status: currentSub.status,
            old_seats: currentSub.seats ?? 1,
            old_current_period_end: currentSub.current_period_end,
            effective_at: periodEnd.toISOString(),
            status: "approved",
          });

        if (cancelSwitchError) {
          console.error("Cancel switch insert failed:", cancelSwitchError);
          return Response.json(
            {
              success: false,
              message: `Failed to schedule cancellation: ${cancelSwitchError.message}`,
            },
            { status: 500 },
          );
        }

        // Cancel the PayPal agreement now so it never charges again;
        // access is governed by our subscriptions row until effective_at.
        if (isRealAgreement(paypalSubId)) {
          try {
            await cancelPayPalSubscription(accessToken, paypalSubId);
          } catch (cancelError) {
            console.error(
              "Failed to cancel PayPal agreement for deferred cancel:",
              cancelError,
            );
          }
        }

        // Log the cancellation reason if provided
        if (reason) {
          await admin
            .from("subscription_cancellation_reasons")
            .insert({
              tenant_id: tenantId,
              subscription_id: currentSub.id,
              reason,
              created_at: new Date().toISOString(),
            })
            .then(() => {})
            .catch((err: unknown) => {
              console.warn("Could not log cancellation reason:", err);
            });
        }

        return Response.json({
          success: true,
          scheduled: true,
          effectiveAt: periodEnd.toISOString(),
          message:
            "Subscription cancelled. Your current plan stays active until the end of the billing period.",
        });
      }

      // Immediate: no paid time remaining — cancel now
      if (isRealAgreement(paypalSubId)) {
        try {
          await cancelPayPalSubscription(accessToken, paypalSubId);
        } catch (cancelError) {
          console.error(
            "Failed to cancel PayPal agreement for immediate cancel:",
            cancelError,
          );
        }
      }

      const { error: updateSubError } = await admin
        .from("subscriptions")
        .update({
          plan_id: freePlan.id,
          paypal_subscription_id: `FREE-${tenantId}`,
          status: "active",
          seats: 1,
          current_period_end: new Date(
            Date.now() + 15 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId);

      if (updateSubError) {
        console.error("Subscription update for cancel failed:", updateSubError);
        return Response.json(
          {
            success: false,
            message: `Failed to cancel subscription: ${updateSubError.message}`,
          },
          { status: 500 },
        );
      }

      await admin
        .from("tenants")
        .update({ plan_id: freePlan.id, updated_at: new Date().toISOString() })
        .eq("id", tenantId);

      // Log the cancellation reason if provided
      if (reason) {
        await admin
          .from("subscription_cancellation_reasons")
          .insert({
            tenant_id: tenantId,
            subscription_id: currentSub.id,
            reason,
            created_at: new Date().toISOString(),
          })
          .then(() => {})
          .catch((err: unknown) => {
            console.warn("Could not log cancellation reason:", err);
          });
      }

      return Response.json({
        success: true,
        message: "Subscription cancelled. You are now on the Free plan.",
      });
    }

    if (action === "activate") {
      let targetSubscriptionId = subscriptionId;

      // PayPal sometimes returns to the success page without a token (e.g.
      // the approval redirect landing twice, or a manual revisit). Fall back
      // to the tenant's latest pending upgrade subscription so activation is
      // still possible from the id-less return URL.
      if (!targetSubscriptionId) {
        const { data: latestSwitch, error: latestSwitchError } = await admin
          .from("subscription_switches")
          .select("paypal_subscription_id, old_paypal_subscription_id, status")
          .eq("tenant_id", tenantId)
          .in("status", ["pending", "approved"])
          .is("effective_at", null)
          .or(
            "paypal_subscription_id.like.I-%,old_paypal_subscription_id.like.I-%",
          )
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestSwitchError) {
          console.error("Pending switch resolution failed:", latestSwitchError);
          return Response.json(
            { success: false, message: "Failed to resolve the plan change." },
            { status: 500 },
          );
        }

        if (latestSwitch) {
          // Normal subscriptions carry the id in paypal_subscription_id; an
          // upgrade awaiting revise approval keeps the ORDER id there and the
          // real subscription id in old_paypal_subscription_id.
          targetSubscriptionId =
            latestSwitch.paypal_subscription_id?.startsWith("I-")
              ? latestSwitch.paypal_subscription_id
              : (latestSwitch.old_paypal_subscription_id ?? null);
        }
      }

      if (!targetSubscriptionId) {
        return Response.json(
          { success: false, message: "Subscription ID is required." },
          { status: 400 },
        );
      }

      // Resolve the plan change for this subscription id. Order:
      //  1. A pending/approved switch keyed on the id (normal activation).
      //  2. A pending/approved switch whose OLD id is the subscription id
      //     (upgrade awaiting buyer approval of a revise; the switch keeps the
      //     ORDER id in paypal_subscription_id because that column is UNIQUE).
      //  3. An already-applied switch keyed on the id (id-less / duplicate
      //     returns) so we can report "already active".
      let pendingSwitch: SubscriptionSwitchRow | null = null;
      let switchError: { message?: string } | null = null;

      const baseSelect = [
        "id",
        "plan_id",
        "paypal_subscription_id",
        "old_paypal_subscription_id",
        "status",
        "effective_at",
      ];

      {
        const res = await admin
          .from("subscription_switches")
          .select(baseSelect.join(", ") + ", tenant_id")
          .eq("paypal_subscription_id", targetSubscriptionId)
          .eq("tenant_id", tenantId)
          .in("status", ["pending", "approved"])
          .maybeSingle();

        if (res.data) {
          pendingSwitch = res.data;
        }
      }

      if (!pendingSwitch) {
        const res = await admin
          .from("subscription_switches")
          .select(baseSelect.join(", ") + ", tenant_id")
          .eq("old_paypal_subscription_id", targetSubscriptionId)
          .eq("tenant_id", tenantId)
          .in("status", ["pending", "approved"])
          .is("effective_at", null)
          .maybeSingle();

        if (res.error) {
          switchError = res.error;
        }

        if (res.data) {
          pendingSwitch = res.data;
        }
      }

      if (!pendingSwitch) {
        const res = await admin
          .from("subscription_switches")
          .select(baseSelect.join(", ") + ", tenant_id")
          .eq("paypal_subscription_id", targetSubscriptionId)
          .eq("tenant_id", tenantId)
          .maybeSingle();

        if (res.error) {
          switchError = res.error;
        }

        if (res.data) {
          pendingSwitch = res.data;
        }
      }

      if (switchError) {
        console.error("Pending switch lookup failed:", switchError);
        return Response.json(
          {
            success: false,
            message: "Failed to look up the plan change.",
            details: switchError.message,
          },
          { status: 500 },
        );
      }

      if (!pendingSwitch) {
        return Response.json(
          {
            success: false,
            message: "Subscription not found for this tenant.",
          },
          { status: 404 },
        );
      }

      if (pendingSwitch.status === "applied") {
        const { data: plan } = await admin
          .from("plans")
          .select("name")
          .eq("id", pendingSwitch.plan_id)
          .single();

        return Response.json({
          success: true,
          message: "Subscription already activated.",
          planName: plan?.name ?? null,
        });
      }

      const accessToken = await getAccessToken();
      const { ok, data: paypalSub } = await getPayPalSubscription(
        accessToken,
        targetSubscriptionId,
      );

      if (!ok) {
        return Response.json(
          {
            success: false,
            message: "Could not verify the subscription with PayPal.",
          },
          { status: 502 },
        );
      }

      const paypalStatus = String(paypalSub.status ?? "").toUpperCase();
      const paypalCustomId = String(paypalSub.custom_id ?? "");

      if (paypalStatus !== "APPROVED" && paypalStatus !== "ACTIVE") {
        console.error("PayPal subscription not approved:", {
          paypalSubscriptionId: targetSubscriptionId,
          status: paypalStatus,
        });
        return Response.json({
          success: false,
          message:
            "This subscription was not approved with PayPal. Please complete the checkout before we can activate your plan.",
          status: paypalStatus,
        });
      }

      if (paypalCustomId && paypalCustomId !== tenantId) {
        console.error("PayPal subscription custom_id mismatch:", {
          expected: tenantId,
          received: paypalCustomId,
        });
        return Response.json({
          success: false,
          message: "Subscription does not belong to this tenant.",
        });
      }

      // A scheduled downgrade is approved now but must not touch the tenant's
      // plan yet -- they keep what they paid for until effective_at, when
      // PayPal starts the new agreement. The ACTIVATED webhook applies it then,
      // with the reconcile-subscriptions job as the backstop.
      if (
        pendingSwitch.effective_at &&
        new Date(pendingSwitch.effective_at).getTime() > Date.now()
      ) {
        const { error: scheduleError } = await admin
          .from("subscription_switches")
          .update({ status: "approved", updated_at: new Date().toISOString() })
          .eq("id", pendingSwitch.id);

        if (scheduleError) {
          console.error("Failed to mark switch approved:", scheduleError);
          return Response.json(
            {
              success: false,
              message: `Failed to schedule plan change: ${scheduleError.message}`,
            },
            { status: 500 },
          );
        }

        // The buyer has now committed to the replacement, so retire the old
        // agreement: the new one starts at exactly the moment the old one
        // would next charge, and leaving both live risks PayPal billing twice
        // at that instant. Cancelling does not touch the period already paid
        // for -- the tenant keeps the current plan until effective_at, because
        // entitlements come from our subscriptions row, not from PayPal.
        // Doing this only after approval means an abandoned checkout leaves
        // the paying subscription untouched.
        if (isRealAgreement(pendingSwitch.old_paypal_subscription_id)) {
          try {
            await cancelPayPalSubscription(
              accessToken,
              pendingSwitch.old_paypal_subscription_id!,
            );
          } catch (cancelError) {
            console.error(
              "Failed to cancel superseded agreement for scheduled downgrade:",
              cancelError,
            );
          }
        }

        const { data: scheduledPlan } = await admin
          .from("plans")
          .select("name")
          .eq("id", pendingSwitch.plan_id)
          .maybeSingle();

        return Response.json({
          success: true,
          scheduled: true,
          effectiveAt: pendingSwitch.effective_at,
          planName: scheduledPlan?.name ?? null,
          message:
            "Plan change scheduled. Your current plan stays active until the end of the billing period.",
        });
      }

      const { data: plan, error: planError } = await admin
        .from("plans")
        .select("id, name, seat_limit")
        .eq("id", pendingSwitch.plan_id)
        .single();

      const { data: activatedSub, error: activationError } = await admin
        .from("subscriptions")
        .update({
          plan_id: pendingSwitch.plan_id,
          paypal_subscription_id: targetSubscriptionId,
          status: "active",
          seats: plan?.seat_limit ?? 1,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .select("id")
        .maybeSingle();

      if (activationError) {
        console.error("Subscription activation failed:", activationError);
        return Response.json(
          {
            success: false,
            message: `Failed to activate subscription: ${activationError.message}`,
            details: activationError.details ?? null,
          },
          { status: 500 },
        );
      }

      if (!planError && plan) {
        const { error: tenantUpdateError } = await admin
          .from("tenants")
          .update({ plan_id: plan.id, updated_at: new Date().toISOString() })
          .eq("id", tenantId);

        if (tenantUpdateError) {
          console.error("Tenant plan update failed:", tenantUpdateError);
        }
      }

      // The buyer lands on the billing page straight after approving, often
      // before PayPal delivers BILLING.SUBSCRIPTION.ACTIVATED. Recording the
      // payment method here from the subscription we just fetched means they
      // do not see "No payment method on file" in the meantime; the webhook
      // later updates the same row rather than adding another.
      await storePayPalPaymentMethod(admin, {
        tenantId,
        subscriptionRowId: activatedSub?.id ?? null,
        paypalSubscriptionId: targetSubscriptionId,
        subscriber: paypalSub.subscriber as PayPalSubscriber | undefined,
        context: "subscription:activate",
      });

      await admin
        .from("subscription_switches")
        .update({
          status: "approved",
          updated_at: new Date().toISOString(),
        })
        .eq("id", pendingSwitch.id);

      return Response.json({
        success: true,
        message: "Subscription activated successfully.",
        planName: plan?.name ?? null,
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

    if (!planId) {
      return Response.json(
        { success: false, message: "Plan ID is required." },
        { status: 400 },
      );
    }

    const { data: plan, error: planError } = await admin
      .from("plans")
      .select("*")
      .eq("id", planId)
      .eq("is_active", true)
      .single();

    if (planError || !plan) {
      console.error("Plan lookup failed:", planError);
      return Response.json(
        {
          success: false,
          message: "Plan not found.",
          details: planError?.message ?? null,
        },
        { status: 404 },
      );
    }

    const { data: currentSubscription, error: existingSubscriptionError } =
      await admin
        .from("subscriptions")
        .select(
          "id, status, plan_id, paypal_subscription_id, seats, current_period_end",
        )
        .eq("tenant_id", tenantId)
        .maybeSingle();

    if (existingSubscriptionError) {
      console.error(
        "Existing subscription lookup failed:",
        existingSubscriptionError,
      );
      return Response.json(
        {
          success: false,
          message: "Failed to check existing subscription.",
          details: existingSubscriptionError.message,
        },
        { status: 500 },
      );
    }

    const existingPaidSubscription =
      currentSubscription &&
      currentSubscription.paypal_subscription_id &&
      !String(currentSubscription.paypal_subscription_id).startsWith("FREE-") &&
      ["trialing", "active"].includes(currentSubscription.status)
        ? currentSubscription
        : null;

    // A downgrade must not take effect while the tenant still has paid time
    // left. Instead of switching now, the cheaper PayPal subscription is
    // created with start_time set to the end of the paid period, so PayPal
    // activates (and first bills) it exactly when that period runs out. The
    // current plan keeps running untouched until then.
    const { data: currentPlan } = currentSubscription?.plan_id
      ? await admin
          .from("plans")
          .select("price_month")
          .eq("id", currentSubscription.plan_id)
          .maybeSingle()
      : { data: null };

    const periodEnd = currentSubscription?.current_period_end
      ? new Date(currentSubscription.current_period_end)
      : null;

    const isDowngrade =
      currentPlan !== null &&
      Number(plan.price_month) < Number(currentPlan.price_month);

    const deferUntil =
      isDowngrade &&
      existingPaidSubscription !== null &&
      periodEnd !== null &&
      periodEnd.getTime() > Date.now()
        ? periodEnd
        : null;

    const isFreePlan = Number(plan.price_month) === 0;

    // Calculate prorated credit for upgrades
    let proratedCredit = 0;
    if (
      !isDowngrade &&
      !isFreePlan &&
      currentPlan &&
      periodEnd &&
      periodEnd.getTime() > Date.now()
    ) {
      const oldPlanRate = Number(currentPlan.price_month);
      const periodStart = new Date(
        periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000,
      );
      const totalDays = Math.max(
        1,
        Math.ceil(
          (periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000),
        ),
      );
      const remainingDays = Math.max(
        0,
        Math.ceil((periodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      );
      proratedCredit =
        Math.round((oldPlanRate * remainingDays * 100) / totalDays) / 100;
    }

    const accessToken = await getAccessToken();

    if (isFreePlan) {
      // Dropping to Free with paid time still on the clock must not take
      // effect now -- the tenant keeps what they paid for until
      // current_period_end. Free has no PayPal agreement to schedule with a
      // start_time, so the switch is recorded here and applied by
      // reconcile-subscriptions at effective_at. The paid agreement is
      // cancelled straight away so PayPal never charges another cycle;
      // access is governed by our subscriptions row, not by PayPal.
      if (deferUntil) {
        await admin
          .from("subscription_switches")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .in("status", ["pending", "approved"]);

        const { error: freeSwitchError } = await admin
          .from("subscription_switches")
          .insert({
            tenant_id: tenantId,
            plan_id: plan.id,
            // No PayPal agreement backs a free plan, but the column is NOT
            // NULL and UNIQUE, so a per-request placeholder is used.
            paypal_subscription_id: `FREE-${tenantId}-${Date.now()}`,
            old_paypal_subscription_id:
              currentSubscription?.paypal_subscription_id ?? null,
            old_plan_id: currentSubscription?.plan_id ?? tenant.plan_id,
            old_status: currentSubscription?.status ?? "active",
            old_seats: currentSubscription?.seats ?? 1,
            old_current_period_end:
              currentSubscription?.current_period_end ?? null,
            effective_at: deferUntil.toISOString(),
            // Free needs no buyer approval, so it is committed on request.
            status: "approved",
          });

        if (freeSwitchError) {
          console.error(
            "Scheduled Free switch insert failed:",
            freeSwitchError,
          );
          return Response.json(
            {
              success: false,
              message: `Failed to schedule plan change: ${freeSwitchError.message}`,
            },
            { status: 500 },
          );
        }

        // Insert first, then cancel: the CANCELLED webhook guard looks for
        // this row to know the cancellation is intentional.
        if (existingPaidSubscription?.paypal_subscription_id) {
          try {
            await cancelPayPalSubscription(
              accessToken,
              existingPaidSubscription.paypal_subscription_id,
            );
          } catch (cancelError) {
            console.error(
              "Failed to cancel agreement for scheduled Free downgrade:",
              cancelError,
            );
          }
        }

        return Response.json({
          success: true,
          scheduled: true,
          effectiveAt: deferUntil.toISOString(),
          message:
            "Plan change scheduled. Your current plan stays active until the end of the billing period.",
          subscriptionId: null,
          approvalUrl: null,
        });
      }

      // Best-effort, like every other cancel: the tenant asked to move to
      // Free, and a PayPal agreement we could not retire must not be what
      // stops that. The CANCELLED webhook and the reconcile job both treat
      // our subscriptions row as the source of truth for entitlements.
      if (existingPaidSubscription?.paypal_subscription_id) {
        try {
          await cancelPayPalSubscription(
            accessToken,
            existingPaidSubscription.paypal_subscription_id,
          );
        } catch (cancelError) {
          console.error(
            "Failed to cancel agreement for immediate Free downgrade:",
            cancelError,
          );
        }
      }

      const { error: subError } = await admin
        .from("subscriptions")
        .update({
          plan_id: plan.id,
          paypal_subscription_id: `FREE-${tenantId}`,
          status: "active",
          seats: plan.seat_limit,
          current_period_end: new Date(
            Date.now() + 15 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId);

      if (subError) {
        return Response.json(
          {
            success: false,
            message: `Failed to update subscription: ${subError.message}`,
          },
          { status: 400 },
        );
      }

      await admin
        .from("tenants")
        .update({ plan_id: plan.id })
        .eq("id", tenantId);

      return Response.json({
        success: true,
        message: "Plan changed to Free.",
        subscriptionId: null,
        approvalUrl: null,
      });
    }

    // Paid downgrades (Business -> Pro): never open a PayPal checkout. The new
    // plan starts at the end of the paid period (or immediately if no paid
    // time is left) and the existing PayPal agreement is best-effort REVISED
    // onto the cheaper plan so the next billing cycle charges the lower rate.
    // No new agreement and no approval page; if PayPal would require approval
    // to revise, we skip it and the scheduled switch still governs access.
    if (!isFreePlan && isDowngrade) {
      const placeholder = `PAID-${tenantId}-${Date.now()}`;

      if (!deferUntil) {
        const { error: downgradeSubError } = await admin
          .from("subscriptions")
          .update({
            plan_id: plan.id,
            paypal_subscription_id:
              existingPaidSubscription?.paypal_subscription_id ?? placeholder,
            status: "active",
            seats: plan.seat_limit ?? 1,
            current_period_end: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("tenant_id", tenantId);

        if (downgradeSubError) {
          console.error(
            "Paid downgrade immediate apply failed:",
            downgradeSubError,
          );
          return Response.json(
            {
              success: false,
              message: `Failed to apply the plan change: ${downgradeSubError.message}`,
            },
            { status: 400 },
          );
        }

        await admin
          .from("tenants")
          .update({ plan_id: plan.id, updated_at: new Date().toISOString() })
          .eq("id", tenantId);

        if (existingPaidSubscription?.paypal_subscription_id) {
          try {
            const reviseRes = await fetch(
              `${BASE_URL}/v1/billing/subscriptions/${existingPaidSubscription.paypal_subscription_id}/revise`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({ plan_id: plan.code }),
              },
            );
            if (!reviseRes.ok) {
              console.error(
                "Paid downgrade immediate revise not applied:",
                { status: reviseRes.status },
              );
            }
          } catch (reviseError) {
            console.error("Paid downgrade immediate revise failed:", reviseError);
          }
        }

        return Response.json({
          success: true,
          message: `Plan changed to ${plan.name}.`,
          subscriptionId: existingPaidSubscription?.paypal_subscription_id ?? null,
          approvalUrl: null,
        });
      }

      await admin
        .from("subscription_switches")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "approved"]);

      const { error: paidSwitchError } = await admin
        .from("subscription_switches")
        .insert({
          tenant_id: tenantId,
          plan_id: plan.id,
          // UNIQUE column: cannot reuse the real agreement id (the signup
          // switch already holds it), so a placeholder is used. The REAL
          // agreement stays in subscriptions and is what keeps billing.
          paypal_subscription_id: placeholder,
          old_paypal_subscription_id:
            currentSubscription?.paypal_subscription_id ?? null,
          old_plan_id: currentSubscription?.plan_id ?? tenant.plan_id,
          old_status: currentSubscription?.status ?? "active",
          old_seats: currentSubscription?.seats ?? 1,
          old_current_period_end:
            currentSubscription?.current_period_end ?? null,
          effective_at: deferUntil.toISOString(),
          status: "approved",
        });

      if (paidSwitchError) {
        console.error(
          "Scheduled paid-downgrade switch insert failed:",
          paidSwitchError,
        );
        return Response.json(
          {
            success: false,
            message: `Failed to schedule plan change: ${paidSwitchError.message}`,
          },
          { status: 500 },
        );
      }

      if (existingPaidSubscription?.paypal_subscription_id) {
        try {
          const reviseRes = await fetch(
            `${BASE_URL}/v1/billing/subscriptions/${existingPaidSubscription.paypal_subscription_id}/revise`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ plan_id: plan.code }),
            },
          );
          if (!reviseRes.ok) {
            console.error(
              "Paid downgrade revise not applied (switch still scheduled):",
              { status: reviseRes.status },
            );
          }
        } catch (reviseError) {
          console.error(
            "Paid downgrade revise failed (switch still scheduled):",
            reviseError,
          );
        }
      }

      return Response.json({
        success: true,
        scheduled: true,
        effectiveAt: deferUntil.toISOString(),
        message:
          "Plan change scheduled. Your current plan stays active until the end of the billing period.",
        subscriptionId: null,
        approvalUrl: null,
      });
    }

    // Upgrades collect the discounted amount as a true one-time PayPal order
    // first (pay once, no auto-pay authorization page). Once the order is
    // captured the real subscription is created and its approve link is
    // handed to the buyer, so the standard ACTIVATED webhook path switches
    // the plan and sets up the full-price recurring billing.
    const isUpgrade =
      existingPaidSubscription && !isDowngrade && proratedCredit > 0;

    if (isUpgrade) {
      const orderAmount = Math.round(
        Math.max(0, Number(plan.price_month) - proratedCredit) * 100,
      ) / 100;
      const description = `ServiceDesk ${plan.name} Upgrade (one-time: $${Number(plan.price_month).toFixed(2)} - $${proratedCredit.toFixed(2)} credit)`;

      const orderResult = await createPaypalOrder(accessToken, {
        amount: orderAmount,
        description,
        customId: tenantId,
        return_url: `${FRONTEND_URL}/${tenantSlug}/payment/success`,
        cancel_url: `${FRONTEND_URL}/${tenantSlug}/payment/cancel`,
      });

      if (!orderResult.ok) {
        console.error("PayPal order creation failed:", orderResult.error);
        return Response.json(
          {
            success: false,
            message: orderResult.error || "Failed to create payment.",
          },
          { status: 400 },
        );
      }

      console.log(
        `[subscription] order created ${orderResult.orderId} tenant=${tenantId} amount=${orderAmount}`,
      );

      await admin
        .from("subscription_switches")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "approved"]);

      const { error: switchError } = await admin
        .from("subscription_switches")
        .insert({
          tenant_id: tenantId,
          plan_id: plan.id,
          paypal_subscription_id: orderResult.orderId || `ORDER-${Date.now()}`,
          old_paypal_subscription_id:
            currentSubscription?.paypal_subscription_id ?? null,
          old_plan_id: currentSubscription?.plan_id ?? tenant.plan_id,
          old_status: currentSubscription?.status ?? "active",
          old_seats: currentSubscription?.seats ?? 1,
          old_current_period_end:
            currentSubscription?.current_period_end ?? null,
          effective_at: null,
          status: "pending",
        });

      if (switchError) {
        console.error("Pending switch insert failed:", switchError);
        return Response.json(
          {
            success: false,
            message: `Failed to record plan change: ${switchError.message}`,
          },
          { status: 500 },
        );
      }

      return Response.json({
        success: true,
        message:
          "Upgrade payment created. Please complete payment to activate your new plan.",
        subscriptionId: orderResult.orderId,
        approvalUrl: orderResult.approveUrl,
        proratedCredit,
        amountDue: orderAmount,
      });
    }

    // For downgrades or new subscriptions without credit, create PayPal subscription
    const paypalResponse = await fetch(`${BASE_URL}/v1/billing/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        plan_id: plan.code,
        custom_id: tenantId,
        ...(deferUntil ? { start_time: deferUntil.toISOString() } : {}),
        subscriber: {
          email_address: user.email,
          name: {
            given_name: "Valued",
            surname: "Customer",
          },
          address: {
            country_code: "US",
          },
        },
        application_context: {
          brand_name: "ServiceDesk",
          user_action: "SUBSCRIBE_NOW",
          landing_page: "LOGIN",
          return_url: `${FRONTEND_URL}/${tenantSlug}/payment/success`,
          cancel_url: `${FRONTEND_URL}/${tenantSlug}/payment/cancel`,
        },
      }),
    });

    const paypalSubscription = await paypalResponse.json();

    if (!paypalResponse.ok) {
      console.error("PayPal subscription creation failed:", {
        status: paypalResponse.status,
        statusText: paypalResponse.statusText,
        response: paypalSubscription,
      });

      return Response.json(
        {
          success: false,
          message:
            paypalSubscription?.message ??
            "PayPal subscription creation failed.",
          details: paypalSubscription?.details ?? null,
          debug_id: paypalSubscription?.debug_id ?? null,
        },
        { status: 400 },
      );
    }

    console.log(
      `[subscription] created ${paypalSubscription.id} tenant=${tenantId}`,
    );

    const approvalUrl = paypalSubscription.links?.find(
      (link: { rel: string; href: string }) => link.rel === "approve",
    )?.href;

    if (!approvalUrl) {
      console.error("PayPal response:", paypalSubscription);
      return Response.json(
        {
          success: false,
          message: "Approval URL not returned by PayPal.",
        },
        { status: 500 },
      );
    }

    await admin
      .from("subscription_switches")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .in("status", ["pending", "approved"]);

    const { error: switchError } = await admin
      .from("subscription_switches")
      .insert({
        tenant_id: tenantId,
        plan_id: plan.id,
        paypal_subscription_id: paypalSubscription.id,
        old_paypal_subscription_id:
          currentSubscription?.paypal_subscription_id ?? null,
        old_plan_id: currentSubscription?.plan_id ?? tenant.plan_id,
        old_status: currentSubscription?.status ?? "trialing",
        old_seats: currentSubscription?.seats ?? 1,
        old_current_period_end: currentSubscription?.current_period_end ?? null,
        effective_at: deferUntil?.toISOString() ?? null,
        status: "pending",
      });

    if (switchError) {
      console.error("Pending switch insert failed:", switchError);
      return Response.json(
        {
          success: false,
          message: `Failed to record plan change: ${switchError.message}`,
        },
        { status: 500 },
      );
    }

    return Response.json({
      success: true,
      message: deferUntil
        ? "PayPal subscription created successfully. The plan change takes effect at the end of the current billing period."
        : "PayPal subscription created successfully.",
      subscriptionId: paypalSubscription.id,
      approvalUrl,
      effectiveAt: deferUntil?.toISOString() ?? null,
      proratedCredit,
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
