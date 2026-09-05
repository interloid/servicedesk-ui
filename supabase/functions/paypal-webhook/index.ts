import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { verifyWebhookSignature } from "./paypal.ts";

import {
  handleSubscriptionActivated,
  handleSubscriptionCancelled,
  handleSubscriptionSuspended,
  handleSubscriptionUpdated,
  handleSubscriptionPaymentFailed,
  handlePaymentCompleted,
  handlePaymentDenied,
  handlePaymentRefunded,
} from "./handlers.ts";

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

    const rawBody = await req.text();

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
