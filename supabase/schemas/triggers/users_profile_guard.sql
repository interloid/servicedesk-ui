-- ==========================================================
-- File: users_profile_guard.sql
-- Description: Only the server writes public.users.email and avatar_url
-- ==========================================================
--
-- users_update lets a user edit their own row (and a tenant admin edit their
-- members'), and a policy cannot narrow columns. So without this a staff
-- member could PATCH their own email through PostgREST -- taking someone
-- else's address, which then shows in the team list and collides with the real
-- owner's invite or reset -- or point avatar_url at any outside server, which
-- every colleague's browser then loads.
--
-- email follows the auth account and is never edited in the app. avatar_url is
-- written by the server (service role) from a path it handed out for an upload.
-- SECURITY INVOKER on purpose: current_user is then the PostgREST role of the
-- caller. Same pattern as guard_users_preferred_tenant.
create or replace function public.guard_users_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if current_user in ('authenticated', 'anon')
       and (
           new.email is distinct from old.email
           or new.avatar_url is distinct from old.avatar_url
       )
    then
        raise exception 'email and avatar_url are set by the server'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function public.guard_users_profile_columns() is
'Refuses changes to public.users.email and avatar_url from the authenticated/anon roles; the server sets them with the service role.';

CREATE OR REPLACE TRIGGER guard_users_profile_columns
before update of email, avatar_url on public.users
for each row
execute function public.guard_users_profile_columns();
