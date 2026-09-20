-- =====================================================
-- One PayPal recurring subscription per tenant
-- =====================================================
--
-- Until now every paid plan change created a SECOND PayPal agreement (an
-- upgrade could even create a "replacement" subscription, a downgrade always
-- created a cheaper agreement with a future start_time) and the pending state
-- lived in public.subscription_switches.
--
-- From here on a tenant has at most ONE recurring agreement for its whole
-- lifetime as a paying customer. A paid -> paid plan change REVISES that
-- agreement; only Free -> Paid creates one. The pending state moves onto
-- public.subscriptions, which becomes the single source of truth:
--
--   plan_id / paypal_subscription_id / status / current_period_*
--       what the tenant has right now
--   next_plan_id / next_plan_effective_at / cancel_at_period_end
--       a committed change that applies at the end of the paid period
--       (downgrade or cancellation); no PayPal object is created for it
--   pending_plan_id / pending_order_id / pending_paypal_subscription_id
--       a checkout the buyer has not completed yet: the one-time ORDER for an
--       upgrade difference, or the new agreement for a Free -> Paid signup
--
-- public.subscription_switches is carried over and DROPPED at the end of this
-- migration. It only ever existed to answer "which tenant owns this PayPal
-- agreement, and what was the plan before it?" -- a question that arose solely
-- because a tenant could briefly own two agreements. With one agreement per
-- tenant the answer is the subscriptions row itself. Nothing references the
-- table: no foreign key points at it, and invoices carry their own
-- plan/period/agreement context.

-- =====================================================
-- 1. Billing state on public.subscriptions
-- =====================================================

alter table public.subscriptions
    add column if not exists current_period_start timestamptz,
    add column if not exists next_plan_id uuid references public.plans(id),
    add column if not exists next_plan_effective_at timestamptz,
    add column if not exists cancel_at_period_end boolean not null default false,
    add column if not exists pending_plan_id uuid references public.plans(id),
    add column if not exists pending_order_id text,
    add column if not exists pending_paypal_subscription_id text,
    add column if not exists pending_started_at timestamptz;

comment on column public.subscriptions.current_period_start is
    'Start of the period the tenant has paid for. Set from the PayPal agreement when a cycle starts.';

comment on column public.subscriptions.next_plan_id is
    'Committed future plan (paid downgrade, or the Free plan for a scheduled cancellation). Applied by reconcile-subscriptions at next_plan_effective_at.';

comment on column public.subscriptions.next_plan_effective_at is
    'When next_plan_id takes effect; normally current_period_end.';

comment on column public.subscriptions.cancel_at_period_end is
    'True when the tenant cancelled and keeps access until current_period_end. The PayPal agreement is suspended meanwhile so it never bills another cycle, and is cancelled for good at the period end.';

comment on column public.subscriptions.pending_plan_id is
    'Target plan of a checkout the buyer has not completed yet (pending_order_id or pending_paypal_subscription_id).';

comment on column public.subscriptions.pending_order_id is
    'PayPal one-time ORDER id for an immediate upgrade difference, awaiting capture. Never a recurring agreement.';

comment on column public.subscriptions.pending_paypal_subscription_id is
    'PayPal agreement id awaiting buyer approval. Only ever set for Free -> Paid, where the tenant has no agreement yet.';

comment on column public.subscriptions.pending_started_at is
    'When the pending checkout was created, so an abandoned one can be expired.';

-- reconcile-subscriptions scans for changes that have come due.
create index if not exists idx_subscriptions_due_plan_change
    on public.subscriptions (next_plan_effective_at)
    where next_plan_id is not null;

-- ...and for abandoned checkouts to expire.
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

-- =====================================================
-- 2. Retire the synthetic FREE-<tenant> agreement ids
-- =====================================================
--
-- These were never PayPal agreements. They exist only because the column was
-- NOT NULL when the table was created (that constraint was dropped in
-- 20260827160041). Every call site now treats NULL as "no PayPal agreement",
-- so the placeholders can never be sent to a PayPal endpoint again.

update public.subscriptions
set paypal_subscription_id = null,
    updated_at = now()
where paypal_subscription_id like 'FREE-%';

-- =====================================================
-- 3. Carry open switches over, then drop the table
-- =====================================================
--
-- Existing customers must not notice the change: a scheduled downgrade stays
-- scheduled, a cancellation stays scheduled, and an upgrade whose order is
-- still unpaid stays payable.

-- 3a. Scheduled changes (downgrade / cancellation) -> next_plan_*.
--     The Free plan as a target means the tenant cancelled.
update public.subscriptions s
set next_plan_id = sw.plan_id,
    next_plan_effective_at = sw.effective_at,
    cancel_at_period_end = (p.price_month = 0),
    updated_at = now()
