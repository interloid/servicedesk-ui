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

    -- When a scheduled switch becomes effective. Null means apply immediately.
    effective_at timestamptz,

    -- Lease held by the request creating a replacement PayPal subscription for
    -- this switch, so a concurrent duplicate cannot create a second one.
    locked_until timestamptz,

    created_at timestamptz
        default now(),

    updated_at timestamptz
        default now()
);

create index if not exists idx_subscription_switches_tenant
    on public.subscription_switches(tenant_id);

create index if not exists idx_subscription_switches_paypal_id
    on public.subscription_switches(paypal_subscription_id);

create index if not exists idx_subscription_switches_due
    on public.subscription_switches (effective_at)
    where status in ('pending', 'approved');

-- A tenant has at most one open plan change; a racing second insert fails.
create unique index if not exists uq_subscription_switches_one_open_per_tenant
    on public.subscription_switches (tenant_id)
    where status in ('pending', 'approved');