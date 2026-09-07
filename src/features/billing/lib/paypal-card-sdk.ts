/**
 * PayPal JavaScript SDK v6 loader and card-fields capability probe.
 *
 * v6 replaces the v5 `paypal.CardFields(...)` global with an SDK instance:
 *
 *     <script src="https://www.paypal.com/web-sdk/v6/core">
 *     const sdk = await window.paypal.createInstance({ clientToken, components, pageType })
 *     const methods = await sdk.findEligibleMethods({ currencyCode })
 *     methods.isEligible("advanced_cards")
 *
 * Eligibility comes from `findEligibleMethods`, never from a timing probe.
 * v5's `isEligible()` reported only the funding-source flag and was true even
 * when the fields could not work, which is what made the old implementation
 * blame the merchant account for every failure.
 *
 * Card data is typed into iframes served by PayPal. Nothing here can read it:
 * the session posts it straight to PayPal and returns only the safe metadata
 * (brand, last four, expiry) that `payment_methods` stores.
 */

export type CardFieldStyle = Record<string, Record<string, string>>;

export interface CardFieldComponent {
  render: (target: string | HTMLElement) => Promise<void>;
  close?: () => Promise<void>;
}

export interface CardFieldsSession {
  /**
   * Returns an `HTMLElement`; mount it with `appendChild(...)` (NOT a
   * `.render()` callbox). Per the official v6 SDK reference.
   */
  createCardFieldsComponent: (options: {
    type: "name" | "number" | "expiry" | "cvv";
    placeholder?: string;
    style?: CardFieldStyle;
    inputEvents?: {
      onChange?: (state: { isFormValid?: boolean }) => void;
      onBlur?: (state: { isFormValid?: boolean }) => void;
    };
  }) => HTMLElement;
  /**
   * Submits the card against an **order id** created on your server. Card
   * fields sessions only ever charge orders (vaulting aside) -- there is no
   * card-fields session that attaches a card to a subscription in v6.
   */
  submit: (
    orderId: string,
    options?: {
      billingAddress?: { postalCode?: string; countryCode?: string };
    },
  ) => Promise<{ state: "succeeded" | "canceled" | "failed"; data?: unknown }>;
}

export interface EligibleMethods {
  isEligible: (method: string) => boolean;
  getDetails?: (method: string) => unknown;
}

export interface PayPalSdkInstance {
  findEligibleMethods: (options?: {
    currencyCode?: string;
  }) => Promise<EligibleMethods>;
  /**
   * Real v6 session factories, per the official v6 SDK reference.
   *
   * There is NO `createCardFieldsPaymentSession` and no card-fields session
   * bound to a subscription. Card fields are available for:
   *   - one-time payments: `createCardFieldsOneTimePaymentSession()` +
   *     `session.submit(orderId)`   (orders only, not subscriptions)
   *   - vaulting:          `createCardFieldsSavePaymentSession()`
   *
   * Whether a given factory exists on the loaded instance is probed at
   * runtime (see `inspectSdkInstance`), because exposure varies by merchant
   * account and can change as PayPal rolls the SDK out.
   */
  createCardFieldsOneTimePaymentSession?: (
    handlers?: unknown,
  ) => CardFieldsSession;
  createCardFieldsSavePaymentSession?: (
    handlers?: unknown,
  ) => CardFieldsSession;
}

interface PayPalV6Namespace {
  createInstance: (options: {
    clientToken: string;
    components: string[];
    pageType?: string;
  }) => Promise<PayPalSdkInstance>;
}

declare global {
  interface Window {
    paypal?: Partial<PayPalV6Namespace>;
  }
}

const SCRIPT_ID = "paypal-web-sdk-v6";

export type PayPalEnvironment = "sandbox" | "live";

function sdkHost(environment: PayPalEnvironment): string {
  return environment === "sandbox"
    ? "https://www.sandbox.paypal.com"
    : "https://www.paypal.com";
}

// Module-scoped so React Strict Mode's double-invoked effects, and any second
// dialog in the same page, reuse one script tag and one in-flight load.
let scriptPromise: { key: string; promise: Promise<PayPalV6Namespace> } | null =
  null;

// Strict Mode runs the calling effect twice with the same token; both runs
// share one SDK instance rather than each standing up its own.
let instancePromise: {
  key: string;
  promise: Promise<PayPalSdkInstance>;
} | null = null;

