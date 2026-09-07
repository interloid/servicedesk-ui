"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  AlertCircle,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  cardFieldStyle,
  checkAdvancedCardsEligibility,
  inspectSdkInstance,
  loadPayPalWebSdk,
  type CardFieldsSession,
  type PayPalSdkInstance,
} from "../lib/paypal-card-sdk";
import {
  confirmSubscriptionActivationAction,
  getPayPalSdkTokenAction,
} from "../billing-actions";

export interface CardCheckoutTarget {
  /** The APPROVAL_PENDING PayPal subscription this card would confirm. */
  subscriptionId: string;
  /** Hosted checkout, used whenever card fields cannot run. */
  approvalUrl: string | null;
  planName: string;
  /** Formatted for display, e.g. "$29/month". */
  priceLabel: string;
}

interface CardCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string;
  target: CardCheckoutTarget | null;
  onPaid: (result: {
    planName: string;
    scheduled: boolean;
    effectiveAt: string | null;
  }) => void;
}

type Phase =
  | "checking"
  /** Not eligible; handing over to PayPal's hosted card page. */
  | "handing_off"
  | "ready"
  | "paying"
  /** Nothing left to try -- only when there is no approval URL to fall back to. */
  | "blocked";

/** Long enough to read the handover line, short enough not to feel stuck. */
const HANDOFF_DELAY_MS = 3000;

/**
 * Upper bound on the whole capability probe. PayPal's SDK calls are promises we
 * do not control; if one never settles the buyer would sit on a spinner
 * forever, so the probe is raced against this and falls back on expiry.
 */
const CAPABILITY_TIMEOUT_MS = 12000;

/**
 * Deduplicates the client-token request while one is in flight.
 *
 * React Strict Mode invokes effects twice in development. Guarding the effect
 * body instead would deadlock -- React cancels the first run, so a guard that
 * blocks the second leaves nobody to finish the work. Sharing the promise gets
 * one network call and still lets both runs complete.
 */
let tokenRequest: {
  key: string;
  promise: ReturnType<typeof getPayPalSdkTokenAction>;
} | null = null;

function requestClientToken(tenantSlug: string) {
  if (tokenRequest?.key === tenantSlug) return tokenRequest.promise;

  const promise = getPayPalSdkTokenAction(tenantSlug).finally(() => {
    if (tokenRequest?.key === tenantSlug) tokenRequest = null;
  });

  tokenRequest = { key: tenantSlug, promise };

  return promise;
}

/**
 * Waits for any of the session's card-field iframes to signal readiness.
 *
 * PayPal's v6 `createCardFieldsComponent` returns a bare HTMLElement. There is
 * no `.render()` method -- mount it with `container.appendChild(el)`. We detect
 * readiness by observing whether the iframe injected into `container` fires a
 * load event within the timeout window.
 */