from public.subscription_switches sw
    join public.plans p on p.id = sw.plan_id
where sw.tenant_id = s.tenant_id
  and sw.status in ('pending', 'approved')
  and sw.effective_at is not null
  and s.next_plan_id is null;

-- 3b. An upgrade whose one-time order was created but never captured.
--     Under the old architecture the switch held the ORDER id in
--     paypal_subscription_id and the real agreement in the old_ column.
update public.subscriptions s
set pending_plan_id = sw.plan_id,
    pending_order_id = sw.paypal_subscription_id,
    pending_started_at = coalesce(sw.updated_at, sw.created_at, now()),
    updated_at = now()
from public.subscription_switches sw
where sw.tenant_id = s.tenant_id
  and sw.status in ('pending', 'approved')
  and sw.effective_at is null
  and sw.paypal_subscription_id not like 'I-%'
  and sw.paypal_subscription_id not like 'FREE-%'
  and s.pending_plan_id is null;

-- 3c. A signup (or legacy replacement) agreement still awaiting approval.
update public.subscriptions s
set pending_plan_id = sw.plan_id,
    pending_paypal_subscription_id = sw.paypal_subscription_id,
    pending_started_at = coalesce(sw.updated_at, sw.created_at, now()),
    updated_at = now()
from public.subscription_switches sw
where sw.tenant_id = s.tenant_id
  and sw.status in ('pending', 'approved')
  and sw.effective_at is null
  and sw.paypal_subscription_id like 'I-%'
  and sw.paypal_subscription_id is distinct from s.paypal_subscription_id
  and s.pending_plan_id is null;

-- Every open switch now lives on the subscriptions row, so the table holds
-- nothing but history of a mechanism that no longer exists. Dropping it takes
-- its RLS policy and indexes with it.
--
-- NOTE: this deletes the record of plan changes made under the old
-- architecture. Invoices and billing history are untouched -- this is only the
-- internal "which agreement superseded which" trail. To keep a copy, snapshot
-- it BEFORE applying this migration:
--
--   create table public.subscription_switches_archive as
--       select * from public.subscription_switches;

drop table if exists public.subscription_switches;

-- =====================================================
-- 4. Apply a plan change to subscriptions + tenants atomically
-- =====================================================
--
-- The two rows must never disagree ("tenant = Business, subscription = Pro").
-- Supabase cannot wrap a PayPal call in a transaction, so the PayPal side is
-- done first and this function commits the whole local side at once.
--
-- p_expected_next_plan_id makes the call a claim: reconcile-subscriptions
-- passes the change it read, and a second concurrent run applies nothing
-- because next_plan_id no longer matches. That is what keeps the cron
-- idempotent.
--
-- NULL means "leave as is" for every optional argument; the explicit
-- p_clear_* flags are how a value is actively cleared.

