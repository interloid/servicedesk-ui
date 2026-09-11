import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  paypalAutopayUrl,
  resolvePaymentSource,
  storePayPalPaymentMethod,
  type PayPalSubscriber,
} from "../_shared/paypal-payment-method.ts";

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
  } = {};

  try {
    data = JSON.parse(responseText);
  } catch {
    data = {};
  }

  if (!response.ok || !data?.access_token) {
    throw new Error("Failed to obtain PayPal access token");
  }

  return data.access_token;
}

async function getPayPalSubscription(
  accessToken: string,
  subscriptionId: string,
): Promise<Record<string, unknown>> {
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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Failed to fetch subscription: ${data?.message ?? response.status}`,
    );
  }

  return data;
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
    const tenantSlug = body?.tenantSlug;

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
      return Response.json(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("id, slug")
      .eq("slug", tenantSlug)
      .single();

    if (tenantError || !tenant) {
      return Response.json(
        { success: false, message: "Tenant not found." },
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
      return Response.json(
        {
          success: false,
          message:
            "Forbidden: you do not have billing permissions for this tenant.",
        },
        { status: 403 },
      );
    }

    const { data: subscription, error: subError } = await admin
      .from("subscriptions")
      .select("id, paypal_subscription_id, status")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    if (subError || !subscription) {
      return Response.json(
        {
          success: false,
          message: "No active subscription found for this tenant.",
        },
        { status: 404 },
      );
    }

    const paypalSubscriptionId = subscription.paypal_subscription_id;
    if (!paypalSubscriptionId || paypalSubscriptionId.startsWith("FREE-")) {
      return Response.json(
        {
          success: false,
          message: "This tenant does not have a PayPal subscription.",
        },
        { status: 400 },
      );
    }

    const accessToken = await getAccessToken();
    const paypalSub = await getPayPalSubscription(
      accessToken,
      paypalSubscriptionId,
    );

    const subscriber = paypalSub.subscriber as PayPalSubscriber | undefined;
    const resolved = resolvePaymentSource(subscriber);

    // Re-sync from PayPal against the EXISTING agreement. Nothing here creates
    // a subscription or a tenant: the customer keeps both, and this call only
    // refreshes the metadata PayPal reports for the agreement they already have.
    const outcome = await storePayPalPaymentMethod(admin, {
      tenantId,
      subscriptionRowId: subscription.id,
      paypalSubscriptionId,
      subscriber,
      context: "update-payment-method",
    });

    if (outcome === "failed") {
      return Response.json(
        {
          success: false,
          message: "Failed to update payment method in database.",
        },
        { status: 500 },
      );
    }

    // Where the customer actually changes the funding instrument.
    //
    // This integration creates subscriptions through PayPal's hosted approval
    // redirect, so the agreement is owned by the buyer's PayPal account and the
    // funding instrument behind it is changed in PayPal's own Automatic
    // Payments screen. That edits the existing agreement in place -- no second
    // PayPal account, no second subscription, no second tenant.
    //
    // PayPal's alternative, PATCH /v1/billing/subscriptions/{id} with
    // subscriber.payment_source, is documented for card-funded subscriptions
    // only and requires the raw card number, which needs Advanced Credit and
    // Debit Card Payments plus SAQ-D compliance. Neither is enabled on this
    // merchant account, so it is deliberately not attempted.
    const manageUrl = paypalAutopayUrl(BASE_URL);

    return Response.json({
      success: true,
      message:
        "Payment method synced from PayPal. Change the funding source in your PayPal account to update it.",
      manageUrl,
      // Kept for older clients that still read `updateUrl`.
      updateUrl: manageUrl,
      paymentMethod: {
        type: resolved.sourceType,
        brand: resolved.card?.brand ?? null,
        last4: resolved.card?.last4 ?? null,
        expiryMonth: resolved.card?.expiryMonth ?? null,
        expiryYear: resolved.card?.expiryYear ?? null,
        email: resolved.email,
      },
    });
  } catch (error) {
    console.error("Update payment method error:", error);
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
