-- =====================================================
-- Saved Views
-- =====================================================

create table if not exists public.saved_views
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    owner_user_id uuid
        not null
        references public.users(id)
        on delete cascade,

    name text
        not null,

    filter_json jsonb
        not null
        default '{}'::jsonb,

    is_shared boolean
        not null
        default false,

    created_at timestamptz
        default now(),

    updated_at timestamptz
        default now()
);

