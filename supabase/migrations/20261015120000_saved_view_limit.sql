-- RISK-010 (docs/reviews/code-review-2026-10-14.md): the per-user custom
-- view limit, enforced inside the insert. See
-- supabase/schemas/functions/23_enforce_saved_view_limit.sql.

CREATE OR REPLACE FUNCTION public.enforce_saved_view_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit CONSTANT integer := 10;
    v_used  integer;
BEGIN
    IF NEW.is_system OR NEW.owner_user_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Serialise view inserts per owner and tenant.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('saved_views:' || NEW.tenant_id || ':' || NEW.owner_user_id, 0)
    );

    SELECT count(*)
    INTO v_used
    FROM public.saved_views v
    WHERE v.tenant_id = NEW.tenant_id
      AND v.owner_user_id = NEW.owner_user_id
      AND NOT v.is_system;

    IF v_used >= v_limit THEN
        RAISE EXCEPTION 'saved-view-limit-reached: % custom views', v_limit
            USING ERRCODE = 'SV409';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE
ON FUNCTION public.enforce_saved_view_limit()
FROM authenticated, anon, public;

DROP TRIGGER IF EXISTS enforce_saved_view_limit ON public.saved_views;
CREATE TRIGGER enforce_saved_view_limit
BEFORE INSERT ON public.saved_views
FOR EACH ROW
EXECUTE FUNCTION public.enforce_saved_view_limit();
