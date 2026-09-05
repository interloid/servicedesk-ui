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

    if (action === "activate") {
      if (!subscriptionId) {
        return Response.json(
          { success: false, message: "Subscription ID is required." },
          { status: 400 },
        );
      }

      const { data: pendingSwitch, error: switchError } = await admin
        .from("subscription_switches")
        .select(
          "id, plan_id, paypal_subscription_id, old_paypal_subscription_id, status, effective_at",
        )
        .eq("paypal_subscription_id", subscriptionId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

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
        pendingSwitch.paypal_subscription_id,
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
          paypalSubscriptionId: pendingSwitch.paypal_subscription_id,
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

      const { error: activationError } = await admin
        .from("subscriptions")
        .update({
          plan_id: pendingSwitch.plan_id,
          paypal_subscription_id: pendingSwitch.paypal_subscription_id,
          status: "active",
          seats: plan?.seat_limit ?? 1,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId);

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
