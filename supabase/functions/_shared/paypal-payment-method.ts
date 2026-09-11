// Single source of truth for turning a PayPal subscription resource into a
// `payment_methods` row.
//
// WHY THIS EXISTS
// ---------------
// This project integrates PayPal through the hosted subscription approval
// redirect (POST /v1/billing/subscriptions -> `approve` link -> paypal.com).
// `subscriber.payment_source.card` is available when PayPal creates or
// resolves the subscription with a card payment source. In our tested
// wallet / hosted-checkout flows PayPal does not expose the underlying card,
// so `payment_source.card` never appears there.
//
// So `payment_source.card` missing is the normal, expected case here, not a
// race we can retry our way out of. This module therefore:
//   * records what PayPal actually reports, never a reconstructed card;
//   * never overwrites previously stored, valid card metadata with nulls when a
//     later event for the same subscription omits the payment source;
//   * is idempotent, so replayed webhooks update one row instead of inserting
//     duplicates.

// The three call sites build their Supabase client from different import
// specifiers, so the client is accepted structurally instead of by type.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural client (see deno note)
export type AdminClient = { from: (table: string) => any };

export interface PayPalCard {
  brand?: string;
  last_digits?: string;
  /** PayPal formats this as `YYYY-MM`. */
  expiry?: string;
  bin_details?: {
    bin?: string;
    issuing_bank?: string;
    bin_country_code?: string;
  };
}

export interface PayPalSubscriber {
  payer_id?: string;
  email_address?: string;
  /**
   * PayPal's own statement of which funding tenant approved the agreement,
   * e.g. "PAYPAL" for a wallet approval. Corroborates the classification
   * instead of leaving it inferred purely from a missing payment_source.
   */
  tenant?: string;
  /**
   * Only populated once the buyer approves. Through APPROVAL_PENDING the
   * subscriber block carries just the email the merchant supplied at creation,
   * so this arrives with BILLING.SUBSCRIPTION.ACTIVATED, not before.
   */
  name?: { given_name?: string; surname?: string };
  shipping_address?: {
    name?: { full_name?: string };
    address?: { country_code?: string };
  };
  /**
   * Present when PayPal creates or resolves the subscription with a card
   * payment source. In our tested wallet / hosted-checkout flows PayPal does
   * not expose the card behind it, so this is absent there.
   */
  payment_source?: { card?: PayPalCard };
}

export type PaymentSourceType = "card" | "paypal";

export interface ResolvedPaymentSource {
  sourceType: PaymentSourceType;
  hasCard: boolean;
  payerId: string | null;
  email: string | null;
  /** "Given Surname" when PayPal reports it, otherwise null. */
  payerName: string | null;
  payerCountry: string | null;
  /** Raw `subscriber.tenant`, kept for the logs as classification evidence. */
  payerTenant: string | null;
  card: {
    brand: string | null;
    last4: string | null;
    expiryMonth: number | null;
    expiryYear: number | null;
    bin: string | null;
    issuer: string | null;
    country: string | null;
  } | null;
}

/**
 * Normalises `subscriber` into the shape the `payment_methods` table stores.
 * A card is only reported when PayPal actually returned one; nothing is
 * inferred or reconstructed.
 */
export function resolvePaymentSource(
  subscriber?: PayPalSubscriber | null,
): ResolvedPaymentSource {
  const card = subscriber?.payment_source?.card;

  // A card object with no last_digits carries nothing displayable, so it is
  // treated the same as no card at all rather than producing an empty "card"
  // payment method.
  const hasCard = Boolean(card?.last_digits);

  let expiryMonth: number | null = null;
  let expiryYear: number | null = null;

  if (hasCard && card?.expiry) {
    const [year, month] = card.expiry.split("-");
    expiryMonth = Number.parseInt(month, 10) || null;
    expiryYear = Number.parseInt(year, 10) || null;
  }

  const payerName =
    [subscriber?.name?.given_name, subscriber?.name?.surname]
      .filter((part) => Boolean(part && part.trim()))
      .join(" ")
      .trim() ||
    subscriber?.shipping_address?.name?.full_name?.trim() ||
    null;

  return {
    sourceType: hasCard ? "card" : "paypal",
    hasCard,
    payerId: subscriber?.payer_id ?? null,
    email: subscriber?.email_address ?? null,
    payerName,
    payerCountry: subscriber?.shipping_address?.address?.country_code ?? null,
    payerTenant: subscriber?.tenant ?? null,
    card: hasCard
      ? {
          brand: card?.brand ?? null,
          last4: card?.last_digits ?? null,
          expiryMonth,
          expiryYear,
          bin: card?.bin_details?.bin ?? null,
          issuer: card?.bin_details?.issuing_bank ?? null,
          country: card?.bin_details?.bin_country_code ?? null,
        }
      : null,
  };
}

