-- =====================================================
-- Subscription Switches
-- Pending plan changes awaiting PayPal activation.
-- Holds a snapshot of the previous subscription so an
-- abandoned checkout can be rolled back safely.
-- =====================================================

create table if not exists public.subscription_switches
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    -- Target (new) plan the switch is moving the tenant to.
    plan_id uuid
        not null
        references public.plans(id),

    -- New PayPal subscription id, created first and not active until approved.
    paypal_subscription_id text
        not null
        unique,

    -- Snapshot of the current subscription so an aborted switch can restore it.
    old_paypal_subscription_id text,
    old_plan_id uuid
        references public.plans(id),
    old_status text,
    old_seats integer,
    old_current_period_end timestamptz,

    status text
        not null
        default 'pending'
        check (status in ('pending', 'approved', 'applied', 'cancelled')),

    created_at timestamptz
        default now(),

    updated_at timestamptz
        default now()
);

create index if not exists idx_subscription_switches_tenant
    on public.subscription_switches(tenant_id);

create index if not exists idx_subscription_switches_paypal_id
    on public.subscription_switches(paypal_subscription_id);