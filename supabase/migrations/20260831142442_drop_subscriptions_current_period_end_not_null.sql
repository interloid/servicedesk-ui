-- Make current_period_end nullable so "trialing" subscriptions
-- (which have no period end yet) can be stored without a placeholder value.
ALTER TABLE public.subscriptions
  ALTER COLUMN current_period_end DROP NOT NULL;
