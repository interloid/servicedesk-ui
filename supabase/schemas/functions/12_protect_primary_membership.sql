-- =====================================================
-- File: 12_protect_primary_membership.sql
-- Description: Keep the workspace owner's membership (is_primary) from being
--              flipped, demoted, disabled or deleted outside an ownership
--              transfer or signup.
-- =====================================================

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
