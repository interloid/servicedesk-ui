-- Allow NULL values for paypal_subscription_id to support free plan rows
ALTER TABLE public.subscriptions 
ALTER COLUMN paypal_subscription_id DROP NOT NULL;