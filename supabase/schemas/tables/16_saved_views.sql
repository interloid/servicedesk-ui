-- =====================================================
-- Saved Views
-- =====================================================
--
-- One row per view. The four built-in views (All tickets, New, Open, Resolved)
-- are rows too: `is_system`, no owner, one per `system_key` per tenant, seeded
-- by public.seed_system_saved_views() when a tenant is created.

create table if not exists public.saved_views
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    -- null only for built-in views
    owner_user_id uuid
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

    is_system boolean
        not null
        default false,

    -- 'all' | 'new' | 'open' | 'resolved' on built-in views, null otherwise
    system_key text,

    -- staff roles that see the view when it is shared (or built-in)
    visibility_roles text[]
        not null
        default array['tenant_admin', 'manager', 'agent']::text[],

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    constraint saved_views_id_tenant_key unique (id, tenant_id),

    constraint saved_views_system_shape check (
        case
            when is_system then owner_user_id is null
                and system_key in ('all', 'new', 'open', 'resolved')
            else owner_user_id is not null and system_key is null
        end
    ),

    constraint saved_views_visibility_roles_valid check (
        cardinality(visibility_roles) > 0
        and visibility_roles <@ array['tenant_admin', 'manager', 'agent', 'billing_admin']::text[]
    ),

    constraint saved_views_name_length check (
        char_length(btrim(name)) between 1 and 80
    )
);

create unique index if not exists saved_views_system_key_idx
    on public.saved_views (tenant_id, system_key)
    where is_system;

create index if not exists saved_views_tenant_idx
    on public.saved_views (tenant_id, created_at);

-- =====================================================
-- Saved View User Preferences
-- =====================================================
--
-- Each user's own order and pin for a view they can see. Dragging a shared
-- view writes here, never to saved_views, so it moves for that user only.

create table if not exists public.saved_view_user_preferences
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    user_id uuid
        not null
        references public.users(id)
        on delete cascade,

    saved_view_id uuid
        not null,

    order_position integer
        not null
        default 0
        check (order_position >= 0),

    is_pinned boolean
        not null
        default false,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    constraint saved_view_user_preferences_unique
        unique (user_id, saved_view_id),

    constraint saved_view_user_preferences_view_fk
        foreign key (saved_view_id, tenant_id)
        references public.saved_views (id, tenant_id)
        on delete cascade
);

create index if not exists saved_view_preferences_order_idx
    on public.saved_view_user_preferences (tenant_id, user_id, order_position);

create index if not exists saved_view_preferences_view_idx
    on public.saved_view_user_preferences (saved_view_id);
