const CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET")!;
const PAYPAL_BASE_URL = Deno.env.get("PAYPAL_BASE_URL")!;
const PAYPAL_WEBHOOK_ID = Deno.env.get("PAYPAL_WEBHOOK_ID")!;

export async function getAccessToken(): Promise<string> {
  const auth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(data);
    throw new Error("Unable to generate PayPal access token.");
  }

  return data.access_token;
}

export async function verifyWebhookSignature(
  req: Request,
  rawBody: string,
): Promise<boolean> {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: req.headers.get("paypal-auth-algo"),

        cert_url: req.headers.get("paypal-cert-url"),

        transmission_id: req.headers.get("paypal-transmission-id"),

        transmission_sig: req.headers.get("paypal-transmission-sig"),

        transmission_time: req.headers.get("paypal-transmission-time"),

        webhook_id: PAYPAL_WEBHOOK_ID,

        webhook_event: JSON.parse(rawBody),
      }),
    },
  );
  const result = await response.json();
  if (!response.ok) {
    console.error(result);
    return false;
  }

  return result.verification_status === "SUCCESS";
}

export async function getSubscription(
  subscriptionId: string,
): Promise<Record<string, unknown>> {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/billing/subscriptions/${subscriptionId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    console.error(
      `PayPal get subscription ${subscriptionId} failed:`,
      response.status,
      await response.text(),
    );
    throw new Error(`Failed to get subscription ${subscriptionId}.`);
  }

  return response.json();
}

export async function cancelSubscription(
  subscriptionId: string,
): Promise<void> {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/billing/subscriptions/${subscriptionId}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Replaced by a new subscription" }),
    },
  );

  if (!response.ok) {
    console.error(
      `PayPal cancel subscription ${subscriptionId} failed:`,
      response.status,
      await response.text(),
    );
    throw new Error(`Failed to cancel subscription ${subscriptionId}.`);
  }
}
