import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { verifyWebhookSignature } from "./paypal.ts";

import {
  handleSubscriptionActivated,
  handleSubscriptionCancelled,
  handleSubscriptionSuspended,
  handleSubscriptionUpdated,
  handleSubscriptionPaymentFailed,
  handlePaymentCompleted,
  handleOrderCompleted,
  handlePaymentDenied,
  handlePaymentRefunded,
} from "./handlers.ts";

// PayPal webhook events are a few KB. This function is public (verify_jwt is
// off), so the body is capped before it is buffered and before a PayPal
// signature-verification round trip is spent on it.
const MAX_BODY_BYTES = 512 * 1024;

// Returns null when the body exceeds maxBytes. Content-Length is checked first,
// but it is optional (chunked uploads), so the stream is counted as well.
async function readBodyWithLimit(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
  const declaredLength = Number(req.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return null;
  }

  if (!req.body) {
    return "";
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    received += value.byteLength;

    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }

    chunks.push(value);
  }

  const body = new Uint8Array(received);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

serve(async (req) => {
  try {
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

    const rawBody = await readBodyWithLimit(req, MAX_BODY_BYTES);

    if (rawBody === null) {
      return Response.json(
        {
          success: false,
          message: "Payload Too Large",
        },
        {
          status: 413,
        },
      );
    }

    const isValid = await verifyWebhookSignature(req, rawBody);

    if (!isValid) {
      return Response.json(
        {
          success: false,
          message: "Invalid webhook signature",
        },
        {
          status: 401,
        },
      );
    }

    const event = JSON.parse(rawBody);

    switch (event.event_type) {
      case "BILLING.SUBSCRIPTION.ACTIVATED":
        await handleSubscriptionActivated(event);
        break;

      case "BILLING.SUBSCRIPTION.CANCELLED":
        await handleSubscriptionCancelled(event);
        break;

      case "BILLING.SUBSCRIPTION.SUSPENDED":
        await handleSubscriptionSuspended(event);
        break;

      case "BILLING.SUBSCRIPTION.UPDATED":
        await handleSubscriptionUpdated(event);
        break;

      case "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
        await handleSubscriptionPaymentFailed(event);
        break;

      case "PAYMENT.SALE.COMPLETED":
        await handlePaymentCompleted(event);
        break;

      case "CHECKOUT.ORDER.COMPLETED":
        await handleOrderCompleted(event);
        break;

      // Sandbox emits capture-level events for one-time (upgrade) orders.
      case "PAYMENT.CAPTURE.COMPLETED":
        await handleOrderCompleted(event);
        break;

      case "PAYMENT.SALE.DENIED":
        await handlePaymentDenied(event);
        break;

      case "PAYMENT.SALE.REFUNDED":
        await handlePaymentRefunded(event);
        break;

      default:
        break;
    }

    return Response.json({
      success: true,
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      },
      {
        status: 500,
      },
    );
  }
});
