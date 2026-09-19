-- Billing hardening from the backend code review
-- (docs/reviews/code-review-2026-09-11-backend.md). Schema and policy changes
-- only; no billing flow changes behaviour for a correctly-behaving caller.

-- =====================================================
-- RISK-027: subscription_switches never had RLS enabled
-- =====================================================
-- Every other tenant table enables RLS. This one did not, so with Supabase's
-- default grants any authenticated user could read and write every tenant's
-- plan-switch rows through PostgREST.
--
-- Billing admins may read their own tenant's switches (the billing dashboard
-- does, with the user's session). No client may write them: the only writers
-- are the edge functions, which use the service role and bypass RLS. An UPDATE
-- policy is deliberately NOT granted -- it would let a billing admin retarget
-- their own pending upgrade (plan_id) to a pricier plan before capture-order
-- reads it.

alter table public.subscription_switches
    enable row level security;

drop policy if exists "subscription_switches_select"
    on public.subscription_switches;

create policy "subscription_switches_select"
    on public.subscription_switches
    for select
    to authenticated
    using (
        tenant_id = public.current_tenant_id()
        and public.is_active_membership()
        and public.current_tenant_role() in ('tenant_admin', 'billing_admin')
    );

-- =====================================================
-- RISK-036: payment_methods SELECT had no role check
-- =====================================================
-- Insert/update/delete were already limited to tenant and billing admins; read
-- was open to any active member (agents included), exposing card brand, last
-- four, expiry and payer identity. The billing dashboard, the only reader, is
-- already limited to billing admins.

drop policy if exists "Tenants can view own payment methods"
    on public.payment_methods;

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

-- =====================================================
-- RISK-033: at most one open plan switch per tenant
-- =====================================================
-- The subscription function cancels a tenant's open switches and then inserts
-- a new one, as two separate statements. Two rapid requests could both pass
-- the cancel and both insert, leaving two open switches (and two PayPal
-- agreements the buyer could approve). This index makes the second insert fail
-- instead; the function reports it as "another plan change is in progress".
--
-- Any pre-existing duplicates can only have come from that race. They are
-- resolved exactly the way the next request would resolve them: the newest
-- switch stays open, older ones are cancelled.

with ranked as (
    select id,
           row_number() over (
               partition by tenant_id
               order by created_at desc nulls last, id desc
           ) as position
    from public.subscription_switches
    where status in ('pending', 'approved')
)
update public.subscription_switches s
set status = 'cancelled',
    updated_at = now()
from ranked r
where s.id = r.id
  and r.position > 1;

create unique index if not exists uq_subscription_switches_one_open_per_tenant
    on public.subscription_switches (tenant_id)
    where status in ('pending', 'approved');

-- =====================================================
-- RISK-032: short lease for capture-order's replacement subscription
-- =====================================================
-- When an upgrade's existing PayPal agreement cannot be revised, capture-order
-- creates a replacement agreement, which is not idempotent. The request that
-- sets this lease is the only one allowed to create it; a concurrent duplicate
-- (double submit, refresh) is turned away instead of creating a second one.
-- The lease expires on its own, so a crashed request cannot block retries.

alter table public.subscription_switches
    add column if not exists locked_until timestamptz;

comment on column public.subscription_switches.locked_until is
    'Lease held by the request creating a replacement PayPal subscription for this switch. Null or in the past means unlocked.';

-- =====================================================
-- RISK-025 / RISK-035: invoice email delivery tracked on its own
-- =====================================================
-- storage_path used to double as the "already emailed" marker. It is written
-- before the email is sent, so a failed send was never retried, and two
-- concurrent deliveries could both send. email_sent_at is claimed atomically
-- right before sending and released again if the send fails.
--
-- Invoices that already have a PDF went through the old path, which sent the
-- email right after storing it; they are marked as sent so a redelivered event
-- does not email them a second time.

alter table public.invoices
    add column if not exists email_sent_at timestamptz;

comment on column public.invoices.email_sent_at is
    'When the invoice email was sent. Claimed atomically before sending so each invoice is emailed once; reset to null if sending fails.';

update public.invoices
set email_sent_at = coalesce(updated_at, created_at, now())
where storage_path is not null
  and email_sent_at is null;
