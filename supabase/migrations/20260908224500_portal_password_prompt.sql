-- ==========================================================
-- Show the optional "Set a password?" screen once, at signup
-- ==========================================================
--
-- Before this, the step after a portal sign-in was chosen from
-- `auth.users.encrypted_password` alone, which is derived fresh every time. A
-- customer who took the "Skip -- keep using links" button was therefore sent
-- back to the same screen on EVERY subsequent magic-link sign-in: the skip
-- wrote nothing, so there was nothing to remember it by.
--
-- `portal_password_prompted_at` is that memory, and it mirrors
-- `portal_onboarded_at` exactly -- same table, same nullable-timestamp shape,
-- same idempotent stamping function.
--
-- On the drift held in supabase/migrations-pending-review/README.md: this
-- REPLACES portal_link_user, which that README warns about. It is safe here
-- because the function was first created by 20260908093000, later than every
-- unknown remote migration (20260904..20260907), so none of them can have
-- touched it. The replacement below is the 20260908093000 body plus one
-- returned key.

------------------------------------------------------------
-- Column
------------------------------------------------------------

alter table public.customers
    add column if not exists portal_password_prompted_at timestamptz;

comment on column public.customers.portal_password_prompted_at is
'When the customer was last offered the optional "Set a password?" screen. Non-null means they answered it once -- by saving a password or by skipping -- so sign-in stops routing them there. Null means the offer is still owed.';

-- Anyone who already reached the portal has seen the screen at least once
-- under the old routing; leaving them null would show it to them one more
-- time. Customers who never signed in keep a null and get the offer on their
-- first sign-in, which is the point.

update public.customers
set portal_password_prompted_at = coalesce(portal_password_prompted_at, portal_last_login_at)
where portal_last_login_at is not null;

------------------------------------------------------------
-- portal_link_user -- now reports whether the offer is spent
------------------------------------------------------------

