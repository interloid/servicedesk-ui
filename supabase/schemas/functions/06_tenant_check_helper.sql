CREATE OR REPLACE FUNCTION public.is_active_membership()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = (auth.jwt()->>'tenant_id')::uuid
      AND m.role::text = auth.jwt()->>'tenant_role'
      AND m.status = 'active'
);
$$;