-- Who ended the subscription, and what PayPal thinks of the agreement now.
--
-- WHY BOTH COLUMNS
-- ----------------
-- A cancellation started in the app and one started at PayPal used to land in
-- an IDENTICAL row: next_plan_id = Free, cancel_at_period_end = true,
-- next_plan_effective_at = the period end. Nothing recorded the difference,
-- and the difference is the whole point:
--
--   the app cancels by SUSPENDING the agreement, which PayPal can resume, so
--   "Reactivate" works;
--
--   PayPal cancels by CANCELLING it, which can NEVER be revived -- there is
--   nothing to reactivate, and offering the button only produces an error.
--
-- The billing page therefore has to know which of the two it is looking at
-- BEFORE it renders, and asking PayPal on every page load is not an option.
-- cancellation_source records the origin; paypal_status caches the agreement's
-- last known state so the page can tell "suspended, resumable" from "dead".
--
-- Neither column drives a billing decision. The edge functions still read the
-- live status from PayPal before acting -- these are for display and support.

alter table public.subscriptions
    add column if not exists cancellation_source text,
    add column if not exists paypal_status text;

alter table public.subscriptions
    drop constraint if exists chk_subscription_cancellation_source;

alter table public.subscriptions
    add constraint chk_subscription_cancellation_source
    check (
        cancellation_source is null
        or cancellation_source in ('customer', 'paypal', 'system')
    );

alter table public.subscriptions
    drop constraint if exists chk_subscription_paypal_status;

alter table public.subscriptions
    add constraint chk_subscription_paypal_status
    check (
        paypal_status is null
        or paypal_status in (
            'APPROVAL_PENDING',
            'APPROVED',
            'ACTIVE',
            'SUSPENDED',
            'CANCELLED',
            'EXPIRED'
        )
    );

comment on column public.subscriptions.cancellation_source is
    'Who ended it: customer (cancelled in the app), paypal (cancelled or '
    'refused at PayPal), system (a grace period that ran out). Null while the '
    'subscription is live. Cleared when a tenant subscribes again.';

comment on column public.subscriptions.paypal_status is
    'The agreement''s status as PayPal last reported it. A cache for display '
    'only -- SUSPENDED is resumable, CANCELLED and EXPIRED are not. Billing '
    'decisions always re-read the live status from PayPal.';

-- Backfill: existing scheduled cancellations were all started in the app --
-- the webhook path had no way to record itself, and a PayPal-side
-- cancellation of a live agreement would have moved the tenant to Free
-- rather than leaving one scheduled.
update public.subscriptions
   set cancellation_source = 'customer'
 where cancel_at_period_end = true
   and cancellation_source is null;


-- Whether money has actually arrived for the agreement.
--
-- THE BUG THIS FIXES
-- ------------------
-- The plan was applied on the AGREEMENT's status alone. That status says
-- nothing about payment:
--
--   APPROVED  the buyer approved the agreement; PayPal has not charged yet
--   ACTIVE    the agreement is live -- which it also is when the first charge
--             FAILED and an outstanding balance is sitting on it
--
-- So a buyer with no money in their PayPal account approved the subscription,
-- PayPal reported ACTIVE, and the paid plan went live unpaid.
--
-- payment_status records what billing_info actually shows, and the paid plan
-- is only applied once it reads 'paid'.

alter table public.subscriptions
    add column if not exists payment_status text;

alter table public.subscriptions
    drop constraint if exists chk_subscription_payment_status;

alter table public.subscriptions
    add constraint chk_subscription_payment_status
    check (
        payment_status is null
        or payment_status in ('pending', 'paid', 'failed')
    );

comment on column public.subscriptions.payment_status is
    'The agreement''s latest collection: pending (approved, not charged yet), '
    'paid (PayPal reports a completed payment), failed (a charge failed or an '
    'outstanding balance is owed). Null for a tenant with no agreement. A '
    'paid plan is only applied while this reads paid.';

-- The cron looks for agreements that were approved but never paid for.
create index if not exists idx_subscriptions_payment_status_pending
    on public.subscriptions (pending_started_at)
    where payment_status = 'pending';

-- Backfill: a tenant already on a live paid agreement has been billing
-- successfully, so their existing access is not withdrawn by this change.
update public.subscriptions
   set payment_status = 'paid'
 where paypal_subscription_id is not null
   and status = 'active'
   and payment_status is null;
