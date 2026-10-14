-- =====================================================
-- Enforce the per-user custom saved view limit
-- =====================================================
--
-- createSavedViewAction counts the user's views before it inserts, but the
-- count and the insert are separate steps: two quick submits (a double-click,
-- two tabs) both read "9 of 10" and both insert. This runs inside the write,
-- holding a per-user lock, so the second insert waits for the first and then
-- sees the real count.
--
-- Mirrors CUSTOM_VIEWS_PER_USER_MAX in src/features/saved-view/filters.ts.
-- Built-in views have no owner and never count.
--
-- Raises SQLSTATE SV409, which the saved-views service maps to its
-- "up to 10 custom saved views" message.

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
