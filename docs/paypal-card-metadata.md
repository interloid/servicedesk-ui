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

## Merchant eligibility — orders yes, subscriptions no

Advanced card processing **is** enabled on this account, but only for orders.
Card fields for _subscriptions_ are a separately gated capability and are not
available here. Measured directly against this client-id:

| `intent`     | `data-client-token` | `data-sdk-client-token` | `getState()` |
| ------------ | ------------------- | ----------------------- | ------------ |
| capture      | yes                 | –                       | **boots**    |
| capture      | –                   | yes                     | rejects      |
| capture      | yes                 | yes                     | rejects      |
| subscription | yes                 | yes                     | times out    |

Two different tokens are involved and they are not interchangeable:

- `data-client-token` — from `POST /v1/identity/generate-token`, a Braintree
  style token. Card fields initialise with it.
- `data-sdk-client-token` — from `POST /v1/oauth2/token` with
  `response_type=client_token`, a JWT. Required by the SDK for
  `createSubscription` (`SDK Token must be passed in for createSubscription`),
  and its mere presence stops the card fields initialising, at any intent.

That is the deadlock: the token subscriptions require is the token that breaks
the fields. The JWT this account can mint decodes to `scope: []` and
`options: {}` — inert — and minting it with `intent=sdk_init` changes nothing,
so it is an account entitlement rather than a request-shape problem.

`isEligible()` returns `true` throughout and must not be trusted; it reports the
funding-source flag, not this capability. The symptoms when it is wrong are
empty grey fields that cannot be typed into, and a `getState()` that hangs or
rejects with `Cannot read properties of undefined (reading 'getFieldValue')`.
`CardCheckoutDialog` therefore probes `getState()` after render and falls back
to the approval redirect.

PayPal documents direct card subscription creation as limited to eligible
merchants in the US and Australia, non-3DS cards only. The sandbox business
account here is US. **A production merchant in another region should not be
assumed to have it** — that needs confirming with PayPal per account.

To re-check whether subscription card fields have been enabled, run the card
fields with `intent=subscription` and a `data-sdk-client-token` and see whether
`getState()` resolves.

## When card metadata is (still) absent

`subscriber.payment_source.card` is populated only for subscriptions PayPal
itself resolved to a card, which in practice means one confirmed through the
card fields above — so on this account, today, **never**. It is absent for
wallet-approved and guest-card redirect subscriptions alike: PayPal does not
disclose the card behind a PayPal balance, a buyer's saved funding source, or a
guest card entered in its own checkout, and no re-read or later webhook will
ever produce one.

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