create or replace function public.portal_link_user(
    p_user_id     uuid,
    p_tenant_slug text,
    p_full_name   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant       public.tenants%rowtype;
    v_customer     public.customers%rowtype;
    v_membership   public.memberships%rowtype;
    v_email        citext;
    v_full_name    text;
    v_has_password boolean;
begin
    if p_user_id is null then
        raise exception 'portal_link_user: a user id is required'
            using errcode = '22004';
    end if;

    --------------------------------------------------------
    -- Tenant
    --------------------------------------------------------

    select * into v_tenant
    from public.tenants
    where slug = lower(p_tenant_slug)
      and status = 'active';

    if not found then
        raise exception 'portal_link_user: no active workspace for slug "%"', p_tenant_slug
            using errcode = 'P0002';
    end if;

    --------------------------------------------------------
    -- Identity, read from auth rather than trusted from the caller.
    --
    -- The display name falls back to the email local part title-cased
    -- ("marcus.feld" -> "Marcus Feld") because public.users.full_name is NOT
    -- NULL and a portal visitor never types a name before their first ticket.
    --------------------------------------------------------

    select
        u.email,
        coalesce(
            nullif(trim(p_full_name), ''),
            nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
            initcap(replace(split_part(u.email::text, '@', 1), '.', ' '))
        ),
        u.encrypted_password is not null and u.encrypted_password <> ''
    into v_email, v_full_name, v_has_password
    from auth.users u
    where u.id = p_user_id;

    if not found then
        raise exception 'portal_link_user: auth user % does not exist', p_user_id
            using errcode = 'P0002';
    end if;

    --------------------------------------------------------
    -- Mirror row in public.users.
    --
    -- An existing full_name is never clobbered: an agent who also raises
    -- tickets as a customer keeps the name their team set.
    --------------------------------------------------------

    insert into public.users (id, email, full_name)
    values (p_user_id, v_email, v_full_name)
    on conflict (id) do update
        set email      = excluded.email,
            full_name  = coalesce(
                             nullif(trim(users.full_name), ''),
                             excluded.full_name
                         ),
            updated_at = now();

    --------------------------------------------------------
    -- Customer record for this tenant.
    --
    -- Matching on email is what makes "we'll set one up from your email" work:
    -- an agent who already created the customer by hand, or an anonymous
    -- request raised earlier, is claimed by the same person on first sign-in
    -- rather than duplicated.
    --------------------------------------------------------

    select * into v_customer
    from public.customers
    where tenant_id = v_tenant.id
      and email = v_email;

    if not found then
        insert into public.customers (tenant_id, email, full_name, portal_user_id)
        values (v_tenant.id, v_email, v_full_name, p_user_id)
        returning * into v_customer;

    elsif v_customer.portal_user_id is null then
        update public.customers
        set portal_user_id = p_user_id,
            updated_at     = now()
        where id = v_customer.id
        returning * into v_customer;

    elsif v_customer.portal_user_id <> p_user_id then
        -- Two auth identities claiming one customer row. Refuse rather than
        -- repoint the row: the losing session would silently inherit the other
        -- person's ticket history.
        raise exception 'portal_link_user: % is already linked to a different sign-in for this workspace', v_email
            using errcode = '42501';
    end if;

    --------------------------------------------------------
    -- Membership. This is what the access-token hook reads.
    --
    -- The role is set only when the membership is created. A tenant_admin,
    -- manager or agent who signs into their own portal keeps their staff role;
    -- demoting them to 'customer' here would strip their queue access on their
    -- next token refresh.
    --------------------------------------------------------

    select * into v_membership
    from public.memberships
    where tenant_id = v_tenant.id
      and user_id = p_user_id;

    if not found then
        insert into public.memberships (tenant_id, user_id, role, status, joined_at)
        values (v_tenant.id, p_user_id, 'customer', 'active', now())
        returning * into v_membership;

    elsif v_membership.status = 'disabled' then
        raise exception 'portal_link_user: access to this workspace has been disabled'
            using errcode = '42501';

    elsif v_membership.status <> 'active' then
        update public.memberships
        set status     = 'active',
            joined_at  = coalesce(joined_at, now()),
            updated_at = now()
        where id = v_membership.id
        returning * into v_membership;
    end if;

    --------------------------------------------------------
    -- Sign-in bookkeeping
    --------------------------------------------------------

    update public.customers
    set portal_last_login_at = now(),
        updated_at           = now()
    where id = v_customer.id
    returning * into v_customer;

    return jsonb_build_object(
        'customer_id',       v_customer.id,
        'tenant_id',         v_tenant.id,
        'tenant_slug',       v_tenant.slug,
        'tenant_name',       v_tenant.name,
        'email',             v_customer.email::text,
        'full_name',         v_customer.full_name,
        'company',           v_customer.company,
        'role',              v_membership.role::text,
        'onboarded',         v_customer.portal_onboarded_at is not null,
        'has_password',      v_has_password,
        'password_prompted', v_customer.portal_password_prompted_at is not null
    );
end;
$$;

comment on function public.portal_link_user(uuid, text, text) is
'Turn a verified auth user into an active customer of one tenant: mirror public.users, claim or create the customers row, and ensure a membership so custom_access_token_hook can write tenant claims. service_role only — it trusts its p_user_id argument.';

revoke execute on function public.portal_link_user(uuid, text, text)
    from public, anon, authenticated;

grant execute on function public.portal_link_user(uuid, text, text)
    to service_role;

------------------------------------------------------------
-- Retire the offer
------------------------------------------------------------

create or replace function public.portal_mark_password_prompted(
    p_user_id     uuid,
    p_tenant_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_customer public.customers%rowtype;
begin
    update public.customers c
    set portal_password_prompted_at = coalesce(c.portal_password_prompted_at, now()),
        updated_at                  = now()
    from public.tenants t
    where c.tenant_id = t.id
      and t.slug = lower(p_tenant_slug)
      and c.portal_user_id = p_user_id
    returning c.* into v_customer;

    if not found then
        raise exception 'portal_mark_password_prompted: no portal customer for that user in "%"', p_tenant_slug
            using errcode = 'P0002';
    end if;

    return jsonb_build_object(
        'customer_id',       v_customer.id,
        'password_prompted', true
    );
end;
$$;

comment on function public.portal_mark_password_prompted(uuid, text) is
'Stamp portal_password_prompted_at so the optional "Set a password?" screen is not shown again. Idempotent -- the first prompt time is kept.';

revoke execute on function public.portal_mark_password_prompted(uuid, text)
    from public, anon, authenticated;

grant execute on function public.portal_mark_password_prompted(uuid, text)
    to service_role;