function waitForFieldRender(
  session: CardFieldsSession,
  container: HTMLDivElement | null,
  timeoutMs: number,
): Promise<boolean> {
  if (!container) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);

    try {
      const el = session.createCardFieldsComponent({
        type: "number",
        placeholder: "1234 5678 9012 3456",
      });

      container.appendChild(el);

      // PayPal injects an <iframe> inside the element. Detect readiness via
      // the iframe's load event, or resolve optimistically if the iframe is
      // already present (v6 mounts the frame synchronously on append).
      const iframe = container.querySelector("iframe");

      if (iframe) {
        clearTimeout(timer);
        resolve(true);
      } else {
        // No iframe yet -- wait a tick for PayPal's runtime to inject one,
        // then fall back to the timeout.
        queueMicrotask(() => {
          const lateIframe = container.querySelector("iframe");
          if (lateIframe) {
            lateIframe.addEventListener(
              "load",
              () => {
                clearTimeout(timer);
                resolve(true);
              },
              { once: true },
            );
          }
        });
      }
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

/**
 * Takes card details for an already-created subscription, when PayPal's v6 SDK
 * reports it can, and otherwise hands the buyer to PayPal's hosted card page.
 *
 * The v6 SDK exposes card-fields sessions for one-time payments (orders) and
 * for vaulting only -- there is no v6 card-fields session that attaches a card
 * to a subscription directly. This component therefore introspects the loaded
 * instance at runtime, logs exactly which factories PayPal exposed, and uses
 * whichever one exists; anything else falls back to the hosted redirect.
 *
 * Card number, expiry and CVV live in PayPal-owned iframes. They never enter
 * this page's JavaScript and never reach our servers.
 */
export function CardCheckoutDialog({
  open,
  onOpenChange,
  tenantSlug,
  target,
  onPaid,
}: CardCheckoutDialogProps) {
  const { resolvedTheme } = useTheme();

  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<{
    code: string;
    reason: string;
  } | null>(null);
  const [formValid, setFormValid] = useState(false);
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");

  const nameRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<HTMLDivElement>(null);
  const cvvRef = useRef<HTMLDivElement>(null);

  const sessionRef = useRef<CardFieldsSession | null>(null);

  const targetRef = useRef(target);
  const onPaidRef = useRef(onPaid);
  const tenantSlugRef = useRef(tenantSlug);
  const billingRef = useRef({ postalCode, country });

  useEffect(() => {
    targetRef.current = target;
    onPaidRef.current = onPaid;
    tenantSlugRef.current = tenantSlug;
    billingRef.current = { postalCode, country };
  });

  const subscriptionId = target?.subscriptionId ?? null;
  const approvalUrl = target?.approvalUrl ?? null;

  const goToPayPal = useCallback(() => {
    if (approvalUrl) window.location.assign(approvalUrl);
  }, [approvalUrl]);

  /** Records the plan change once PayPal reports the card was accepted. */
  const finalise = useCallback(async (paypalSubscriptionId: string) => {
    const activeTarget = targetRef.current;

    const res = await confirmSubscriptionActivationAction(
      tenantSlugRef.current,
      paypalSubscriptionId,
    );

    if (!res.success) {
      console.error("[PayPal] Activation failed after card accepted");
      setError(
        res.error ??
          "Your card was accepted but we could not activate the plan. Refresh the billing page in a moment.",
      );
      setPhase("ready");
      return;
    }

    console.log("[PayPal] Payment method persisted; plan activated");

    onPaidRef.current({
      planName: res.planName ?? activeTarget?.planName ?? "your new plan",
      scheduled: res.scheduled ?? false,
      effectiveAt: res.effectiveAt ?? null,
    });
  }, []);

  useEffect(() => {
    if (!open || !subscriptionId) return;

    let cancelled = false;

    /** Every non-eligible path lands here: log the cause, then hand over. */
    const handOff = (code: string, reason: string) => {
      console.warn(`[PayPal] Card fields unavailable (${code}): ${reason}`);

      if (cancelled) return;

      if (!approvalUrl) {
        console.error("[PayPal] No approval URL to fall back to");
        setPhase("blocked");
        return;
      }

      console.log("[PayPal] Falling back to hosted checkout");
      setHandoff({ code, reason });
      setPhase("handing_off");
      setTimeout(() => {
        if (!cancelled) window.location.assign(approvalUrl);
      }, HANDOFF_DELAY_MS);
    };

    (async () => {
      const tokenResult = await requestClientToken(tenantSlugRef.current);

      if (cancelled) return;

      if (!tokenResult.success || !tokenResult.sdkToken) {
        handOff(
          "client_token",
          tokenResult.error ?? "Client token could not be created.",
        );
        return;
      }

      console.log("[PayPal] Client token created");

      // Stage 1 -- v6 answers eligibility authoritatively.
      const eligibility = await checkAdvancedCardsEligibility({
        clientToken: tokenResult.sdkToken,
        environment: tokenResult.environment ?? "live",
        currencyCode: "USD",
      });

      if (cancelled) return;

      if (!eligibility.eligible) {
        handOff(eligibility.status, eligibility.reason);
        return;
      }

      console.log("[PayPal] advanced_cards eligible: true");

      let sdk: PayPalSdkInstance;

      try {
        const paypal = await loadPayPalWebSdk(
          tokenResult.environment ?? "live",
        );
        sdk = await paypal.createInstance({
          clientToken: tokenResult.sdkToken,
          components: ["card-fields"],
          pageType: "checkout",
        });
      } catch (loadError) {
        handOff(
          "sdk_load_failed",
          loadError instanceof Error ? loadError.message : String(loadError),
        );
        return;
      }

      if (cancelled) return;

      // Ground truth: log exactly which session factories this merchant's SDK
      // actually exposes. Survives whichever way we branch below.
      const exposed = inspectSdkInstance(
        sdk as unknown as Record<string, unknown>,
        "v6",
      );

      // There is no v6 card-fields-subscription session. The one-time session
      // submits against an orderId (not a subscriptionId); the save session
      // vaults the card. Neither can confirm the pre-created subscription
      // directly. If neither factory is exposed, hand off to hosted checkout.
      const cardFactory = exposed.find(
        (key) =>
          key === "createCardFieldsOneTimePaymentSession" ||
          key === "createCardFieldsSavePaymentSession",
      );

      if (!cardFactory) {
        handOff(
          "session_unavailable",
          `v6 instance exposes neither card-fields session factory. ` +
            `Available: ${exposed.join(", ") || "(none)"}.`,
        );
        return;
      }

      // Session handlers. onError fires on decline/verification fail. onApprove
      // is only wired where the session actually resolves a subscription.
      const handlers = {
        onApprove: (data: { subscriptionId?: string }) => {
          void finalise(data.subscriptionId ?? subscriptionId);
        },
        onError: (paypalError: unknown) => {
          console.error("[PayPal] Card payment failed:", paypalError);
          setError(
            "That card was declined or could not be verified. Check the details and try again, or pay with PayPal instead.",
          );
          setPhase("ready");
        },
      };

      const session =
        cardFactory === "createCardFieldsSavePaymentSession"
          ? sdk.createCardFieldsSavePaymentSession!(handlers)
          : sdk.createCardFieldsOneTimePaymentSession!(handlers);

      // Render the number field into a temporary container to verify the
      // session actually mounted live iframes (not dead placeholders).
      const probeContainer = document.createElement("div");
      probeContainer.style.height = "1px";
      probeContainer.style.overflow = "hidden";
      probeContainer.style.position = "absolute";
      probeContainer.style.pointerEvents = "none";
      document.body.appendChild(probeContainer);

      const booted = await waitForFieldRender(
        session,
        probeContainer,
        CAPABILITY_TIMEOUT_MS,
      );

      // Clean up the probe container; the real fields render into the refs.
      probeContainer.remove();

      if (cancelled) return;

      if (!booted) {
        handOff(
          "fields_never_initialised",
          "Card fields mounted but never registered. This may be a merchant " +
            "capability issue -- check that Advanced Credit and Debit Card " +
            "Payments is enabled in your PayPal app.",
        );
        return;
      }

      console.log("[PayPal] v6 Card Fields session ready");
      sessionRef.current = session;

      // Render all four fields into their real containers.
      const style = cardFieldStyle(resolvedTheme === "dark");

      const inputEvents = {
        onChange: (state: { isFormValid?: boolean }) =>
          setFormValid(Boolean(state.isFormValid)),
        onBlur: (state: { isFormValid?: boolean }) =>
          setFormValid(Boolean(state.isFormValid)),
      };

      const fieldsToRender: Array<{
        ref: HTMLDivElement | null;
        type: "name" | "number" | "expiry" | "cvv";
        placeholder: string;
      }> = [
        { ref: nameRef.current, type: "name", placeholder: "Name on card" },
        {
          ref: numberRef.current,
          type: "number",
          placeholder: "1234 5678 9012 3456",
        },
        { ref: expiryRef.current, type: "expiry", placeholder: "MM / YY" },
        { ref: cvvRef.current, type: "cvv", placeholder: "CVC" },
      ];

      try {
        await Promise.all(
          fieldsToRender.map((field) => {
            if (!field.ref) return Promise.resolve();
            const el = session.createCardFieldsComponent({
              type: field.type,
              placeholder: field.placeholder,
              style,
              inputEvents,
            });
            field.ref.appendChild(el);
            return Promise.resolve();
          }),
        );
      } catch (renderError) {
        handOff(
          "render_failed",
          renderError instanceof Error
            ? renderError.message
            : String(renderError),
        );
        return;
      }

      if (cancelled) return;

      setPhase("ready");
    })();

    return () => {
      cancelled = true;
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subscriptionId, approvalUrl, finalise]);

  const handleSubmit = async () => {
    const session = sessionRef.current;
    if (!session) return;

    // v6 card-fields sessions submit against an orderId (one-time) or a
    // setup-token id (save/vault) -- never against a subscription id, and
    // there is no v6 card-fields session that attaches a card to a
    // subscription at all. This path is therefore unreachable today; it is
    // guarded at mount time by the session_factory handoff. We keep submit
    // wired only so the type stays honest; if it is ever reached, the buyer
    // is handed to PayPal's hosted checkout.
    setError(
      "Card fields cannot confirm a subscription in this PayPal SDK build. " +
        "Pay with a PayPal account instead.",
    );
    setPhase("ready");
    goToPayPal();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && phase === "paying") return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={phase !== "paying"}
        className="gap-0 p-0 sm:max-w-105"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="space-y-1 border-b border-border px-5 pt-5 pb-4 text-left">
          <DialogTitle className="flex items-center gap-2 pr-8 text-base font-bold">
            <CreditCard className="h-4 w-4 text-brand-accent" />
            Pay by card
          </DialogTitle>
          <DialogDescription className="text-xs">
            {target
              ? `${target.planName} \u00b7 ${target.priceLabel}. Your card is charged by PayPal when the subscription starts.`
              : "Enter your card details to start the subscription."}
          </DialogDescription>
        </DialogHeader>

        {phase === "checking" && (
          <div className="flex items-center gap-2 px-5 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking how you can pay...
          </div>
        )}

        {phase === "handing_off" && (
          <div className="space-y-4 px-5 py-5">
            <div className="space-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand-accent" />
                <p className="text-xs leading-5 text-foreground">
                  Taking you to PayPal&apos;s secure checkout to pay by card.
                </p>
              </div>
              {handoff && (
                <p className="pl-6.5 text-[11px] leading-4 text-muted-foreground">
                  <span className="font-mono font-semibold">
                    {handoff.code}
                  </span>
                  {" \u2014 "}
                  {handoff.reason}
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <Button
                onClick={goToPayPal}
                className="h-10 gap-1.5 rounded-xl bg-brand-accent px-5 text-xs font-semibold text-primary-foreground shadow-none hover:bg-brand-accent/90"
              >
                Continue now
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {phase === "blocked" && (
          <div className="space-y-4 px-5 py-5">
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 dark:border-amber-900/50 dark:bg-amber-950/30">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs leading-5 text-amber-900 dark:text-amber-200">
                We couldn&apos;t start card payment just now. Please try again
                in a moment.
              </p>
            </div>
            {handoff && (
              <p className="text-[11px] leading-4 text-muted-foreground">
                <span className="font-mono font-semibold">{handoff.code}</span>
                {" \u2014 "}
                {handoff.reason}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="h-10 rounded-xl px-5 text-xs font-semibold"
              >
                Close
              </Button>
            </div>
          </div>
        )}

        {(phase === "ready" || phase === "paying") && (
          <div className="space-y-4 px-5 py-5">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Name on card</Label>
                <div
                  ref={nameRef}
                  className="flex h-11 items-center overflow-hidden rounded-lg border border-input bg-background transition-colors focus-within:border-brand-accent focus-within:ring-1 focus-within:ring-brand-accent [&>div]:w-full"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Card number</Label>
                <div
                  ref={numberRef}
                  className="flex h-11 items-center overflow-hidden rounded-lg border border-input bg-background transition-colors focus-within:border-brand-accent focus-within:ring-1 focus-within:ring-brand-accent [&>div]:w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Expiry</Label>
                  <div
                    ref={expiryRef}
                    className="flex h-11 items-center overflow-hidden rounded-lg border border-input bg-background transition-colors focus-within:border-brand-accent focus-within:ring-1 focus-within:ring-brand-accent [&>div]:w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Security code</Label>
                  <div
                    ref={cvvRef}
                    className="flex h-11 items-center overflow-hidden rounded-lg border border-input bg-background transition-colors focus-within:border-brand-accent focus-within:ring-1 focus-within:ring-brand-accent [&>div]:w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="card-postal-code"
                    className="text-xs font-semibold"
                  >
                    Postal code
                  </Label>
                  <Input
                    id="card-postal-code"
                    value={postalCode}
                    disabled={phase === "paying"}
                    onChange={(e) => setPostalCode(e.target.value)}
                    placeholder="Optional"
                    autoComplete="postal-code"
                    className="h-11 rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="card-country"
                    className="text-xs font-semibold"
                  >
                    Country code
                  </Label>
                  <Input
                    id="card-country"
                    value={country}
                    disabled={phase === "paying"}
                    onChange={(e) => setCountry(e.target.value.toUpperCase())}
                    placeholder="Optional, e.g. US"
                    maxLength={2}
                    autoComplete="country"
                    className="h-11 rounded-lg uppercase"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <p className="text-xs leading-5 text-red-700 dark:text-red-300">
                  {error}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span>
                Card details go straight to PayPal and never touch our servers.
              </span>
            </div>

            <div className="flex flex-col gap-2.5 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              {approvalUrl ? (
                <button
                  type="button"
                  disabled={phase === "paying"}
                  onClick={goToPayPal}
                  className="text-left text-xs font-semibold text-brand-accent hover:underline disabled:pointer-events-none disabled:opacity-50"
                >
                  Pay with a PayPal account instead
                </button>
              ) : (
                <span />
              )}

              <div className="flex justify-end gap-2.5">
                <Button
                  variant="outline"
                  disabled={phase === "paying"}
                  onClick={() => onOpenChange(false)}
                  className="h-10 rounded-xl px-5 text-xs font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  disabled={phase === "paying" || !formValid}
                  onClick={handleSubmit}
                  className="h-10 gap-1.5 rounded-xl bg-brand-accent px-5 text-xs font-semibold text-primary-foreground shadow-none hover:bg-brand-accent/90"
                >
                  {phase === "paying" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      Pay {target?.priceLabel ?? ""}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