interface ExistingPaymentMethod {
  id: string;
  paypal_payment_token_id: string | null;
  paypal_customer_id: string | null;
  paypal_email: string | null;
  paypal_payer_name: string | null;
  paypal_payer_country: string | null;
  card_brand: string | null;
  card_last4: string | null;
  payment_source_type: string | null;
}

const EXISTING_COLUMNS =
  "id, paypal_payment_token_id, paypal_customer_id, paypal_email, " +
  "paypal_payer_name, paypal_payer_country, card_brand, card_last4, " +
  "payment_source_type";

async function findDefaultPaymentMethod(
  admin: AdminClient,
  tenantId: string,
): Promise<ExistingPaymentMethod | null> {
  // Deliberately not `.maybeSingle()`: that errors when historic data left more
  // than one default row behind, and the caller would then insert yet another.
  const { data, error } = await admin
    .from("payment_methods")
    .select(EXISTING_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[payment-method] lookup failed:", error.message);
    return null;
  }

  return (data?.[0] as ExistingPaymentMethod | undefined) ?? null;
}

export interface StorePaymentMethodArgs {
  tenantId: string;
  /** `subscriptions.id`, used to link the row back to the subscription. */
  subscriptionRowId?: string | null;
  /** The PayPal billing agreement / subscription id (`I-...`). */
  paypalSubscriptionId: string;
  subscriber?: PayPalSubscriber | null;
  /**
   * Optional authoritative re-read of the subscription, used only when the
   * event itself carried no card. Webhook payloads are point-in-time snapshots,
   * so this confirms against PayPal instead of assuming a card will turn up in
   * some later event -- it never will, because in our tested wallet /
   * hosted-checkout flows PayPal does not expose the underlying card.
   */
  fetchSubscriber?: () => Promise<PayPalSubscriber | null>;
  /** Free-text label for the logs, e.g. "webhook:activated". */
  context: string;
}

export type StoreOutcome = "inserted" | "updated" | "failed";

/**
 * Idempotently records the tenant's default payment method.
 *
 * Repeated deliveries of the same event land on the same row. When PayPal
 * reports no payment source for a subscription we already hold card metadata
 * for, the card columns are left untouched instead of being nulled out.
 */
