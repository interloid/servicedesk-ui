-- ==========================================================
-- File: 05_memberships.sql
-- ==========================================================

create table if not exists public.memberships
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

    role membership_role
        not null,

    status membership_status
        not null
        default 'invited',

    invited_by uuid
        references public.users(id),

    joined_at timestamptz,

    disabled_at timestamptz,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    constraint uq_membership
        unique(tenant_id, user_id)
);

