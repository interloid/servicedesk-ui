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
  let data: any;

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

  if (!response.ok) {
    const data = await response.text();
    console.error(
      `PayPal cancel subscription ${paypalSubscriptionId} failed:`,
      response.status,
      data,
    );
    throw new Error(
      `Failed to cancel existing PayPal subscription: ${response.status}`,
    );
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
    const planId = body?.planId;
    const tenantSlug = body?.tenantSlug;

    if (!planId) {
      return Response.json(
        { success: false, message: "Plan ID is required." },
        { status: 400 },
      );
    }

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

    const { data: existingPaidSubscription, error: existingSubscriptionError } =
      await admin
        .from("subscriptions")
        .select("id,status,plan_id,paypal_subscription_id")
        .eq("tenant_id", tenantId)
        .not("paypal_subscription_id", "is", null)
        .not("paypal_subscription_id", "like", "FREE-%")
        .in("status", ["trialing", "active"])
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

    const isFreePlan = Number(plan.price_month) === 0;
    const accessToken = await getAccessToken();

    if (isFreePlan) {
      if (existingPaidSubscription?.paypal_subscription_id) {
        await cancelPayPalSubscription(
          accessToken,
          existingPaidSubscription.paypal_subscription_id,
        );
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

    if (existingPaidSubscription?.paypal_subscription_id) {
      await cancelPayPalSubscription(
        accessToken,
        existingPaidSubscription.paypal_subscription_id,
      );
    }

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
        subscriber: {
          email_address: user.email,
        },
        application_context: {
          brand_name: "ServiceDesk",
          user_action: "SUBSCRIBE_NOW",
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

    const { data: updatedSubscription, error: updateError } = await admin
      .from("subscriptions")
      .update({
        plan_id: plan.id,
        paypal_subscription_id: paypalSubscription.id,
        status: "trialing",
        seats: plan.seat_limit,
        current_period_end: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (updateError) {
      console.error("Subscription update failed:", updateError);
      return Response.json(
        {
          success: false,
          message: `Failed to update subscription: ${updateError.message}`,
          details: updateError.details ?? null,
        },
        { status: 400 },
      );
    }

    return Response.json({
      success: true,
      message: "PayPal subscription created successfully.",
      subscriptionId: paypalSubscription.id,
      approvalUrl,
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