create or replace function public.apply_subscription_plan(
    p_tenant_id uuid,
    p_plan_id uuid,
    p_status text default null,
    p_seats integer default null,
    p_current_period_start timestamptz default null,
    p_current_period_end timestamptz default null,
    p_clear_period_end boolean default false,
    p_paypal_subscription_id text default null,
    p_clear_paypal_subscription_id boolean default false,
    p_clear_pending boolean default true,
    p_clear_next boolean default true,
    p_expected_next_plan_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_updated uuid;
begin
    update public.subscriptions s
    set plan_id = coalesce(p_plan_id, s.plan_id),

        status = coalesce(p_status::public.subscription_status, s.status),

        seats = coalesce(p_seats, s.seats),

        current_period_start = coalesce(
            p_current_period_start, s.current_period_start
        ),

        current_period_end = case
            when p_clear_period_end then null
            else coalesce(p_current_period_end, s.current_period_end)
        end,

        paypal_subscription_id = case
            when p_clear_paypal_subscription_id then null
            else coalesce(p_paypal_subscription_id, s.paypal_subscription_id)
        end,

        pending_plan_id = case when p_clear_pending then null
                               else s.pending_plan_id end,
        pending_order_id = case when p_clear_pending then null
                                else s.pending_order_id end,
        pending_paypal_subscription_id = case
            when p_clear_pending then null else s.pending_paypal_subscription_id
        end,
        pending_started_at = case when p_clear_pending then null
                                  else s.pending_started_at end,

        next_plan_id = case when p_clear_next then null
                            else s.next_plan_id end,
        next_plan_effective_at = case when p_clear_next then null
                                      else s.next_plan_effective_at end,
        cancel_at_period_end = case when p_clear_next then false
                                    else s.cancel_at_period_end end,

        updated_at = now()
    where s.tenant_id = p_tenant_id
      and (
          p_expected_next_plan_id is null
          or s.next_plan_id = p_expected_next_plan_id
      )
    returning s.tenant_id into v_updated;

    if v_updated is null then
        return false;
    end if;

    if p_plan_id is not null then
        update public.tenants
        set plan_id = p_plan_id,
            updated_at = now()
        where id = p_tenant_id;
    end if;

    return true;
end;
$$;

comment on function public.apply_subscription_plan is
    'Applies a plan change to subscriptions and tenants in one transaction. Returns false when p_expected_next_plan_id no longer matches (another run already applied it).';

revoke all on function public.apply_subscription_plan(
    uuid, uuid, text, integer, timestamptz, timestamptz, boolean, text,
    boolean, boolean, boolean, uuid
) from public, anon, authenticated;

grant execute on function public.apply_subscription_plan(
    uuid, uuid, text, integer, timestamptz, timestamptz, boolean, text,
    boolean, boolean, boolean, uuid
) to service_role;

-- =====================================================
-- 5. New tenants start with no PayPal agreement
-- =====================================================
--
-- Identical to 20260905150000_provision_tenant_plan_seats.sql except that the
-- trial subscription is created with paypal_subscription_id NULL instead of
-- the synthetic 'FREE-<tenant>' placeholder, and records the period start.
-- Keeps the canonical definition at
-- supabase/schemas/functions/provision_tenant.sql in sync.

create or replace function public.provision_tenant(
    p_user_id uuid,
    p_email text,
    p_full_name text,
    p_organization_name text,
    p_portal_slug text,
    p_plan_id uuid,
    p_timezone_id uuid,
    p_working_days jsonb,
    p_day_start time,
    p_day_end time,
    p_sla jsonb
)
returns table (
    tenant_id uuid,
    tenant_name text,
    tenant_slug text,
    business_hours_id uuid,
    plan_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant_id uuid;
    v_business_hours_id uuid;
    v_sla_policy_id uuid;
begin

    if exists (
        select 1
        from public.tenants
        where slug = p_portal_slug
    ) then
        raise exception 'Portal address is already taken.';
    end if;

    if exists (
        select 1
        from public.users
        where email = p_email
    ) then
        raise exception 'Email address is already registered.';
    end if;

    if not exists (
        select 1
        from public.timezones
        where id = p_timezone_id
    ) then
        raise exception 'Invalid timezone selected.';
    end if;

    if not exists (
        select 1
        from public.plans
        where id = p_plan_id
    ) then
        raise exception 'Invalid subscription plan.';
    end if;

    insert into public.tenants (
        name,
        slug,
        status,
        plan_id
    )
    values (
        p_organization_name,
        p_portal_slug,
        'active',
        p_plan_id
    )
    returning id
    into v_tenant_id;

    insert into public.subscriptions (
        tenant_id,
        plan_id,
        paypal_subscription_id,
        status,
        current_period_start,
        current_period_end,
        seats
    )
    values (
        v_tenant_id,
        p_plan_id,
        null,
        'trialing',
        now(),
        now() + interval '15 days',
        (select seat_limit from public.plans where id = p_plan_id)
    );

    insert into public.users (
        id,
        email,
        full_name,
        avatar_url
    )
    values (
        p_user_id,
        p_email,
        p_full_name,
        null
    );

    insert into public.memberships (
        tenant_id,
        user_id,
        role,
        status
    )
    values (
        v_tenant_id,
        p_user_id,
        'tenant_admin',
        'active'
    );

    insert into public.business_hours (
        tenant_id,
        name,
        timezone_id,
        schedule_json
    )
    values (
        v_tenant_id,
        'Default Business Hours',
        p_timezone_id,
        jsonb_build_object(
            'working_days', p_working_days,
            'day_start', p_day_start,
            'day_end', p_day_end
        )
    )
    returning id
    into v_business_hours_id;

    insert into public.sla_policies (
        tenant_id,
        business_hours_id,
        name,
        is_default,
        status,
        applies_to,
        notify_before_breach,
        escalate_on_breach
    )
    values (
        v_tenant_id,
        v_business_hours_id,
        'Default SLA',
        true,
        'active',
        'All customers',
        true,
        false
    )
    returning id
    into v_sla_policy_id;

    insert into public.sla_policy_targets (
        tenant_id,
        policy_id,
        priority_scope,
        first_response_mins,
        resolution_mins,
        first_response_business,
        resolution_business
    )
    select
        v_tenant_id,
        v_sla_policy_id,
        lower(rule->>'priority')::public.ticket_priority,
        (rule->>'first_response_mins')::integer,
        (rule->>'resolution_mins')::integer,
        false,
        false
    from jsonb_array_elements(p_sla) as rule;

    return query
    select
        v_tenant_id,
        p_organization_name,
        p_portal_slug,
        v_business_hours_id,
        p_plan_id;

end;
$$;