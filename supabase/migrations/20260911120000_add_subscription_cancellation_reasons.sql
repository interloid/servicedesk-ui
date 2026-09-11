-- Cancellation feedback collected on the cancel-subscription page.
--
-- The `subscription` edge function has always written here (action "cancel"),
-- but the table was never created, so every insert failed silently: the write
-- is fire-and-forget so a missing table never surfaced as an error. The UI
-- also dropped the reason before sending it, so nothing was lost — but nothing
-- was ever recorded either.

create table if not exists public.subscription_cancellation_reasons (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants (id) on delete cascade,
    subscription_id uuid references public.subscriptions (id) on delete set null,
    reason text not null,
    created_at timestamptz not null default now()
);

create index if not exists subscription_cancellation_reasons_tenant_id_idx
    on public.subscription_cancellation_reasons (tenant_id, created_at desc);

alter table public.subscription_cancellation_reasons
    enable row level security;

-- The edge function writes with the service role. Tenant admins and billing
-- admins may read back their own workspace's feedback; nobody else sees it,
-- and no client may write it.
create policy "subscription_cancellation_reasons_select"
    on public.subscription_cancellation_reasons
    for select
    to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.is_active_membership()
        and public.current_tenant_role() in ('tenant_admin', 'billing_admin')
    );

create policy "subscription_cancellation_reasons_service_role"
    on public.subscription_cancellation_reasons
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
