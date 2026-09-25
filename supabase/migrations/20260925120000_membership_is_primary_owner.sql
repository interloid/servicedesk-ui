-- ==========================================================
-- File: 20260925120000_membership_is_primary_owner.sql
-- Description: Record the workspace owner explicitly and let them hand the
--              workspace over.
--
-- Until now "owner" was inferred: the tenant_admin membership nobody invited
-- (invited_by IS NULL). That can't move to another person, so ownership
-- becomes a flag -- memberships.is_primary -- set by provision_tenant at
-- signup and moved only by transfer_tenant_ownership().
--
-- Canonical copies: schemas/tables/05_memberships.sql,
-- schemas/functions/12_protect_primary_membership.sql,
-- schemas/functions/13_transfer_tenant_ownership.sql,
-- schemas/triggers/memberships_protect_primary.sql and
-- schemas/functions/provision_tenant.sql.
-- ==========================================================

BEGIN;

ALTER TABLE public.memberships
    ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Backfill: today's owners are the uninvited tenant admins. If a tenant
-- somehow has several, the oldest one is the founder.
UPDATE public.memberships m
SET is_primary = true
WHERE m.id IN (
    SELECT DISTINCT ON (tenant_id) id
    FROM public.memberships
    WHERE role = 'tenant_admin'
      AND invited_by IS NULL
    ORDER BY tenant_id, created_at
);

-- One owner per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_primary_per_tenant
    ON public.memberships (tenant_id)
    WHERE is_primary;

-- ----------------------------------------------------------
-- Guard: the owner row can't be demoted, disabled, removed, or have the flag
-- flipped, except inside transfer_tenant_ownership() or provision_tenant(),
-- which set app.ownership_change for their own transaction. Without this a
-- second Tenant Admin could PATCH is_primary onto themselves through
-- PostgREST, since RLS lets tenant admins update memberships.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_primary_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_allowed boolean :=
        coalesce(current_setting('app.ownership_change', true), '') = 'on';
BEGIN
    IF v_allowed THEN
        RETURN coalesce(NEW, OLD);
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.is_primary THEN
            RAISE EXCEPTION 'The workspace owner is set at signup or by an ownership transfer.'
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        -- A cascade from deleting the tenant or the user is fine: the parent
        -- row is already gone by the time this fires.
        IF OLD.is_primary
           AND EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id)
           AND EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id) THEN
            RAISE EXCEPTION 'The workspace owner can''t be removed. Transfer ownership first.'
                USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;

    -- UPDATE
    IF NEW.is_primary IS DISTINCT FROM OLD.is_primary THEN
        RAISE EXCEPTION 'Ownership can only change through an ownership transfer.'
            USING ERRCODE = '42501';
    END IF;

    IF OLD.is_primary AND (
        NEW.role <> 'tenant_admin'
        OR NEW.status <> 'active'
        OR NEW.tenant_id <> OLD.tenant_id
        OR NEW.user_id <> OLD.user_id
    ) THEN
        RAISE EXCEPTION 'The workspace owner can''t be changed or disabled. Transfer ownership first.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE
ON FUNCTION public.protect_primary_membership()
FROM authenticated, anon, public;

DROP TRIGGER IF EXISTS protect_primary_membership
ON public.memberships;

CREATE TRIGGER protect_primary_membership
BEFORE INSERT OR UPDATE OR DELETE ON public.memberships
FOR EACH ROW
EXECUTE FUNCTION public.protect_primary_membership();

-- ----------------------------------------------------------
-- transfer_tenant_ownership
--
-- Called by the current owner with their own session. The tenant comes from
-- their JWT and the caller from auth.uid(), so nobody can pass someone else's
-- workspace in. The new owner must be an active staff member of the same
-- workspace; they become a Tenant Admin if they weren't one. The previous
-- owner stays a Tenant Admin.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_tenant_ownership(
    p_new_owner_membership_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id uuid := public.current_tenant_id();
    v_caller    uuid := auth.uid();
    v_current   public.memberships%ROWTYPE;
    v_target    public.memberships%ROWTYPE;
BEGIN
    IF v_caller IS NULL OR v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Sign in to do that.' USING ERRCODE = '42501';
    END IF;

    -- Lock both rows so two transfers can't interleave.
    SELECT * INTO v_current
    FROM public.memberships
    WHERE tenant_id = v_tenant_id
      AND is_primary
    FOR UPDATE;

    IF NOT FOUND OR v_current.user_id <> v_caller OR v_current.status <> 'active' THEN
        RAISE EXCEPTION 'Only the workspace owner can transfer ownership.'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target
    FROM public.memberships
    WHERE id = p_new_owner_membership_id
      AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'That member no longer exists.' USING ERRCODE = 'P0001';
    END IF;

    IF v_target.id = v_current.id THEN
        RAISE EXCEPTION 'You already own this workspace.' USING ERRCODE = 'OT409';
    END IF;

    IF v_target.status <> 'active'
       OR v_target.role::text NOT IN ('tenant_admin', 'manager', 'agent', 'billing_admin') THEN
        RAISE EXCEPTION 'Ownership can only go to an active team member.'
            USING ERRCODE = 'OT409';
    END IF;

    PERFORM set_config('app.ownership_change', 'on', true);

    -- Clear the old flag first: the unique index allows one owner at a time.
    UPDATE public.memberships
    SET is_primary = false,
        updated_at = now()
    WHERE id = v_current.id;

    UPDATE public.memberships
    SET is_primary = true,
        role = 'tenant_admin',
        updated_at = now()
    WHERE id = v_target.id;

    PERFORM set_config('app.ownership_change', 'off', true);

    INSERT INTO public.audit_logs (tenant_id, actor_id, action, entity, entity_id, meta_json)
    VALUES (
        v_tenant_id,
        v_caller,
        'update',
        'tenant_ownership',
        v_target.id,
        jsonb_build_object(
            'event', 'ownership_transferred',
            'from_user_id', v_current.user_id,
            'to_user_id', v_target.user_id,
            'to_previous_role', v_target.role
        )
    );
END;
$$;

REVOKE EXECUTE
ON FUNCTION public.transfer_tenant_ownership(uuid)
FROM anon, public;

GRANT EXECUTE
ON FUNCTION public.transfer_tenant_ownership(uuid)
TO authenticated;

-- ----------------------------------------------------------
-- provision_tenant: the signup's membership is the owner. Same body as
-- before apart from is_primary.
-- ----------------------------------------------------------
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
        current_period_start,
        current_period_end,
        seats
    )
    VALUES (
        v_tenant_id,
        p_plan_id,
        -- A trial has no PayPal agreement; NULL is how "no agreement" is
        -- recorded everywhere since 20260920120000.
        NULL,
        'trialing',
        now(),
        now() + interval '15 days',
        (SELECT seat_limit FROM public.plans WHERE id = p_plan_id)
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


    -- The person signing up owns the workspace. is_primary is guarded by
    -- protect_primary_membership(); this transaction-local setting is what
    -- lets the founding row carry it.
    PERFORM set_config('app.ownership_change', 'on', true);

    INSERT INTO public.memberships (
        tenant_id,
        user_id,
        role,
        status,
        is_primary
    )
    VALUES (
        v_tenant_id,
        p_user_id,
        'tenant_admin',
        'active',
        true
    );

    PERFORM set_config('app.ownership_change', 'off', true);

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

COMMIT;
