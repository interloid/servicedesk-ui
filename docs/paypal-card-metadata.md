# How cards are taken, and when card metadata exists

## Two ways a subscription gets approved

Both start with the same server-side call, which returns a subscription in
`APPROVAL_PENDING`:

```
POST /v1/billing/subscriptions        (supabase/functions/subscription)
```

What happens next depends on what the buyer picked in the plan-switch dialog:

**PayPal account** — the buyer follows `links[rel=approve]` to paypal.com and
chooses the funding instrument inside PayPal's own checkout:

```
browser redirect to paypal.com -> return_url /{tenantSlug}/payment/success
```

**Debit or credit card** — the browser confirms the same subscription from
PayPal's hosted card fields, without leaving this app. This path requires an
entitlement the account does not currently have (see _Merchant eligibility_
below), so today it always falls back to the redirect:

```
paypal.CardFields({ createSubscription: () => subscriptionId })
  -> cardFields.submit()
  -> POST /v1/billing/subscriptions/{id}/confirm   (from PayPal's iframe)
  -> onApprove -> confirmSubscriptionActivationAction
```

The card number, expiry and CVV are typed into iframes served by PayPal. They
never enter this app's JavaScript and never reach our servers, so this stays a
SAQ-A integration — the raw PAN is only in scope for the merchant-side
`confirm` call, which we do not make.

## What the browser needs

`CardFields` refuses `createSubscription` without an SDK client token
(`SDK Token must be passed in for createSubscription`). It is minted by the
`subscription` Edge Function under `action: "sdk-token"`, and only after the
caller's billing membership has been re-checked:

```
POST /v1/oauth2/token
grant_type=client_credentials&response_type=client_token
  -> access_token (a JWT, ~15 min)
```

The browser receives only that token, passed as `data-sdk-client-token` on the
SDK script tag. The merchant secret stays server-side.

## Card-funded subscriptions: not available on this merchant

Every documented route was tested against this account. All four are closed.

| Route                                                       | Result                                                                                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v6 `createCardFieldsSubscriptionSession`                    | Does not exist. v6 exposes only `createCardFieldsOneTimePaymentSession` and `createCardFieldsSavePaymentSession` — and no `createPayPalSubscriptionSession` either, with both components requested |
| v6 `createCardFieldsSavePaymentSession` → vault → subscribe | `POST /v3/vault/setup-tokens` → **403 NOT_AUTHORIZED**; token carries only the deprecated `v1/vault/credit-card` scope                                                                             |
| v5 `CardFields({ createSubscription })`                     | Fields mount but never register, **including on an origin the client token is bound to**                                                                                                           |
| Hosted redirect → guest card form                           | `guestEnabled: false` on every intent (capture, capture+vault, subscription)                                                                                                                       |
| `subscriber.payment_source.token` at creation               | Accepted but ignored; subscription still returns `APPROVAL_PENDING`                                                                                                                                |

`advanced_cards` eligibility is **true** — the merchant can process cards. That
permits card acceptance, not origination of a card-funded billing agreement;
the two are separate entitlements and only the first is granted here.

### Hypotheses tested and rejected

Recorded so they are not re-litigated:

- _"The merchant is not enabled for advanced cards."_ Wrong — v6
  `findEligibleMethods` returns `advanced_cards: true`.
- _"The client token is inert because `scope`/`options` decode empty."_ Wrong —
  that is normal for this JWT; the real scopes are in the response body.
- _"The client token must be bound to the serving origin via `domains[]`."_
  Wrong — with `PAYPAL_TOKEN_DOMAINS=servicedesk-ui.vercel.app` set and the app
  served from that exact domain, v5 card fields still reported
  `fields_never_initialised`.
- _"`getState()` timing is a sound eligibility probe."_ Wrong — v5
  `isEligible()` returns true regardless; `findEligibleMethods` (v6) is the
  authoritative source. `getState()` is retained only as a liveness check.

### What would unlock it

One of, confirmed with PayPal per merchant account:

1. **Guest checkout / unbranded card** → `guestEnabled: true`, so the existing
   redirect shows a card form instead of a PayPal login. No code change.
2. **Payment Method Tokens (Vault v3)** → unblocks
   `createCardFieldsSavePaymentSession`, which already exists on this v6
   instance: save card → `vault_id` → create the subscription with
   `subscriber.payment_source.token` → genuine `payment_source_type = 'card'`.

PayPal documents direct card subscription creation as limited to eligible
merchants in the US and Australia, non-3DS cards only. The sandbox business
account here is US; the payer address on the live test subscription is India.
**Do not assume the India production merchant is eligible** — verify per account.

### Verified working today

A real settled subscription (`ACTIVE`, $59 charged, Discover x-14 behind a
PayPal wallet) returns **no `payment_source` key at all**. The pipeline records
it correctly: one `payment_methods` row across two subscriptions,
`payment_source_type = 'paypal'`, payer name/country preserved, invoices keyed
on `paypal_txn_id`, switching applied. Nothing is invented.

## When card metadata is (still) absent

`subscriber.payment_source.card` is available when PayPal creates or resolves
the subscription with a card payment source. In our tested wallet /
hosted-checkout flows PayPal does not expose the underlying card — so on this
account, today, it **never** appears. It is absent for wallet-approved and
guest-card redirect subscriptions alike: PayPal does not disclose the card
behind a PayPal balance, a buyer's saved funding source, or a guest card
entered in its own checkout, and no re-read or later webhook will ever produce
one.

The Payment Method Tokens API (vault) is a separate capability and is **not**
enabled here:

```
POST /v3/vault/setup-tokens
403 NOT_AUTHORIZED  "Authorization failed due to insufficient permissions."
```

Nothing in the card flow needs it — the subscription itself is the billing
agreement — but it is why `payment_methods.paypal_payment_token_id` holds an
`I-...` subscription id rather than a vaulted card token.

## What the code does

- Stores what PayPal actually reports and nothing else — no reconstructed cards.
- Records `payment_source_type = 'paypal'` with null card columns for
  wallet-funded subscriptions, and displays the PayPal identity.
- Records `payment_source_type = 'card'` with brand, last four and expiry for
  card-confirmed subscriptions — reachable only once advanced card processing
  is enabled. Until then every stored method is `'paypal'`.
- Never nulls out valid card metadata when a later event for the same agreement
  omits the payment source.
- Sends customers changing the funding instrument behind a _running_ agreement
  to PayPal's Automatic Payments screen. `confirm` only applies to an
  `APPROVAL_PENDING` subscription, so a live agreement cannot be re-pointed at
  a new card from here without replacing it.

The mapping lives in `supabase/functions/_shared/paypal-payment-method.ts`; the
browser side is `src/features/billing/lib/paypal-card-sdk.ts` and
`src/features/billing/components/card-checkout-dialog.tsx`.
