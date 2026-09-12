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
