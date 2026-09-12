-- =====================================================
-- Payment methods: idempotency + honest defaults
--
-- Webhooks are delivered more than once and the previous upsert path
-- ("select the default row, else insert") could insert a duplicate whenever
-- the select failed or two deliveries raced. A partial unique index makes the
-- one-default-row-per-tenant rule an invariant the database enforces, so a
-- replayed event can only ever update the existing row.
-- =====================================================

-- Collapse any duplicate defaults left behind by the previous code, keeping the
-- most recently updated row (and preferring one that actually holds card data).
with ranked as (
    select
        id,
        row_number() over (
            partition by tenant_id
            order by
                (card_last4 is not null) desc,
                updated_at desc nulls last,
                created_at desc nulls last
        ) as rn
    from public.payment_methods
    where is_default
)
update public.payment_methods pm
set is_default = false
from ranked
where pm.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists payment_methods_one_default_per_tenant
    on public.payment_methods (tenant_id)
    where is_default;

-- Webhook and payment-method sync both look rows up by the PayPal agreement id.
create index if not exists idx_payment_methods_paypal_token
    on public.payment_methods (paypal_payment_token_id);

-- The overwhelmingly common case is a PayPal-wallet funded subscription, where
-- PayPal never discloses a card. Defaulting to 'card' made a row that had not
-- been classified yet look card-funded.
alter table public.payment_methods
    alter column payment_source_type set default 'paypal';

update public.payment_methods
set payment_source_type = 'paypal'
where payment_source_type is distinct from 'card'
   or (payment_source_type = 'card' and card_last4 is null);

alter table public.payment_methods
    drop constraint if exists chk_payment_source_type;

alter table public.payment_methods
    add constraint chk_payment_source_type
        check (payment_source_type in ('card', 'paypal'));

-- A row typed 'card' must actually carry the metadata that makes it a card,
-- so no code path can leave a half-populated card on display.
alter table public.payment_methods
    drop constraint if exists chk_card_metadata_present;

alter table public.payment_methods
    add constraint chk_card_metadata_present
        check (payment_source_type <> 'card' or card_last4 is not null);

comment on column public.payment_methods.paypal_payment_token_id is
    'PayPal billing agreement / subscription id (I-...) this payment method bills through. Not a vaulted card token: the Payment Method Tokens API is not enabled for this merchant.';

comment on column public.payment_methods.payment_source_type is
    'How PayPal funds this subscription: ''card'' only when PayPal itself reported subscriber.payment_source.card, otherwise ''paypal'' (wallet). Never inferred.';
