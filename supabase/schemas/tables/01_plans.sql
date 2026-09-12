-- =====================================================
-- File: 01_plans.sql
-- Description: Subscription Plans
-- =====================================================

create table if not exists public.plans
(
    id uuid primary key default gen_random_uuid(),

    code text not null unique,

    name text not null,

    description text,

    price_month numeric(10,2) not null default 0,

    seat_limit integer not null,

    ticket_limit integer,

    storage_limit_mb integer default 1024,

    features_json jsonb not null default '{}'::jsonb,

    is_active boolean not null default true,

    sort_order integer not null default 0,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint chk_plan_price
        check (price_month >= 0),

    constraint chk_seat_limit
        check (seat_limit >= 1),

    constraint chk_storage_limit
        check (storage_limit_mb >= 0)
);

comment on table plans is
'Master subscription plans';

comment on column plans.code is
'FREE, PRO, BUSINESS';

comment on column plans.features_json is
'Feature flags for UI';
