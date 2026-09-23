-- =====================================================
-- File: memberships_seat_limit.sql
-- Description: Block membership writes that would exceed the plan's seats
-- =====================================================

DROP TRIGGER IF EXISTS enforce_team_seat_limit
ON public.memberships;

CREATE TRIGGER enforce_team_seat_limit
BEFORE INSERT OR UPDATE OF role, status, tenant_id ON public.memberships
FOR EACH ROW
EXECUTE FUNCTION public.enforce_team_seat_limit();
