-- ==========================================================
-- File: 20260908161500_portal_request_priority.sql
-- Description: Let the customer choose a priority when raising a request
-- ==========================================================
--
-- The portal's submit form now has a priority dropdown, so the intake function
-- has to accept one instead of hardcoding 'normal'. The value is typed as
-- `public.ticket_priority`, so Postgres rejects anything outside the enum
-- before the row is written -- the server action never has to sanitise it.
--
-- REPLACES an existing object, unlike 20260908093000. That is safe here in a
-- way it is not for the attachments policies: portal_create_request was added
-- in 20260908093000 earlier today, its definition is in this repo, and it is
-- called from exactly one place (createPortalRequest in the portal service),
-- never from SQL.
--
-- Adding a parameter changes the signature, and CREATE OR REPLACE cannot do
-- that -- it would leave the old six-argument function in place as an overload
-- and make every call ambiguous. So the old signature is dropped explicitly.

begin;

drop function if exists public.portal_create_request(
    text, text, text, text, text, uuid
);

create or replace function public.portal_create_request(
    p_tenant_slug text,
    p_email       text,
    p_subject     text,
    p_description text,
    p_full_name   text default null,
    p_user_id     uuid default null,
    p_priority    public.ticket_priority default 'normal'
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
        p_priority,
        v_customer.id,
        v_sla_id
    )
    returning * into v_ticket;

    return jsonb_build_object(
        'ticket_id',   v_ticket.id,
        'number',      v_ticket.number,
        'subject',     v_ticket.subject,
        'status',      v_ticket.status::text,
        'priority',    v_ticket.priority::text,
        'created_at',  v_ticket.created_at,
        'customer_id', v_customer.id
    );
end;
$$;

comment on function public.portal_create_request(text, text, text, text, text, uuid, public.ticket_priority) is
'Create a ticket from the customer portal, creating the customer row when the email is new. service_role only -- the calling server action rate-limits by IP.';

revoke execute on function public.portal_create_request(text, text, text, text, text, uuid, public.ticket_priority)
    from public, anon, authenticated;

grant execute on function public.portal_create_request(text, text, text, text, text, uuid, public.ticket_priority)
    to service_role;

commit;