export async function storePayPalPaymentMethod(
  admin: AdminClient,
  {
    tenantId,
    subscriptionRowId = null,
    paypalSubscriptionId,
    subscriber,
    fetchSubscriber,
    context,
  }: StorePaymentMethodArgs,
): Promise<StoreOutcome> {
  let resolved = resolvePaymentSource(subscriber);

  if (!resolved.hasCard && fetchSubscriber) {
    try {
      const fresh = await fetchSubscriber();

      if (fresh) {
        const confirmed = resolvePaymentSource(fresh);

        // Only ever an upgrade in information: a re-read that also reports no
        // card must not discard the identity the event did carry.
        if (confirmed.hasCard) {
          resolved = confirmed;
        } else {
          // No card will ever appear, but the re-read is still worth keeping:
          // a webhook payload is a point-in-time snapshot and the authoritative
          // subscription often carries payer identity the event omitted.
          resolved = {
            ...resolved,
            payerId: resolved.payerId ?? confirmed.payerId,
            email: resolved.email ?? confirmed.email,
            payerName: resolved.payerName ?? confirmed.payerName,
            payerCountry: resolved.payerCountry ?? confirmed.payerCountry,
            payerTenant: resolved.payerTenant ?? confirmed.payerTenant,
          };
        }
      }
    } catch (error) {
      console.error(
        `[payment-method] ${context} subscription=${paypalSubscriptionId} action=refetch_failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Card metadata is only ever carried forward for the *same* agreement. If the
  // tenant is now on a different PayPal subscription, the old card no longer
  // describes how they are billed and must not be inherited.
  const buildPayload = (row: ExistingPaymentMethod | null) => {
    const preserveCard =
      !resolved.hasCard &&
      row?.paypal_payment_token_id === paypalSubscriptionId &&
      Boolean(row?.card_last4);

    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      paypal_payment_token_id: paypalSubscriptionId,
      // Identity fields are only overwritten when PayPal supplies a value, so a
      // sparse event cannot erase the payer we already know about.
      paypal_customer_id: resolved.payerId ?? row?.paypal_customer_id ?? null,
      paypal_email: resolved.email ?? row?.paypal_email ?? null,
      paypal_payer_name: resolved.payerName ?? row?.paypal_payer_name ?? null,
      paypal_payer_country:
        resolved.payerCountry ?? row?.paypal_payer_country ?? null,
      is_default: true,
      status: "active",
      updated_at: new Date().toISOString(),
    };

    if (subscriptionRowId) {
      payload.subscription_id = subscriptionRowId;
    }

    // When preserving, every card_* column and payment_source_type is left off
    // the payload so the stored values survive untouched.
    if (!preserveCard) {
      payload.payment_source_type = resolved.sourceType;
      payload.card_brand = resolved.card?.brand ?? null;
      payload.card_last4 = resolved.card?.last4 ?? null;
      payload.card_expiry_month = resolved.card?.expiryMonth ?? null;
      payload.card_expiry_year = resolved.card?.expiryYear ?? null;
      payload.card_bin = resolved.card?.bin ?? null;
      payload.card_issuer = resolved.card?.issuer ?? null;
      payload.card_country = resolved.card?.country ?? null;
    }

    return { payload, preserveCard };
  };

  const existing = await findDefaultPaymentMethod(admin, tenantId);
  let { payload, preserveCard } = buildPayload(existing);

  if (preserveCard) {
  }

  let outcome: StoreOutcome;
  let paymentMethodId = existing?.id ?? null;

  if (existing) {
    const { error } = await admin
      .from("payment_methods")
      .update(payload)
      .eq("id", existing.id);

    if (error) {
      console.error(
        `[payment-method] ${context} subscription=${paypalSubscriptionId} action=update_failed:`,
        error.message,
      );
      return "failed";
    }

    outcome = "updated";
  } else {
    const { data, error } = await admin
      .from("payment_methods")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (error) {
      // 23505: a concurrent delivery won the race against the one-default-per-
      // tenant index. Fall back to updating whatever it created.
      if (error.code === "23505") {
        const winner = await findDefaultPaymentMethod(admin, tenantId);

        if (!winner) {
          console.error(
            `[payment-method] ${context} subscription=${paypalSubscriptionId} action=insert_conflict_unresolved`,
          );
          return "failed";
        }

        // Rebuilt against the row the winner created, so a racing delivery
        // that carried no card cannot blank out one that did.
        ({ payload, preserveCard } = buildPayload(winner));

        const { error: retryError } = await admin
          .from("payment_methods")
          .update(payload)
          .eq("id", winner.id);

        if (retryError) {
          console.error(
            `[payment-method] ${context} subscription=${paypalSubscriptionId} action=conflict_update_failed:`,
            retryError.message,
          );
          return "failed";
        }

        paymentMethodId = winner.id;
        outcome = "updated";
      } else {
        console.error(
          `[payment-method] ${context} subscription=${paypalSubscriptionId} action=insert_failed:`,
          error.message,
        );
        return "failed";
      }
    } else {
      paymentMethodId = (data as { id: string } | null)?.id ?? null;
      outcome = "inserted";
    }
  }

  if (!preserveCard) {
  }

  if (paymentMethodId && subscriptionRowId) {
    const { error: linkError } = await admin
      .from("subscriptions")
      .update({ payment_method_id: paymentMethodId })
      .eq("id", subscriptionRowId);

    if (linkError) {
      console.error(
        `[payment-method] ${context} subscription=${paypalSubscriptionId} action=link_failed:`,
        linkError.message,
      );
    }
  }

  return outcome;
}

/**
 * Where a customer changes the funding instrument behind an existing PayPal
 * billing agreement. This is PayPal's own "Automatic Payments" screen: it edits
 * the agreement in place, so the tenant keeps the same subscription and does not
 * need a second PayPal account.
 */
export function paypalAutopayUrl(paypalBaseUrl: string): string {
  const host = paypalBaseUrl.includes("sandbox")
    ? "https://www.sandbox.paypal.com"
    : "https://www.paypal.com";

  return `${host}/myaccount/autopay/`;
}
