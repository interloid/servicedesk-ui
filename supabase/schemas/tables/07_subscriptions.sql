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

    current_period_start timestamptz,

    current_period_end timestamptz,

    cancelled_at timestamptz,

    -- A committed future change: a paid downgrade, or the Free plan when the
    -- tenant cancelled. No PayPal object is created for it -- the ONE existing
    -- agreement is revised (or cancelled) by reconcile-subscriptions when
    -- next_plan_effective_at arrives.
    next_plan_id uuid
        references public.plans(id),

    next_plan_effective_at timestamptz,

    cancel_at_period_end boolean
        not null
        default false,

    -- A checkout the buyer has not completed yet: the one-time ORDER for an
    -- upgrade difference, or (Free -> Paid only) the new agreement awaiting
    -- approval. Cleared the moment it is captured/approved or expires.
    pending_plan_id uuid
        references public.plans(id),

    pending_order_id text,

    pending_paypal_subscription_id text,

    pending_started_at timestamptz,

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

-- reconcile-subscriptions scans for plan changes that have come due, and for
-- abandoned checkouts to expire.
create index if not exists idx_subscriptions_due_plan_change
    on public.subscriptions (next_plan_effective_at)
    where next_plan_id is not null;

create index if not exists idx_subscriptions_pending_started
    on public.subscriptions (pending_started_at)
    where pending_plan_id is not null;

-- A PayPal order / agreement belongs to exactly one tenant.
create unique index if not exists uq_subscriptions_pending_order
    on public.subscriptions (pending_order_id)
    where pending_order_id is not null;

create unique index if not exists uq_subscriptions_pending_paypal_subscription
    on public.subscriptions (pending_paypal_subscription_id)
    where pending_paypal_subscription_id is not null;
