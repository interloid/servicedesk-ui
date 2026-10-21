-- =====================================================
-- File: saved_views.sql
-- Description: updated_at stamps for saved views and their per-user
-- preferences, and the built-in views for every new tenant
-- =====================================================

DROP TRIGGER IF EXISTS set_saved_views_updated_at
ON public.saved_views;

CREATE TRIGGER set_saved_views_updated_at
BEFORE UPDATE ON public.saved_views
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_saved_view_user_preferences_updated_at
ON public.saved_view_user_preferences;

CREATE TRIGGER set_saved_view_user_preferences_updated_at
BEFORE UPDATE ON public.saved_view_user_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS tenants_seed_system_saved_views
ON public.tenants;

CREATE TRIGGER tenants_seed_system_saved_views
AFTER INSERT ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.seed_system_saved_views_for_tenant();

DROP TRIGGER IF EXISTS enforce_saved_view_limit
ON public.saved_views;

CREATE TRIGGER enforce_saved_view_limit
BEFORE INSERT ON public.saved_views
FOR EACH ROW
EXECUTE FUNCTION public.enforce_saved_view_limit();
