-- Dunning state for a failing recurring charge.
--
-- PayPal retries a failed subscription payment on its own schedule before it
-- gives up and SUSPENDS the agreement. Until that happens the customer is
-- still a paying customer having a card problem, so the plan stays ACTIVE and
-- the account is not restricted -- the failures are only counted and shown.
--
-- Restriction begins when PayPal itself suspends the agreement: that is the
-- point at which no money is coming, and it opens a grace window instead of
-- an immediate downgrade. Only once the window closes with the agreement
-- still unpaid does the tenant fall back to Free.

alter table public.subscriptions
    add column if not exists payment_failure_count integer not null default 0,
    add column if not exists last_payment_failure_at timestamp with time zone,
    add column if not exists grace_period_ends_at timestamp with time zone;

alter table public.subscriptions
    drop constraint if exists chk_subscription_payment_failure_count;

alter table public.subscriptions
    add constraint chk_subscription_payment_failure_count
    check (payment_failure_count >= 0);

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

-- The cron scans for grace windows that have closed, and only ever for rows
-- that have one.
create index if not exists idx_subscriptions_grace_period_ends_at
    on public.subscriptions (grace_period_ends_at)
    where grace_period_ends_at is not null;
