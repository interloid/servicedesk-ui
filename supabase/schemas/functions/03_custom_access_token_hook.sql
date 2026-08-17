-- ==========================================================
-- File: 03_custom_access_token_hook.sql
-- Description: Add tenant_id and tenant_role to JWT
-- ==========================================================

------------------------------------------------------------
-- Create Access Token Hook
------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    claims jsonb;
    v_tenant_id uuid;
    v_tenant_role text;
    v_membership_id uuid;
begin
    --------------------------------------------------------
    -- Existing JWT claims
    --------------------------------------------------------

    claims := event->'claims';

    --------------------------------------------------------
    -- Pick the caller's membership.
    --
    -- Active memberships win; a user with several memberships
    -- (unlikely here, but possible) always resolves to their
    -- active one. Disabled memberships are never selected, so a
    -- deactivated member is cut off from claims entirely.
    -- An invited member who signs in is activated here, stamped
    -- with the invite's role on their very first token.
    --------------------------------------------------------

    select
        m.id,
        m.tenant_id,
        m.role::text
    into
        v_membership_id,
        v_tenant_id,
        v_tenant_role
    from public.memberships m
    where m.user_id = (event->>'user_id')::uuid
      and m.status <> 'disabled'
    order by (case when m.status = 'active' then 0 else 1 end), m.created_at
    limit 1;

    --------------------------------------------------------
    -- Activate the invite on first sign-in (idempotent).
    --------------------------------------------------------

    if v_membership_id is not null then
        update public.memberships
        set status = 'active',
            joined_at = coalesce(joined_at, now()),
            updated_at = now()
        where id = v_membership_id
          and status = 'invited';
    end if;

    --------------------------------------------------------
    -- Add tenant_id claim
    --------------------------------------------------------

    claims := jsonb_set(
        claims,
        '{tenant_id}',
        to_jsonb(v_tenant_id),
        true
    );

    --------------------------------------------------------
    -- Add tenant_role claim
    --------------------------------------------------------

    claims := jsonb_set(
        claims,
        '{tenant_role}',
        to_jsonb(v_tenant_role),
        true
    );

    --------------------------------------------------------
    -- Update event claims
    --------------------------------------------------------

    event := jsonb_set(
        event,
        '{claims}',
        claims,
        true
    );

    return event;
end;
$$;

------------------------------------------------------------
-- Permissions
------------------------------------------------------------

grant execute
on function public.custom_access_token_hook(jsonb)
to supabase_auth_admin;

revoke execute
on function public.custom_access_token_hook(jsonb)
from authenticated, anon, public;
