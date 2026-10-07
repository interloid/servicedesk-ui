-- ==========================================================
-- File: 16_uuid_or_null.sql
-- Description: Text to uuid, or null when the text is not a uuid
-- ==========================================================
--
-- A bare `text::uuid` raises on anything that is not a uuid, it does not return
-- null. Inside a policy that is the difference between "this row is not yours"
-- and "every query against this table now fails", which is what happens when the
-- text being cast comes from a path.
--
-- Storage object names are exactly that: `<tenant>/staging/<batch>/<file>` for a
-- request not filed yet, `<tenant>/<ticket>/<message>/<file>` afterwards. Segment
-- two is a uuid in one of those and the literal string 'staging' in the other, and
-- the storage policies compare it to tickets.id. Casting it directly made any
-- statement that evaluated the policy against a staged object -- a customer's
-- listing of the bucket, say -- raise rather than skip the row, so the customer
-- saw a broken page instead of a row they were not entitled to.
--
-- Immutable and safe to call from a policy. It reads nothing.

CREATE OR REPLACE FUNCTION public.uuid_or_null(p_text text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT CASE
        WHEN p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN p_text::uuid
        ELSE NULL
    END;
$$;

COMMENT ON FUNCTION public.uuid_or_null(text) IS
'Casts text to uuid, returning null instead of raising when the text is not a uuid. For path segments compared against an id inside a policy.';

REVOKE EXECUTE ON FUNCTION public.uuid_or_null(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.uuid_or_null(text) TO authenticated, service_role;
