-- ==========================================================
-- File: 20260908093000_customer_portal_onboarding.sql
-- Description: Customer portal sign-in + onboarding
-- ==========================================================
--
-- The schema already anticipated a customer portal: `membership_role` has a
-- 'customer' value, `customers.portal_user_id` points at auth.users, and the
-- tickets / ticket_messages / storage policies all branch on
-- `current_tenant_role() = 'customer'`. What was missing is the step that
-- actually PRODUCES that state for a person who signs in from the portal.
--
-- A portal visitor arrives with nothing but an email address. After an OTP or
-- magic-link verification they hold an auth.users row and no more: no
-- public.users mirror, no membership, so `custom_access_token_hook` writes no
-- tenant_id / tenant_role claim and every RLS policy above denies them. This
-- migration adds the linking step that turns a bare auth user into a customer
-- of one tenant, plus the two columns the onboarding wizard reads.
--
-- Purely additive: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and
-- three CREATE OR REPLACE FUNCTIONs under names nothing else uses. It drops
-- nothing. The RLS hardening the portal also requires is split into
-- 20260908093100 because that one REPLACES existing policies.
--
-- Both functions are SECURITY DEFINER and granted to `service_role` ONLY. They
-- are called from server actions through the admin client, never from the
-- browser: they take the acting user id as an argument rather than reading
-- auth.uid(), so exposing them to `authenticated` would let any signed-in user
-- name any other user. The revoke below is load-bearing, not decoration.

begin;

------------------------------------------------------------
-- 1. Onboarding state on the customer record
------------------------------------------------------------
--
-- Kept on `customers` rather than a separate portal_profiles table: it is two
-- nullable timestamps read on every portal page load, and the customer row is
-- already fetched there. Split it out if portal preferences grow past this.

alter table public.customers
    add column if not exists portal_onboarded_at timestamptz;

alter table public.customers
    add column if not exists portal_last_login_at timestamptz;

comment on column public.customers.portal_onboarded_at is
'When the customer finished the portal welcome wizard. Null means the wizard is still owed to them.';

comment on column public.customers.portal_last_login_at is
'Last successful portal sign-in. Written by portal_link_user on every sign-in.';

-- portal_link_user and the portal identity lookup both hit (tenant_id, portal_user_id)
-- on every authenticated portal request. idx_customer_portal covers portal_user_id
-- alone; this makes the tenant-scoped lookup an index-only match.
create index if not exists idx_customer_tenant_portal
on public.customers(tenant_id, portal_user_id);

------------------------------------------------------------
-- 2. Link a verified auth user to a tenant's customer record
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
        'customer_id',  v_customer.id,
        'tenant_id',    v_tenant.id,
        'tenant_slug',  v_tenant.slug,
        'tenant_name',  v_tenant.name,
        'email',        v_customer.email::text,
        'full_name',    v_customer.full_name,
        'company',      v_customer.company,
        'role',         v_membership.role::text,
        'onboarded',    v_customer.portal_onboarded_at is not null,
        'has_password', v_has_password
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
-- 3. Finish the welcome wizard
------------------------------------------------------------

