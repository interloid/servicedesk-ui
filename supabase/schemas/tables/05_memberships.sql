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

    -- The workspace owner. Set by provision_tenant at signup, moved only by
    -- transfer_tenant_ownership(); protect_primary_membership() guards it.
    is_primary boolean
        not null
        default false,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    constraint uq_membership
        unique(tenant_id, user_id)
);

-- One owner per workspace.
create unique index if not exists uq_memberships_primary_per_tenant
    on public.memberships (tenant_id)
    where is_primary;
