-- =====================================================
-- File: tenants_updated_at.sql
-- Description: Update tenants.updated_at automatically
-- =====================================================

DROP TRIGGER IF EXISTS set_tenants_updated_at
ON public.tenants;

CREATE TRIGGER set_tenants_updated_at
BEFORE UPDATE ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();