-- =====================================================
-- Fix Subscription Switch PayPal ID Uniqueness
--
-- A tenant can move:
-- Free -> Business -> Pro -> Free -> Pro -> ...
--
-- Therefore paypal_subscription_id cannot be globally
-- unique because FREE-{tenant_id} can occur multiple
-- times in switch history.
--
-- We already enforce that a tenant can have only one
-- open switch through:
-- uq_subscription_switches_one_open_per_tenant
-- =====================================================


-- 1. Remove the old global UNIQUE constraint
ALTER TABLE public.subscription_switches
DROP CONSTRAINT IF EXISTS subscription_switches_paypal_subscription_id_key;


-- 2. Keep/enforce only one open switch per tenant
CREATE UNIQUE INDEX IF NOT EXISTS
    uq_subscription_switches_one_open_per_tenant
ON public.subscription_switches (tenant_id)
WHERE status IN ('pending', 'approved');