-- =====================================================
-- Payment Methods
-- Stores payment method references from PayPal
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

    paypal_payment_token_id text,
    paypal_customer_id text,

    card_brand text,
    card_last4 text,
    card_expiry_month smallint,
    card_expiry_year smallint,
    card_bin text,
    card_issuer text,
    card_country text,

    payment_source_type text
        not null
        default 'card',

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
        default now()
);

-- Index for quick lookup by tenant
create index if not exists idx_payment_methods_tenant_id
    on public.payment_methods(tenant_id);

-- RLS policies
alter table public.payment_methods enable row level security;

create policy "Tenants can view own payment methods"
    on public.payment_methods
    for select
    using (
        tenant_id in (
            select tenant_id from public.memberships
            where user_id = auth.uid()
            and status = 'active'
        )
    );

create policy "Tenants can insert own payment methods"
    on public.payment_methods
    for insert
    with check (
        tenant_id in (
            select tenant_id from public.memberships
            where user_id = auth.uid()
            and status = 'active'
            and role in ('tenant_admin', 'billing_admin')
        )
    );

create policy "Tenants can update own payment methods"
    on public.payment_methods
    for update
    using (
        tenant_id in (
            select tenant_id from public.memberships
            where user_id = auth.uid()
            and status = 'active'
            and role in ('tenant_admin', 'billing_admin')
        )
    );

create policy "Tenants can delete own payment methods"
    on public.payment_methods
    for delete
    using (
        tenant_id in (
            select tenant_id from public.memberships
            where user_id = auth.uid()
            and status = 'active'
            and role in ('tenant_admin', 'billing_admin')
        )
    );

-- Service role can manage all payment methods (for webhooks)
create policy "Service role can manage all payment methods"
    on public.payment_methods
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

-- Update trigger for updated_at
create or replace function public.handle_payment_methods_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger payment_methods_updated_at
    before update on public.payment_methods
    for each row
    execute function public.handle_payment_methods_updated_at();

-- Add payment_method_id to subscriptions for linking
alter table public.subscriptions
    add column if not exists payment_method_id uuid
    references public.payment_methods(id)
    on delete set null;
