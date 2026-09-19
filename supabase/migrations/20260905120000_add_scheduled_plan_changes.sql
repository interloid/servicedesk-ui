-- Deferred (end-of-period) plan changes.
--
-- A downgrade must not take effect the moment the buyer approves it: the tenant
-- has already paid through current_period_end. So the new, cheaper PayPal
-- subscription is created with start_time = current_period_end and only becomes
-- ACTIVE at that moment. effective_at records it so that:
--   1. the approval callback knows not to apply the switch early, and
--   2. the reconciliation job can find switches that have come due.
--
-- Null effective_at keeps the existing immediate-switch behaviour (upgrades).

alter table public.subscription_switches
    add column if not exists effective_at timestamptz;

comment on column public.subscription_switches.effective_at is
    'When a scheduled switch becomes effective (mirrors the PayPal start_time). Null means apply immediately.';

-- The reconciliation job scans for switches that are due but not yet applied.
create index if not exists idx_subscription_switches_due
    on public.subscription_switches (effective_at)
    where status in ('pending', 'approved');
