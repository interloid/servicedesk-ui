import { createPayPalTokenProvider } from "../_shared/paypal-auth.ts";
import { createPayPalSubscriptionsClient } from "../_shared/paypal-subscriptions.ts";

// Required at module load. With a non-null assertion a missing secret became
// the string "undefined" at runtime, and every webhook then failed as "Invalid
// webhook signature" -- indistinguishable from a real signature problem.
// Failing at startup names the missing variable instead.
function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();

  if (!value) {
    throw new Error(`${name} is missing`);
  }

  return value;
}

const CLIENT_ID = requireEnv("PAYPAL_CLIENT_ID");
const CLIENT_SECRET = requireEnv("PAYPAL_CLIENT_SECRET");
const PAYPAL_BASE_URL = requireEnv("PAYPAL_BASE_URL");
const PAYPAL_WEBHOOK_ID = requireEnv("PAYPAL_WEBHOOK_ID");

export const getAccessToken = createPayPalTokenProvider({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  baseUrl: PAYPAL_BASE_URL,
});

// The same agreement calls every billing function uses -- get / cancel /
// suspend / activate / revise -- so a webhook can never act on a subscription
// in a way the rest of the system would not.
export const paypal = createPayPalSubscriptionsClient({
  baseUrl: PAYPAL_BASE_URL,
  getAccessToken,
});

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
