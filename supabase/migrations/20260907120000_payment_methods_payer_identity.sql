-- =====================================================
-- Payment methods: keep the payer identity PayPal does report
--
-- For a wallet or guest-card checkout PayPal never discloses the funding
-- instrument -- `subscriber.payment_source` comes back null and no later event
-- or re-read produces one. What it does populate once the buyer approves is
-- who they are: payer_id, given/surname, and the address on the account.
--
-- Until approval `subscriber` holds only the email we supplied at creation, so
-- these columns stay null through APPROVAL_PENDING and fill in from the
-- BILLING.SUBSCRIPTION.ACTIVATED webhook. That makes a wallet-funded tenant
-- show a real person instead of a bare "PayPal", which is the closest this
-- integration can get to "card details on file".
-- =====================================================

alter table public.payment_methods
    add column if not exists paypal_payer_name text;

alter table public.payment_methods
    add column if not exists paypal_payer_country text;

comment on column public.payment_methods.paypal_payer_name is
    'Display name from subscriber.name (given_name + surname). Populated only '
    'after the buyer approves; null for APPROVAL_PENDING subscriptions.';

comment on column public.payment_methods.paypal_payer_country is
    'Two-letter country from subscriber.shipping_address, when PayPal reports '
    'one. Not the card country -- that is card_country and requires advanced '
    'card processing.';
