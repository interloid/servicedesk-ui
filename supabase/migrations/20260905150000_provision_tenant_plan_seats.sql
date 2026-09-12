-- Provision new tenants with the trial subscription seat count taken from the
-- plans table instead of a hardcoded value, so seats always match the
-- authoritative plan configuration (Free currently = 2).
-- Keeps the canonical definition at supabase/schemas/functions/provision_tenant.sql in sync.
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
        current_period_end,
        seats
    )
    values (
        v_tenant_id,
        p_plan_id,
        'FREE-' || v_tenant_id,
        'trialing',
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