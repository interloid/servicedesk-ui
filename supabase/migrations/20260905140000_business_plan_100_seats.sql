-- Business plan now includes 100 agent seats (was effectively unlimited).
-- Prices/limits must stay in sync with the seed at supabase/schemas/seeds/01_plans_seed.sql.
update public.plans
set seat_limit = 100,
    description = 'Advanced governance, AI automation, and scale for larger teams.',
    updated_at = now()
where name = 'Business'
  and is_active = true;

update public.plans
set description = 'For small teams getting started with help desk essentials.',
    updated_at = now()
where name = 'Free';

update public.plans
set description = 'For growing teams that need SLA policies, shared views, and reporting.',
    updated_at = now()
where name = 'Pro';