/** Loads the v6 core script at most once per environment. */
export function loadPayPalWebSdk(
  environment: PayPalEnvironment,
): Promise<PayPalV6Namespace> {
  if (scriptPromise?.key === environment) {
    return scriptPromise.promise;
  }

  const promise = new Promise<PayPalV6Namespace>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);

    const settle = () => {
      if (window.paypal?.createInstance) {
        resolve(window.paypal as PayPalV6Namespace);
      } else {
        // A blocked or partially served script still fires `load`, so callers
        // fall back rather than await a global that will never appear.
        scriptPromise = null;
        reject(new Error("PayPal SDK loaded without createInstance."));
      }
    };

    if (existing) {
      settle();
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `${sdkHost(environment)}/web-sdk/v6/core`;
    script.async = true;
    script.onload = settle;
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error("Could not reach PayPal."));
    };

    document.head.appendChild(script);
  });

  scriptPromise = { key: environment, promise };

  return promise;
}

/**
 * Asks the v6 SDK whether this merchant may run unbranded card processing.
 *
 * v6 is used only for this answer: `findEligibleMethods` is the documented,
 * authoritative eligibility source, and v5's `isEligible()` is not (it reports
 * the funding-source flag and is true even where the fields cannot work).
 * v6 itself cannot render the fields we need -- it exposes no subscription
 * session of any kind -- so rendering is left to v5 below.
 */
export async function checkAdvancedCardsEligibility({
  clientToken,
  environment,
  currencyCode = "USD",
}: {
  clientToken: string;
  environment: PayPalEnvironment;
  currencyCode?: string;
}): Promise<
  { eligible: true } | { eligible: false; status: string; reason: string }
