-- ==========================================================
-- File: 04_users.sql
-- Description: Application Users
-- Uses Supabase Auth (auth.users)
-- ==========================================================

create table if not exists public.users
(
    id uuid primary key
        references auth.users(id)
        on delete cascade,

    email citext not null unique,

    full_name text not null,

    avatar_url text,

    -- The workspace this user should land in when their token is minted.
    -- custom_access_token_hook can only name one tenant per token and every RLS
    -- policy reads that claim, so somebody who belongs to more than one
    -- workspace needs to be able to say which. The hook cannot read a cookie,
    -- so triggers/users_preferred_tenant.sql mirrors this into
    -- auth.users.app_metadata, which is inside the token the hook receives.
    --
    -- Advisory, never a grant: the hook still picks from the caller's real
    -- memberships, and RLS still checks the membership behind whatever claims it
    -- writes. Setting this to a tenant the user does not belong to has no effect
    -- beyond being ignored.
    preferred_tenant_id uuid
        references public.tenants(id)
        on delete set null,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now()
);

comment on table public.users is
'Application users linked 1:1 with Supabase auth.users';

comment on column public.users.id is
'Supabase Auth User ID';

comment on column public.users.email is
'Unique login email';

comment on column public.users.avatar_url is
'Profile image';

comment on column public.users.preferred_tenant_id is
'The workspace this user should land in. Mirrored into auth.users.app_metadata so custom_access_token_hook can honour it; advisory, and never a grant: RLS still checks the membership behind the claims it selects.';
