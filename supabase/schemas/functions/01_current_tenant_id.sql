-- =====================================================
-- File: 01_current_tenant_id.sql
-- Description: Helper functions for RLS
-- =====================================================

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
SELECT (auth.jwt()->>'tenant_id')::uuid;
$$;

-- Named `current_tenant_role`, NOT `current_role`.
--
-- CURRENT_ROLE is a fully-reserved PostgreSQL keyword (unlike CURRENT_SCHEMA, which is
-- "reserved, can be function or type name"). A function called `current_role` is creatable
-- and callable ONLY in its schema-qualified form: `public.current_role()` parses because
-- the identifier after the dot is a ColLabel, which admits every keyword. Written bare,
-- the parser reduces `current_role` to a SQLValueFunction node and then hits the open
-- paren -- `ERROR: syntax error at or near "("` -- with no way to escape it short of
-- quoting. That is a permanent trap for every future policy: the call site is correct or
-- it is a syntax error, and nothing about the name warns you which. Renaming removes the
-- whole class of error rather than relying on every author remembering the prefix.
--
-- Returns the caller's role WITHIN THE CURRENT TENANT, read off the JWT claim the access
-- token hook writes -- it is unrelated to the Postgres session role that CURRENT_ROLE
-- reports, which is the other reason the old name was wrong.
CREATE OR REPLACE FUNCTION public.current_tenant_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
SELECT auth.jwt()->>'tenant_role';
$$;