> {
  let paypal: PayPalV6Namespace;

  try {
    paypal = await loadPayPalWebSdk(environment);
  } catch (error) {
    return {
      eligible: false,
      status: "sdk_load_failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const instanceKey = `${environment}:${clientToken}`;

  try {
    if (instancePromise?.key !== instanceKey) {
      instancePromise = {
        key: instanceKey,
        promise: paypal.createInstance({
          clientToken,
          components: ["card-fields"],
          pageType: "checkout",
        }),
      };
    }

    const sdk = await instancePromise.promise;
    const methods = await sdk.findEligibleMethods({ currencyCode });

    if (!methods.isEligible("advanced_cards")) {
      return {
        eligible: false,
        status: "not_eligible",
        reason: "findEligibleMethods reports advanced_cards is not eligible.",
      };
    }

    return { eligible: true };
  } catch (error) {
    // A rejected instance must not be cached, or every later attempt on this
    // page replays the same failure.
    instancePromise = null;
    return {
      eligible: false,
      status: "instance_failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Enumerates the function-named properties reachable on an SDK instance
 * (own properties plus the prototype chain), so the running merchant can be
 * told exactly which session factories PayPal actually exposed.
 *
 * This is the ground truth the whole card path hangs on: the set of factories
 * available varies by merchant and by sandbox/live. Logging it once per
 * checkout turns "does createCardFieldsPaymentSession exist?" from a guess
 * into an observability event.
 */
export function inspectSdkInstance(
  sdk: Record<string, unknown>,
  label: string,
): string[] {
  const names = new Set<string>();
  let cursor: unknown = sdk;

  while (cursor && cursor !== Object.prototype) {
    const proto = Object.getPrototypeOf(cursor) as Record<
      string,
      unknown
    > | null;
    if (!proto) break;

    for (const key of Object.getOwnPropertyNames(proto)) {
      const value = (cursor as Record<string, unknown>)[key];
      if (typeof value === "function") names.add(key);
    }
    cursor = proto;
  }

  const exposed = [...names].sort();
  console.log(`[PayPal] ${label} exposes session factories:`, exposed);
  return exposed;
}

/* ------------------------------------------------------------------ *
 * SDK v5 -- card fields bound to a subscription (legacy, `intent`
 * = "subscription"): the only build that can attach a card to an existing
 * agreement. v6 exposes card fields for orders and vaulting only, so if v6
 * exposes no usable session, v5 is consulted as the fallback.
 * ------------------------------------------------------------------ */

export interface V5CardFieldsInstance {
  isEligible: () => boolean;
  getState: () => Promise<{ isFormValid: boolean }>;
  submit: (data?: {
    billingAddress?: { postalCode?: string; countryCode?: string };
  }) => Promise<void>;
  NameField: (o?: V5FieldOptions) => CardFieldComponent;
  NumberField: (o?: V5FieldOptions) => CardFieldComponent;
  ExpiryField: (o?: V5FieldOptions) => CardFieldComponent;
  CVVField: (o?: V5FieldOptions) => CardFieldComponent;
}

interface V5FieldOptions {
  placeholder?: string;
  inputEvents?: {
    onChange?: (state: { isFormValid: boolean }) => void;
    onBlur?: (state: { isFormValid: boolean }) => void;
  };
}

interface V5Namespace {
  CardFields: (options: {
    createSubscription: () => Promise<string>;
    onApprove: (data: {
      subscriptionId?: string;
      subscriptionID?: string;
    }) => void;
    onError: (error: unknown) => void;
    style?: CardFieldStyle;
  }) => V5CardFieldsInstance;
}

const V5_SCRIPT_ID = "paypal-sdk-v5-card-fields";

let v5Promise: { key: string; promise: Promise<V5Namespace> } | null = null;

/**
 * Loads the v5 SDK configured for card-funded subscriptions.
 *
 * `data-sdk-client-token` is mandatory here -- v5 throws
 * "SDK Token must be passed in for createSubscription" without it. The token
 * must be minted for the origin serving this page (see PAYPAL_TOKEN_DOMAINS);
 * an unbound token is why this path fails on localhost, which PayPal will not
 * accept as a bindable domain.
 *
 * v5 and v6 both own `window.paypal`, so this deliberately loads *after* any
 * v6 eligibility check has already resolved.
 */
export function loadPayPalV5CardFields({
  clientId,
  sdkToken,
  environment,
}: {
  clientId: string;
  sdkToken: string;
  environment: PayPalEnvironment;
}): Promise<V5Namespace> {
  const key = `${environment}:${clientId}:${sdkToken}`;

  if (v5Promise?.key === key) return v5Promise.promise;

  const promise = new Promise<V5Namespace>((resolve, reject) => {
    document.getElementById(V5_SCRIPT_ID)?.remove();

    const params = new URLSearchParams({
      "client-id": clientId,
      components: "card-fields",
      intent: "subscription",
      vault: "true",
    });

    const script = document.createElement("script");
    script.id = V5_SCRIPT_ID;
    script.src = `${sdkHost(environment)}/sdk/js?${params.toString()}`;
    script.setAttribute("data-sdk-client-token", sdkToken);
    script.async = true;

    script.onload = () => {
      const ns = window.paypal as unknown as V5Namespace | undefined;
      if (ns?.CardFields) {
        resolve(ns);
      } else {
        v5Promise = null;
        reject(new Error("v5 SDK loaded without CardFields."));
      }
    };

    script.onerror = () => {
      v5Promise = null;
      script.remove();
      reject(new Error("Could not reach PayPal."));
    };

    document.head.appendChild(script);
  });

  v5Promise = { key, promise };

  return promise;
}

/**
 * Confirms the fields actually came alive.
 *
 * v5's `isEligible()` cannot be trusted on its own: it returns true even when
 * the child frames never register, which leaves empty grey boxes the buyer
 * cannot type into. `getState()` resolving is the proof that they did.
 */
export async function verifyCardFieldsBooted(
  fields: V5CardFieldsInstance,
  timeoutMs: number,
): Promise<boolean> {
  return Promise.race([
    fields
      .getState()
      .then(() => true)
      .catch(() => false),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), timeoutMs),
    ),
  ]);
}

/** The height each field container reserves for PayPal's iframe, in px. */
export const CARD_FIELD_HEIGHT = 44;

/**
 * Matches the hosted fields to the surrounding form in the active theme.
 *
 * `height` is load-bearing, not cosmetic: PayPal sizes the wrapper it injects
 * from this value and writes it as an inline style. Left unset it picks its own
 * (~63-78px) and, because that wrapper sits in normal flow, the iframe spills
 * past a shorter container and covers whatever follows it. `padding` and
 * `font-size` do not affect that height -- only this does.
 *
 * `background-color` is deliberately absent: PayPal ignores it, as Braintree's
 * hosted fields do, so the iframe keeps its own field background.
 */
export function cardFieldStyle(isDark: boolean): CardFieldStyle {
  const foreground = isDark ? "#f8fafc" : "#0f172a";
  const placeholder = isDark ? "#64748b" : "#94a3b8";

  return {
    input: {
      "font-size": "14px",
      "font-family":
        "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
      color: foreground,
      padding: "0 12px",
      height: `${CARD_FIELD_HEIGHT}px`,
    },
    ":focus": { color: foreground },
    ".invalid": { color: isDark ? "#f87171" : "#dc2626" },
    "::placeholder": { color: placeholder },
  };
}
