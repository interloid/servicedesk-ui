-- =====================================================
-- Apply a plan change to subscriptions + tenants atomically
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
