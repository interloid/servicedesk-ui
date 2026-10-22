-- RISK-004 (code review 2026-10-22): staff could write their own users.email
-- and users.avatar_url straight through PostgREST. The app now saves the photo
-- with the service role from a server-issued upload path and never writes
-- email; this makes the database refuse both from the client roles.
--
-- Mirrors supabase/schemas/triggers/users_profile_guard.sql.

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
