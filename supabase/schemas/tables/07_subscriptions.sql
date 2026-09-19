-- =====================================================
-- Subscriptions
-- =====================================================

create table if not exists public.subscriptions
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        unique
        references public.tenants(id)
        on delete cascade,

    paypal_subscription_id text
        unique,

    plan_id uuid
        not null
        references public.plans(id),

    status subscription_status
        not null,

    current_period_end timestamptz,

    cancelled_at timestamptz,

    seats integer
        not null
        default 1,

    created_at timestamptz
        default now(),

    updated_at timestamptz
        default now(),

    constraint chk_subscription_seats
        check(seats>=1)
);

