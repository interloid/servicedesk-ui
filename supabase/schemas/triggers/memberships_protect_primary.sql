-- =====================================================
-- File: memberships_protect_primary.sql
-- Description: Guard the workspace owner's membership row
-- =====================================================

DROP TRIGGER IF EXISTS protect_primary_membership
ON public.memberships;

CREATE TRIGGER protect_primary_membership
BEFORE INSERT OR UPDATE OR DELETE ON public.memberships
FOR EACH ROW
EXECUTE FUNCTION public.protect_primary_membership();
