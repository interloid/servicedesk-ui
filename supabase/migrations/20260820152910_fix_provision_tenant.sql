CREATE OR REPLACE FUNCTION public.provision_tenant(
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
RETURNS TABLE (
    tenant_id uuid,
    tenant_name text,
    tenant_slug text,
    business_hours_id uuid,
    plan_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id uuid;
    v_business_hours_id uuid;
    v_sla_policy_id uuid;
BEGIN

    IF EXISTS (
        SELECT 1
        FROM public.tenants
        WHERE slug = p_portal_slug
    ) THEN
        RAISE EXCEPTION 'Portal address is already taken.';
    END IF;


    IF EXISTS (
        SELECT 1
        FROM public.users
        WHERE email = p_email
    ) THEN
        RAISE EXCEPTION 'Email address is already registered.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.timezones
        WHERE id = p_timezone_id
    ) THEN
        RAISE EXCEPTION 'Invalid timezone selected.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.plans
        WHERE id = p_plan_id
    ) THEN
        RAISE EXCEPTION 'Invalid subscription plan.';
    END IF;

    INSERT INTO public.tenants (
        name,
        slug,
        status,
        plan_id
    )
    VALUES (
        p_organization_name,
        p_portal_slug,
        'active',
        p_plan_id
    )
    RETURNING id
    INTO v_tenant_id;



    INSERT INTO public.subscriptions (
        tenant_id,
        plan_id,
        paypal_subscription_id,
        status,
        current_period_end,
        seats
    )
    VALUES (
        v_tenant_id,
        p_plan_id,
        'FREE-' || v_tenant_id,
        'trialing',
        now() + interval '15 days',
        2
    );


    INSERT INTO public.users (
        id,
        email,
        full_name,
        avatar_url
    )
    VALUES (
        p_user_id,
        p_email,
        p_full_name,
        NULL
    );


    INSERT INTO public.memberships (
        tenant_id,
        user_id,
        role,
        status
    )
    VALUES (
        v_tenant_id,
        p_user_id,
        'tenant_admin',
        'active'
    );


    INSERT INTO public.business_hours (
        tenant_id,
        name,
        timezone_id,
        schedule_json
    )
    VALUES (
        v_tenant_id,
        'Default Business Hours',
        p_timezone_id,
        jsonb_build_object(
            'working_days', p_working_days,
            'day_start', p_day_start,
            'day_end', p_day_end
        )
    )
    RETURNING id
    INTO v_business_hours_id;



    INSERT INTO public.sla_policies (
        tenant_id,
        business_hours_id,
        name,
        is_default,
        status,
        applies_to,
        notify_before_breach,
        escalate_on_breach
    )
    VALUES (
        v_tenant_id,
        v_business_hours_id,
        'Default SLA',
        true,
        'active',
        'All customers',
        true,
        false
    )
    RETURNING id
    INTO v_sla_policy_id;


    INSERT INTO public.sla_policy_targets (
        tenant_id,
        policy_id,
        priority_scope,
        first_response_mins,
        resolution_mins,
        first_response_business,
        resolution_business
    )
    SELECT
        v_tenant_id,
        v_sla_policy_id,
        lower(rule->>'priority')::public.ticket_priority,
        (rule->>'first_response_mins')::integer,
        (rule->>'resolution_mins')::integer,
        false,
        false
    FROM jsonb_array_elements(p_sla) AS rule;


    RETURN QUERY
    SELECT
        v_tenant_id,
        p_organization_name,
        p_portal_slug,
        v_business_hours_id,
        p_plan_id;

END;
$$;