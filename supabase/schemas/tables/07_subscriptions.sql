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

    -- Who ended it, and what PayPal last said about the agreement.
    --
    -- The app cancels by SUSPENDING the agreement, which PayPal can resume, so
    -- "Reactivate" works. PayPal cancels by CANCELLING it, which it never
    -- revives. Both used to leave an identical row, so the billing page could
    -- not tell them apart and offered a button that could only fail.
    --
    -- paypal_status is written from the OUTCOME, not the intent: a suspend
    -- that falls back to a cancel is a customer cancellation that still cannot
    -- be reactivated. Neither column drives a billing decision -- the edge
    -- functions always re-read the live status from PayPal before acting.
    cancellation_source text,

    paypal_status text,

    -- Whether PayPal has actually COLLECTED. The agreement's status cannot
    -- answer this: APPROVED means the buyer approved and nothing was charged,
    -- and ACTIVE is also what a subscription reads while a failed first charge
    -- sits on it as an outstanding balance. Applying the plan on status alone
    -- is how an unfunded buyer got a paid plan for free.
    payment_status text,

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

    -- Dunning. PayPal retries a failed recurring charge on its own schedule
    -- before giving up, and a customer with an expiring card is still a paying
    -- customer meanwhile: the plan stays ACTIVE and only the count moves.
    --
    -- grace_period_ends_at is set when PayPal SUSPENDS the agreement -- the
    -- point at which no money is coming. The tenant keeps their plan until it
    -- passes; reconcile-subscriptions moves them to Free afterwards, and only
    -- while PayPal still refuses to bill. All three clear on any successful
    -- payment.
    payment_failure_count integer
        not null
        default 0,

    last_payment_failure_at timestamptz,

    grace_period_ends_at timestamptz,

    created_at timestamptz
        default now(),

    updated_at timestamptz
        default now(),

    constraint chk_subscription_seats
        check(seats>=1),

    constraint chk_subscription_payment_failure_count
        check(payment_failure_count>=0),

    constraint chk_subscription_cancellation_source
        check(
            cancellation_source is null
            or cancellation_source in ('customer', 'paypal', 'system')
        ),

    constraint chk_subscription_payment_status
        check(
            payment_status is null
            or payment_status in ('pending', 'paid', 'failed')
        ),

    constraint chk_subscription_paypal_status
        check(
            paypal_status is null
            or paypal_status in (
                'APPROVAL_PENDING',
                'APPROVED',
                'ACTIVE',
                'SUSPENDED',
                'CANCELLED',
                'EXPIRED'
            )
        )
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

-- The cron scans for grace windows that have closed, and only ever for rows
-- that have one.
create index if not exists idx_subscriptions_grace_period_ends_at
    on public.subscriptions (grace_period_ends_at)
    where grace_period_ends_at is not null;

comment on column public.subscriptions.payment_failure_count is
    'Consecutive failed recurring charges. Reset to 0 by any successful '
    'payment or reactivation, NOT by a plan change.';

comment on column public.subscriptions.last_payment_failure_at is
    'When the most recent recurring charge failed. Null once a payment '
    'succeeds.';

comment on column public.subscriptions.grace_period_ends_at is
    'Set when PayPal SUSPENDS the agreement for non-payment. The tenant keeps '
    'their plan until this passes; reconcile-subscriptions moves them to Free '
    'after it, and only while PayPal still refuses to bill. Null whenever the '
    'subscription is healthy.';

-- The cron looks for agreements that were approved but never paid for.
create index if not exists idx_subscriptions_payment_status_pending
    on public.subscriptions (pending_started_at)
    where payment_status = 'pending';

comment on column public.subscriptions.payment_status is
    'The agreement''s latest collection: pending (approved, not charged yet), '
    'paid (PayPal reports a completed payment), failed (a charge failed or an '
    'outstanding balance is owed). Null for a tenant with no agreement. A '
    'paid plan is only applied while this reads paid.';

comment on column public.subscriptions.cancellation_source is
    'Who ended it: customer (cancelled in the app), paypal (cancelled or '
    'refused at PayPal), system (a grace period that ran out). Null while the '
    'subscription is live. Cleared when a tenant subscribes again.';

comment on column public.subscriptions.paypal_status is
    'The agreement''s status as PayPal last reported it. A cache for display '
    'only -- SUSPENDED is resumable, CANCELLED and EXPIRED are not. Billing '
    'decisions always re-read the live status from PayPal.';
