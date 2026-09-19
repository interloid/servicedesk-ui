-- =====================================================
-- Payment Methods
-- How a tenant's PayPal subscription is funded.
--
-- Only non-sensitive metadata that PayPal itself reports is stored here: the
-- card PAN and security code never reach this system. Card columns are
-- populated only for subscriptions PayPal reports as card-funded; a wallet
-- approved subscription carries the payer identity instead.
-- =====================================================

create table if not exists public.payment_methods
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    subscription_id uuid
        references public.subscriptions(id)
        on delete set null,

    -- PayPal billing agreement / subscription id (I-...) this method bills
    -- through. Not a vaulted card token: the Payment Method Tokens API is not
    -- enabled for this merchant account.
    paypal_payment_token_id text,
    paypal_customer_id text,
    paypal_email text,

    -- Who PayPal says approved the agreement. Populated from the ACTIVATED
    -- webhook: before approval `subscriber` carries only the email we sent.
    -- This is the only identity a wallet-funded subscription ever discloses.
    paypal_payer_name text,
    paypal_payer_country text,

    card_brand text,
    card_last4 text,
    card_expiry_month smallint,
    card_expiry_year smallint,
    card_bin text,
    card_issuer text,
    card_country text,

    -- 'card' only when PayPal reported subscriber.payment_source.card,
    -- otherwise 'paypal' (wallet). Never inferred from anything else.
    payment_source_type text
        not null
        default 'paypal'
        check (payment_source_type in ('card', 'paypal')),

    is_default boolean
        not null
        default true,

    status text
        not null
        default 'active'
        check (status in ('active', 'expired', 'revoked')),

    created_at timestamptz
        default now(),

    updated_at timestamptz
        default now(),

    -- A row typed 'card' must carry the metadata that makes it a card, so no
    -- code path can leave a half-populated card on display.
    constraint chk_card_metadata_present
        check (payment_source_type <> 'card' or card_last4 is not null)
);

create index if not exists idx_payment_methods_tenant_id
    on public.payment_methods(tenant_id);

create index if not exists idx_payment_methods_paypal_token
    on public.payment_methods(paypal_payment_token_id);

-- Makes replayed PayPal webhooks idempotent: a tenant can only ever have one
-- default payment method, so a repeated event updates it instead of inserting.
create unique index if not exists payment_methods_one_default_per_tenant
    on public.payment_methods(tenant_id)
    where is_default;

create or replace function public.handle_payment_methods_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists payment_methods_updated_at on public.payment_methods;

create trigger payment_methods_updated_at
    before update on public.payment_methods
    for each row
    execute function public.handle_payment_methods_updated_at();

-- Added here rather than in 07_subscriptions.sql because the reference is
-- circular: payment_methods points at subscriptions and back again, so this
-- side has to wait until both tables exist.
alter table public.subscriptions
    add column if not exists payment_method_id uuid
    references public.payment_methods(id)
    on delete set null;
