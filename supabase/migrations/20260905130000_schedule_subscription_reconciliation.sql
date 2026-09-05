-- Hourly reconciliation for deferred plan changes.
--
-- The BILLING.SUBSCRIPTION.ACTIVATED webhook is the primary path: it applies a
-- scheduled downgrade the moment PayPal starts the new agreement. This job is
-- the backstop for a webhook that was missed or failed, so it runs hourly to
-- keep the window where PayPal and the database disagree short.
--
-- Before this migration is useful, store the two secrets it reads (once, per
-- environment -- they are deliberately NOT committed):
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/reconcile-subscriptions',
--     'reconcile_subscriptions_url'
--   );
--   select vault.create_secret('<the CRON_SECRET set on the function>', 'cron_secret');
--
-- CRON_SECRET must match the value set via:
--   supabase secrets set CRON_SECRET=<value>

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running this migration should replace the schedule, not fail on it.
do $$
begin
    if exists (select 1 from cron.job where jobname = 'reconcile-subscriptions-hourly') then
        perform cron.unschedule('reconcile-subscriptions-hourly');
    end if;
end
$$;

select cron.schedule(
    'reconcile-subscriptions-hourly',
    '0 * * * *',
    $$
    select net.http_post(
        url := (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'reconcile_subscriptions_url'
        ),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (
                select decrypted_secret from vault.decrypted_secrets
                where name = 'cron_secret'
            )
        ),
        body := '{}'::jsonb
    );
    $$
);
