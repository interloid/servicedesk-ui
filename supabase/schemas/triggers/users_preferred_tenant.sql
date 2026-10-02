-- ==========================================================
-- File: users_preferred_tenant.sql
-- Description: Mirror public.users.preferred_tenant_id into auth app_metadata
-- ==========================================================
--
-- public.users.preferred_tenant_id is the source of truth: it is a column on a
-- table the application can read and write, and it survives a token refresh.
-- auth.users.app_metadata is a copy, and it exists only because the access token
-- hook is handed the claims and nothing else -- it cannot see cookies, headers
-- or any other table. So the value has to be inside the token for the hook to
-- order by it.
--
-- app_metadata rather than user_metadata on purpose: user_metadata is writable
-- by the signed-in user from the browser, so anything read out of it during token
-- minting is an input rather than a setting.

create or replace function public.sync_auth_user_preferred_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'UPDATE'
       and new.preferred_tenant_id is not distinct from old.preferred_tenant_id
    then
        return new;
    end if;

    if tg_op = 'INSERT' and new.preferred_tenant_id is null then
        return new;
    end if;

    -- Read raw_app_meta_data off the row being updated rather than assuming a
    -- previous version of this trigger wrote a well-formed value: a merge keeps
    -- whatever else Auth and other hooks have put there. Clearing the column
    -- clears the copy, or the hook would keep honouring a stale preference.
    update auth.users
    set raw_app_meta_data = case
            when new.preferred_tenant_id is null
                then coalesce(raw_app_meta_data, '{}'::jsonb) - 'preferred_tenant_id'
            else coalesce(raw_app_meta_data, '{}'::jsonb)
                || jsonb_build_object(
                    'preferred_tenant_id',
                    new.preferred_tenant_id::text
                )
        end,
        updated_at = now()
    where id = new.id;

    return new;
end;
$$;

COMMENT ON FUNCTION public.sync_auth_user_preferred_tenant() IS
'Mirrors public.users.preferred_tenant_id into auth.users.app_metadata.preferred_tenant_id, which is the only place custom_access_token_hook can see it.';

-- AFTER, and UPDATE OF the one column: this writes to auth.users on every call,
-- and the only thing worth reacting to is the preference changing. A user with no
-- preference set (the common case) fires nothing at all.
CREATE OR REPLACE TRIGGER sync_auth_user_preferred_tenant
AFTER INSERT OR UPDATE OF preferred_tenant_id ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_auth_user_preferred_tenant();

-- Only the server sets the preference. users_update lets a user edit their own
-- row (and a tenant admin edit their members'), and a policy cannot narrow
-- columns, so without this a user could PATCH their own preferred_tenant_id
-- through PostgREST -- harmless today, since the hook only ever picks from real
-- memberships, but it is a server decision and the app writes it with the admin
-- client (service_role) when a portal sign-in completes. SECURITY INVOKER on
-- purpose: current_user is then the PostgREST role of the caller.
create or replace function public.guard_users_preferred_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if current_user in ('authenticated', 'anon')
       and (
           (tg_op = 'INSERT' and new.preferred_tenant_id is not null)
           or (
               tg_op = 'UPDATE'
               and new.preferred_tenant_id is distinct from old.preferred_tenant_id
           )
       )
    then
        raise exception 'preferred_tenant_id is set by the server'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function public.guard_users_preferred_tenant() is
'Refuses writes to public.users.preferred_tenant_id from the authenticated/anon roles; the server sets it with the service role.';

CREATE OR REPLACE TRIGGER guard_users_preferred_tenant
before insert or update of preferred_tenant_id on public.users
for each row
execute function public.guard_users_preferred_tenant();