create or replace function public.portal_complete_onboarding(
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
    set portal_onboarded_at = coalesce(c.portal_onboarded_at, now()),
        updated_at          = now()
    from public.tenants t
    where c.tenant_id = t.id
      and t.slug = lower(p_tenant_slug)
      and c.portal_user_id = p_user_id
    returning c.* into v_customer;

    if not found then
        raise exception 'portal_complete_onboarding: no portal customer for that user in "%"', p_tenant_slug
            using errcode = 'P0002';
    end if;

    return jsonb_build_object(
        'customer_id', v_customer.id,
        'onboarded',   true
    );
end;
$$;

comment on function public.portal_complete_onboarding(uuid, text) is
'Stamp portal_onboarded_at so the welcome wizard is not shown again. Idempotent — the first completion time is kept.';

revoke execute on function public.portal_complete_onboarding(uuid, text)
    from public, anon, authenticated;

grant execute on function public.portal_complete_onboarding(uuid, text)
    to service_role;

------------------------------------------------------------
-- 4. Raise a request without an account
------------------------------------------------------------
--
-- Backs the "First time here? You don't need an account to reach us" path. It
-- creates the customer row as a side effect, so the same email later signing in
-- through portal_link_user claims this ticket history.
--
-- Deliberately NOT granted to anon: it is called from a server action that
-- rate-limits by IP first. An anon grant would make it a spam endpoint and a
-- tenant-membership oracle.

create or replace function public.portal_create_request(
    p_tenant_slug text,
    p_email       text,
    p_subject     text,
    p_description text,
    p_full_name   text default null,
    p_user_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant     public.tenants%rowtype;
    v_customer   public.customers%rowtype;
    v_ticket     public.tickets%rowtype;
    v_email      citext;
    v_full_name  text;
    v_sla_id     uuid;
begin
    v_email := lower(trim(p_email));

    if v_email is null or v_email::text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'portal_create_request: a valid email address is required'
            using errcode = '22023';
    end if;

    if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_description), '') = '' then
        raise exception 'portal_create_request: subject and description are required'
            using errcode = '22023';
    end if;

    select * into v_tenant
    from public.tenants
    where slug = lower(p_tenant_slug)
      and status = 'active';

    if not found then
        raise exception 'portal_create_request: no active workspace for slug "%"', p_tenant_slug
            using errcode = 'P0002';
    end if;

    v_full_name := coalesce(
        nullif(trim(p_full_name), ''),
        initcap(replace(split_part(v_email::text, '@', 1), '.', ' '))
    );

    --------------------------------------------------------
    -- Customer
    --------------------------------------------------------

    select * into v_customer
    from public.customers
    where tenant_id = v_tenant.id
      and email = v_email;

    if not found then
        insert into public.customers (tenant_id, email, full_name, portal_user_id)
        values (v_tenant.id, v_email, v_full_name, p_user_id)
        returning * into v_customer;

    elsif p_user_id is not null and v_customer.portal_user_id is distinct from p_user_id then
        -- A signed-in caller may only file against their own record. An
        -- unclaimed row (portal_user_id null) is claimed here; one already
        -- held by somebody else is refused.
        if v_customer.portal_user_id is null then
            update public.customers
            set portal_user_id = p_user_id,
                updated_at     = now()
            where id = v_customer.id
            returning * into v_customer;
        else
            raise exception 'portal_create_request: % belongs to a different sign-in', v_email
                using errcode = '42501';
        end if;
    end if;

    --------------------------------------------------------
    -- Ticket
    --
    -- number is filled by the tickets_set_number trigger.
    -- The tenant's default active policy is attached when it has one, so the
    -- portal's "first reply within N hours" promise is measured.
    --------------------------------------------------------

    select id into v_sla_id
    from public.sla_policies
    where tenant_id = v_tenant.id
      and status = 'active'
    order by is_default desc, created_at
    limit 1;

    insert into public.tickets (
        tenant_id,
        subject,
        description,
        status,
        priority,
        requester_customer_id,
        sla_policy_id
    )
    values (
        v_tenant.id,
        trim(p_subject),
        trim(p_description),
        'new',
        'normal',
        v_customer.id,
        v_sla_id
    )
    returning * into v_ticket;

    return jsonb_build_object(
        'ticket_id',   v_ticket.id,
        'number',      v_ticket.number,
        'subject',     v_ticket.subject,
        'status',      v_ticket.status::text,
        'created_at',  v_ticket.created_at,
        'customer_id', v_customer.id
    );
end;
$$;

comment on function public.portal_create_request(text, text, text, text, text, uuid) is
'Create a ticket from the customer portal, creating the customer row when the email is new. service_role only — the calling server action rate-limits by IP.';

revoke execute on function public.portal_create_request(text, text, text, text, text, uuid)
    from public, anon, authenticated;

grant execute on function public.portal_create_request(text, text, text, text, text, uuid)
    to service_role;

commit;
