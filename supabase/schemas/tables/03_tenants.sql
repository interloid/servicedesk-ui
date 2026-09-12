-- ==========================================================
-- File: 03_tenants.sql
-- ==========================================================

create table if not exists public.tenants
(
    id uuid primary key
        default gen_random_uuid(),

    name text
        not null,

    slug text
        not null
        unique,

    status tenant_status
        not null
        default 'active',

    plan_id uuid
        not null
        references public.plans(id),

    branding_json jsonb
        not null
        default '{}'::jsonb,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now()
);

comment on table public.tenants is
'Root tenant record';

------------------------------------------------------------
-- Indexes
------------------------------------------------------------

create unique index if not exists idx_tenant_slug
on public.tenants(slug);

create index if not exists idx_tenant_status
on public.tenants(status);

create index if not exists idx_tenant_plan
on public.tenants(plan_id);


