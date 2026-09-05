import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const subscriber = paypalSub.subscriber as
      Record<string, unknown> | undefined;
    const paymentSource = subscriber?.payment_source as
      Record<string, unknown> | undefined;
    const card = paymentSource?.card as Record<string, unknown> | undefined;

    const cardBrand = (card?.brand as string) || null;
    const cardLast4 = (card?.last_digits as string) || null;
    const cardExpiry = (card?.expiry as string) || null;
    const cardBin = (card?.bin_details?.bin as string) || null;
    const cardIssuer = (card?.bin_details?.issuing_bank as string) || null;
    const cardCountry = (card?.bin_details?.bin_country_code as string) || null;

    let expiryMonth: number | null = null;
    let expiryYear: number | null = null;
    if (cardExpiry) {
      const parts = cardExpiry.split("-");
      if (parts.length === 2) {
        expiryMonth = parseInt(parts[1], 10) || null;
        expiryYear = parseInt(parts[0], 10) || null;
      }
    }

    const paymentMethodData = {
      tenant_id: tenantId,
      subscription_id: subscription.id,
      paypal_payment_token_id: paypalSubscriptionId,
      paypal_customer_id: (subscriber?.payer_id as string) || null,
      paypal_email: (subscriber?.email_address as string) || null,
      card_brand: cardBrand,
      card_last4: cardLast4,
      card_expiry_month: expiryMonth,
      card_expiry_year: expiryYear,
      card_bin: cardBin,
      card_issuer: cardIssuer,
      card_country: cardCountry,
      payment_source_type: card ? "card" : "paypal",
      is_default: true,
      status: "active",
    };

    const { data: existingPM } = await admin
      .from("payment_methods")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .maybeSingle();

    if (existingPM) {
      await admin
        .from("payment_methods")
        .update(paymentMethodData)
        .eq("id", existingPM.id);
    } else {
      await admin.from("payment_methods").insert(paymentMethodData);
    }

    return Response.json({
      success: true,
      message: "Payment method updated successfully.",
      paymentMethod: {
        brand: cardBrand,
        last4: cardLast4,
        expiry: cardExpiry,
        type: paymentSource ? Object.keys(paymentSource)[0] : "paypal",
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
