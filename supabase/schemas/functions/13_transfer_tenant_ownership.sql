-- =====================================================
-- File: 13_transfer_tenant_ownership.sql
-- Description: The owner hands the workspace to another active member
-- =====================================================

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
