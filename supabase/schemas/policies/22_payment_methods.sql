-- =====================================================
-- Payment Methods policies
-- =====================================================

alter table public.payment_methods enable row level security;

create policy "Tenants can view own payment methods"
    on public.payment_methods
    for select
    using (
        tenant_id in (
            select tenant_id from public.memberships
            where user_id = auth.uid()
            and status = 'active'
            and role in ('tenant_admin', 'billing_admin')
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

-- Webhooks and the payment-method sync run as the service role.
create policy "Service role can manage all payment methods"
    on public.payment_methods
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
