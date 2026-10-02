-- ==========================================================
-- File: 20260926120000_portal_rls_hardening.sql
-- Description: Close the RLS and storage surface a signed-in customer reaches
-- ==========================================================
--
-- Everything here follows from one fact: portal_link_user turns an email address
-- into a real membership, so for the first time `current_tenant_role()` can be
-- 'customer' on a session that reaches PostgREST directly. Every portal RLS
-- branch written from a time when members were all staff is now reachable by
-- somebody holding nothing but their session token and the public anon key.
--
-- Four holes, closed below:
--
--   1. tickets_update admitted a customer and checked only tenant_id in its
--      WITH CHECK, so PATCH /rest/v1/tickets could set priority, assignee,
--      status, sla_policy_id or first_response_at -- gaming the SLA -- or move
--      requester_customer_id to another customer and read their portal. The two
--      transitions a customer genuinely needs (a reply bumps the status, and
--      reopen) move into SECURITY DEFINER functions that write exactly those
--      columns and nothing else. tickets_insert had the same customer branch
--      (a ticket born 'resolved' against any agent, then rated), and
--      ticket_messages_update let a customer move a message onto another
--      customer's ticket; both lose their customer branch too.
--
--   2. customers_update admitted `portal_user_id = auth.uid()` with no column
--      limit, so a customer could rewrite their own email -- which redirects
--      every guest request sent to that address into their own portal -- or
--      their own tenant_id. The portal writes profiles through the admin client
--      already, so the branch has no legitimate caller left.
--
--   3. attachments admitted a customer who owns the ticket, without asking
--      whether the file hangs off an internal note. The matching policies were
--      tightened by 20260926090500; these are the storage.objects half (read
--      decided by the attachments row; update and delete staff only, in the
--      caller's tenant folder), plus the bucket limits the application has
--      always believed it had.
--
--   4. portal_create_request filed a guest request against a customer row that
--      somebody had already signed in to, so an address could be used to post
--      tickets into another person's portal history.
--
-- Two narrower things ride along because they are the same class of problem:
-- portal_link_user now requires a confirmed email before it will claim a
-- customer record, and staged uploads are swept.

begin;

------------------------------------------------------------
-- 1. tickets_update: staff only
------------------------------------------------------------
--
-- A customer never writes a ticket row directly again. The two writes they did
-- need are the two functions immediately below, both of which take a ticket id
-- and re-derive everything else about the row inside the function.

drop policy if exists "tickets_update" on public.tickets;

create policy "tickets_update"
on public.tickets
for update
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager',
        'agent'
    )
)
with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager',
        'agent'
    )
);

------------------------------------------------------------
-- 1a. tickets_insert and ticket_messages_update: no customer branch
------------------------------------------------------------
--
-- tickets_insert had the same customer branch, testing only
-- requester_customer_id. A customer could POST a ticket with any status,
-- priority, assignee_user_id, sla_policy_id or first_response_at -- for example
-- born 'resolved' against an agent of their choosing, which the resolution
-- trigger stamps and which then earns a CSAT slot they can score, again and
-- again, with no agent involved. Customers raise requests through
-- portal_create_request (service role), which sets those columns itself, so the
-- branch has no legitimate caller.

drop policy if exists "tickets_insert" on public.tickets;

create policy "tickets_insert"
on public.tickets
for insert
to authenticated
with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager',
        'agent'
    )
);

-- ticket_messages_update let a customer update their own public message, and
-- its WITH CHECK never tied ticket_id to a ticket the customer owns -- so a
-- customer who knew another customer's ticket id could move a message onto it.
-- The portal never edits a message once posted. Staff branches are unchanged.

drop policy if exists "ticket_messages_update" on public.ticket_messages;

create policy "ticket_messages_update"
on public.ticket_messages
for update
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and (
        public.current_tenant_role() in ('tenant_admin', 'manager')
        or (
            public.current_tenant_role() = 'agent'
            and author_type = 'agent'
            and author_id = auth.uid()
        )
    )
)
with check (
    tenant_id = public.current_tenant_id()
    and (
        public.current_tenant_role() in ('tenant_admin', 'manager')
        or (
            public.current_tenant_role() = 'agent'
            and author_type = 'agent'
            and author_id = auth.uid()
        )
    )
);

------------------------------------------------------------
-- 1b. The two transitions a customer is allowed to cause
------------------------------------------------------------
--
-- SECURITY DEFINER, and granted to `service_role` only -- the same trust shape
-- as portal_link_user above, and for the same reason. These are called from
-- server actions through the admin client, which runs with service_role and so
-- has no auth.uid() to read; the acting user arrives as an argument and is
-- checked against the customer row here. Reading auth.uid() instead would have
-- matched no rows under the admin client and looked like a permissions bug.
--
-- Each writes the columns its transition needs and nothing else, which is the
-- whole point: the customer branch of tickets_update could restrict rows but not
-- columns. Each returns the row count, because an UPDATE that matched nothing
-- reports no error and the caller needs to tell "already in that state" from
-- "not your ticket".

-- A reply puts the ball back in the team's court. Restricted to the statuses
-- that mean the team was waiting on the customer. resolved_at and closed_at are
-- deliberately not touched here: sync_ticket_resolution_stamps already clears
-- both when a ticket leaves a terminal state, and a re-resolution needs a fresh
-- stamp for CSAT to be keyed on.
create or replace function public.portal_reply_bumps_status(
    p_ticket   uuid,
    p_user_id  uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    update public.tickets t
    set status = 'open'
    where t.id = p_ticket
      -- The two statuses that mean the team was waiting on them. Not
      -- resolved/closed: reopening a resolved request is a separate, explicit
      -- action (portal_reopen_ticket), and a customer who replies on a resolved
      -- request without asking for it reopened should not silently undo the
      -- team's closure -- or lose the CSAT prompt it just earned them.
      and t.status in ('pending', 'on_hold')
      and exists (
          select 1
          from public.customers c
          where c.id = t.requester_customer_id
            and c.portal_user_id = p_user_id
            and c.tenant_id = t.tenant_id
      );

    -- plpgsql rather than sql: a sql function's result is its last statement,
    -- and a bare UPDATE returns no rows, so `returns integer` failed to create
    -- and took this whole migration down with it.
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

comment on function public.portal_reply_bumps_status(uuid, uuid) is
'Put a customer''s own ticket back to open after they reply. Writes status and nothing else. service_role only -- p_user_id is the acting user, resolved from the session by the calling server action.';

-- Reopen, from a state the customer is waiting on. The three columns cleared are
-- the ones that define the resolution, and clearing resolved_at is what makes
-- the next resolve a new CSAT slot rather than a second rating for the same one.
create or replace function public.portal_reopen_ticket(
    p_ticket   uuid,
    p_user_id  uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rows integer;
begin
    update public.tickets t
    set status      = 'open',
        resolved_at = null,
        closed_at   = null
    where t.id = p_ticket
      and t.status in ('resolved', 'closed')
      and exists (
          select 1
          from public.customers c
          where c.id = t.requester_customer_id
            and c.portal_user_id = p_user_id
            and c.tenant_id = t.tenant_id
      );

    get diagnostics v_rows = row_count;

    return v_rows;
end;
$$;

comment on function public.portal_reopen_ticket(uuid, uuid) is
'Reopen a customer''s own resolved or closed request. Writes status, resolved_at and closed_at and nothing else. service_role only -- p_user_id is the acting user, resolved from the session by the calling server action.';

revoke execute on function public.portal_reply_bumps_status(uuid, uuid)
    from public, anon, authenticated;

grant execute on function public.portal_reply_bumps_status(uuid, uuid)
    to service_role;

revoke execute on function public.portal_reopen_ticket(uuid, uuid)
    from public, anon, authenticated;

grant execute on function public.portal_reopen_ticket(uuid, uuid)
    to service_role;

------------------------------------------------------------
-- 2. customers_update: staff only
------------------------------------------------------------
--
-- The customer branch is gone rather than narrowed to a column list, because a
-- column list here would be a second copy of the rules the admin client already
-- follows: the portal writes a customer's name and company through
-- updatePortalProfile, and everything else about their row is written by
-- portal_link_user or by an agent. Nothing needs a customer to update their own
-- row through RLS.

drop policy if exists "customers_update" on public.customers;

create policy "customers_update"
on public.customers
for update
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager'
    )
)
with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager'
    )
);

------------------------------------------------------------
-- 3. storage: internal notes, bucket limits, MIME types
------------------------------------------------------------
--
-- A customer may read a stored file only when they may read the attachments row
-- that points at it: their own ticket, and a public message or the opening post.
-- Deciding that from the path (an earlier draft treated segment three as the
-- message id) only holds while every path has that shape -- portal paths are
-- `<tenant>/<ticket>/<file>` and have no third segment -- so the select branch
-- joins public.attachments on storage_path instead, and the row's own policy
-- (20260926090500) does the rest.
--
-- Update and delete are staff only, with the staff rights they had before
-- (20260810053816). The previous draft of this file recreated them as "any
-- active member, any folder", which -- since customers are members now -- let a
-- customer delete or overwrite any tenant's files, or move one into their own
-- folder and read it. The portal never writes storage with a customer session:
-- uploads go through signed upload URLs and moves/removals through the admin
-- client.
--
-- Which needs one helper first. The path segment being compared to tickets.id is
-- a uuid for a filed ticket's files and the literal string 'staging' for files
-- uploaded before the request exists. A bare `::uuid` on that segment raises
-- rather than returning null, so evaluating a customer policy against a staged
-- object -- which a listing of the bucket does -- turned into an error for the
-- whole statement rather than a row the customer was not entitled to.

create or replace function public.uuid_or_null(p_text text)
returns uuid
language sql
immutable
parallel safe
set search_path = public
as $$
    select case
        when p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then p_text::uuid
        else null
    end;
$$;

comment on function public.uuid_or_null(text) is
'Casts text to uuid, returning null instead of raising when the text is not a uuid. For path segments compared against an id inside a policy.';

revoke execute on function public.uuid_or_null(text) from public, anon;
grant execute on function public.uuid_or_null(text) to authenticated, service_role;

drop policy if exists "ticket_attachments_select" on storage.objects;

create policy "ticket_attachments_select"
on storage.objects
for select
to authenticated
using (
    bucket_id = 'ticket-attachments'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
    and (
        (
            public.is_active_membership()
            and public.current_tenant_role() in (
                'tenant_admin',
                'manager',
                'agent'
            )
        )
        or
        (
            public.current_tenant_role() = 'customer'
            and exists (
                select 1
                from public.attachments a
                join public.tickets t
                    on t.id = a.ticket_id
                join public.customers c
                    on c.id = t.requester_customer_id
                where a.storage_path = storage.objects.name
                  and a.tenant_id = public.current_tenant_id()
                  and t.tenant_id = public.current_tenant_id()
                  and c.portal_user_id = auth.uid()
                  and (
                      a.message_id is null
                      or exists (
                          select 1
                          from public.ticket_messages m
                          where m.id = a.message_id
                            and m.ticket_id = a.ticket_id
                            and m.visibility = 'public'
                      )
                  )
            )
        )
    )
);

drop policy if exists "ticket_attachments_insert" on storage.objects;

create policy "ticket_attachments_insert"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'ticket-attachments'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
    and (
        (
            public.is_active_membership()
            and public.current_tenant_role() in (
                'tenant_admin',
                'manager',
                'agent'
            )
        )
        or
        (
            -- Into a ticket the customer owns. Segment two is a ticket id,
            -- except under the staging prefix where it is the literal
            -- 'staging'; public.uuid_or_null returns null for that rather than
            -- raising, so a staged path is refused instead of erroring.
            public.current_tenant_role() = 'customer'
            and exists (
                select 1
                from public.tickets t
                join public.customers c
                    on c.id = t.requester_customer_id
                where t.id = public.uuid_or_null((storage.foldername(name))[2])
                  and t.tenant_id = public.current_tenant_id()
                  and c.portal_user_id = auth.uid()
            )
        )
    )
);

drop policy if exists "ticket_attachments_update" on storage.objects;

create policy "ticket_attachments_update"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'ticket-attachments'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
    and public.is_active_membership()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager',
        'agent'
    )
)
with check (
    bucket_id = 'ticket-attachments'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
    and public.is_active_membership()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager',
        'agent'
    )
);

drop policy if exists "ticket_attachments_delete" on storage.objects;

create policy "ticket_attachments_delete"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'ticket-attachments'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
    and public.is_active_membership()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager'
    )
);

-- The application has always enforced 20 MB per attachment (MAX_ATTACHMENT_BYTES
-- in src/features/portal/portal.ts) and always said so in the attachment
-- picker. The bucket said 50 MB, so the real limit was the larger of the two and
-- the copy was wrong. Align the bucket with the rule rather than the rule with
-- the bucket: 20 MB is the number the product decided on.
update storage.buckets
set file_size_limit = 20971520
where id = 'ticket-attachments';

-- The avatars bucket is public and served from the project's own origin, so a
-- stored SVG or HTML file at a `.png` path is reachable by anyone who guesses
-- the URL and renders with whatever content type it was uploaded under. Restrict
-- the bucket to the four types the application accepts (AVATAR_MIME_TYPES in
-- src/features/portal/portal.ts) so a customer cannot claim image/png in the
-- prepare call and upload something else.
update storage.buckets
set allowed_mime_types = '{image/png,image/jpeg,image/gif,image/webp}'
where id = 'avatars';

------------------------------------------------------------
-- 3b. Staged uploads are swept
------------------------------------------------------------
--
-- Files uploaded for a request that does not exist yet are parked under
-- `<tenant>/staging/<batch>/`, and nothing reads from that prefix until
-- attachStagedUploads moves them onto a ticket. An abandoned draft leaves them
-- there forever, and the request form is open to guests, so that is free
-- storage for whoever finds the form first. A daily sweep of anything older than
-- a day bounds it: a guest who abandons a draft comes back the next morning and
-- re-uploads, which costs them one click.
--
-- An Edge Function rather than SQL, because `delete from storage.objects` removes
-- the metadata row and leaves the file itself sitting in the bucket's backend --
-- invisible to everybody, still counted against the project's quota, and not
-- reachable by any of the API calls a later sweep could make. Only the Storage
-- API deletes both. See supabase/functions/portal-storage-sweep/index.ts.
--
-- Required Vault secret, alongside service_role_key which the queue already needs:
--
--   select vault.create_secret(
--       'https://<project-ref>.supabase.co/functions/v1/portal-storage-sweep',
--       'portal_storage_sweep_url'
--   );

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
    if exists (
        select 1
        from cron.job
        where jobname = 'portal-staging-upload-sweep'
    ) then
        perform cron.unschedule('portal-staging-upload-sweep');
    end if;
end
$$;

select cron.schedule(
    'portal-staging-upload-sweep',
    '17 4 * * *',
    $$
    do $sweep$
    declare
        v_url text;
        v_key text;
    begin
        select decrypted_secret into v_url
        from vault.decrypted_secrets
        where name = 'portal_storage_sweep_url';

        select decrypted_secret into v_key
        from vault.decrypted_secrets
        where name = 'service_role_key';

        -- Raising rather than proceeding quietly: a null URL makes net.http_post
        -- raise anyway, and a null key makes it a 401 that looks like a
        -- permissions problem in the function. Both are clearer here.
        if v_url is null or v_url = '' then
            raise exception 'portal-storage-sweep cron: Vault secret "portal_storage_sweep_url" is missing';
        end if;

        if v_key is null or v_key = '' then
            raise exception 'portal-storage-sweep cron: Vault secret "service_role_key" is missing';
        end if;

        perform net.http_post(
            url := v_url,
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_key
            ),
            body := '{}'::jsonb
        );
    end
    $sweep$;
    $$
);

------------------------------------------------------------
-- 4. portal_create_request: a guest may not file against a signed-in customer
------------------------------------------------------------
--
-- p_user_id is null for a guest. Without this, anybody who knows a customer's
-- address can raise requests into that customer's portal history -- agents then
-- reply into it, and the customer sees requests they never made. An unclaimed
-- row (portal_user_id null) is still fair game: that is the guest request that
-- creates the account, and the flow depends on it.

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

    ------------------------------------------------------------
    -- Customer
    ------------------------------------------------------------

    select * into v_customer
    from public.customers
    where tenant_id = v_tenant.id
      and email = v_email;

    if not found then
        insert into public.customers (tenant_id, email, full_name, portal_user_id)
        values (v_tenant.id, v_email, v_full_name, p_user_id)
        returning * into v_customer;

    elsif p_user_id is null and v_customer.portal_user_id is not null then
        -- A guest filing against an address that already has a portal sign-in.
        -- Refused, because otherwise an address alone is enough to post tickets
        -- into somebody else's portal, and agents reply into it. The customer
        -- signs in and raises it themselves; portal_create_request takes the
        -- same path for them a moment later.
        raise exception 'portal_create_request: sign in to raise a request for %', v_email
            using errcode = '42501';

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

    ------------------------------------------------------------
    -- Ticket
    --
    -- number is filled by the tickets_set_number trigger.
    -- The tenant's default active policy is attached when it has one, so the
    -- portal's "first reply within N hours" promise is measured.
    ------------------------------------------------------------

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
'Create a ticket from the customer portal, creating the customer row when the email is new. A guest may not file against an address that already has a portal sign-in. service_role only -- the calling server action rate-limits by IP.';

revoke execute on function public.portal_create_request(text, text, text, text, text, uuid, public.ticket_priority)
    from public, anon, authenticated;

grant execute on function public.portal_create_request(text, text, text, text, text, uuid, public.ticket_priority)
    to service_role;

------------------------------------------------------------
-- 5. portal_link_user: a confirmed address only
------------------------------------------------------------
--
-- The function trusts auth.users.email and matches it against customers.email.
-- Any path that can create an auth user with an address but an unconfirmed
-- email -- a password sign-up with confirmations off, say -- would let that
-- user claim the customer record and the ticket history behind it. Supabase
-- marks the address confirmed as soon as it is verified, which both portal
-- sign-in paths have just done by the time this runs, so requiring it costs
-- nothing and closes the class.

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
    where u.id = p_user_id
      and u.email_confirmed_at is not null;

    if not found then
        raise exception 'portal_link_user: no confirmed sign-in for that user'
            using errcode = '42501';
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
'Turn a verified auth user into an active customer of one tenant: mirror public.users, claim or create the customers row, and ensure a membership so custom_access_token_hook can write tenant claims. Refuses an unconfirmed address. service_role only — it trusts its p_user_id argument.';

revoke execute on function public.portal_link_user(uuid, text, text)
    from public, anon, authenticated;

grant execute on function public.portal_link_user(uuid, text, text)
    to service_role;

------------------------------------------------------------
-- 5b. The slug a workspace is reached on
------------------------------------------------------------
--
-- provision_tenant checks uniqueness and nothing else. It is SECURITY DEFINER and
-- takes the slug straight from a form field, so the only thing standing between a
-- workspace name and an address that breaks routing was the client-side
-- SUBDOMAIN_LABEL test -- which a caller does not have to pass.
--
-- Two constraints rather than more IF statements in the function, because they
-- then apply to every writer instead of only this one, and because a constraint
-- is the shape of the rule: the slug IS a DNS label.
--
-- NOT VALID, and that is a decision rather than an oversight. Both are enforced
-- for every new and updated row straight away; what is skipped is re-checking rows
-- that already exist. A workspace created before this rule that squats a reserved
-- label keeps its address -- renaming it changes a live URL and is the owner's
-- call -- and it starts being checked the moment it is renamed. The alternative,
-- validating outright, fails the migration on any such workspace, which is worse
-- than leaving it alone.

alter table public.tenants
    add constraint tenants_slug_is_dns_label
    check (
        slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    ) not valid;

alter table public.tenants
    add constraint tenants_slug_not_reserved
    check (
        slug <> all (array[
            'www',
            'app',
            'api',
            'admin',
            'auth',
            'static',
            'assets',
            'cdn',
            'mail',
            'login',
            'signup',
            'setup',
            'contact-sales',
            'forgot-password',
            'reset-password',
            'tickets',
            'views',
            'customers',
            'reports',
            'settings',
            'account',
            'billing',
            'plans',
            'payment',
            'sla',
            'kb',
            'macros',
            'unauthorized',
            'portal'
        ])
    ) not valid;

comment on constraint tenants_slug_is_dns_label on public.tenants is
'The workspace address is a DNS label, as SUBDOMAIN_LABEL in src/lib/tenancy.ts defines it. NOT VALID: enforced for new and updated rows only, so an existing address is never rewritten by a migration.';

comment on constraint tenants_slug_not_reserved on public.tenants is
'Reserved labels are the app''s own paths (RESERVED_LABELS in src/lib/tenancy.ts). A workspace on one of them shadows a central route -- a tenant called "portal" takes /portal/requests for its own queue and makes its own portal unreachable. NOT VALID for the same reason as tenants_slug_is_dns_label.';

------------------------------------------------------------
-- 6. The access token picks a workspace; it should not pick at random
------------------------------------------------------------
--
-- custom_access_token_hook mints one tenant_id / tenant_role / tenant_slug per
-- token, and every RLS policy in the database reads those three claims. So for
-- anybody in more than one workspace the hook is choosing which tenant they are
-- acting in, and it was choosing "whichever membership row was created first".
--
-- That was harmless while a person was either staff in one workspace or a
-- customer in one workspace. portal_link_user makes both true of the same person
-- in the same session: an agent of one tenant is also a customer of another, and
-- the first membership created is the one that wins, which is not a rule anyone
-- chose or can see.
--
-- The hook cannot read a cookie, so the choice is expressed as data:
-- public.users.preferred_tenant_id, mirrored into auth.users.app_metadata by the
-- trigger below, which is inside the token the hook already receives. Three
-- ordering rules, each for a case that exists today:
--
--   1. active before invited, unchanged -- an invite is not access yet;
--   2. the preferred workspace, when the caller has a membership in it;
--   3. staff before customer, so a member who also has a portal somewhere lands
--      in the workspace where the agent shell works.
--
-- Note what this does not change: the claims still name a tenant the user is
-- genuinely a member of, and RLS still checks the membership behind them. This is
-- about picking the right one, not about granting anything.

alter table public.users
    add column if not exists preferred_tenant_id uuid
        references public.tenants(id)
        on delete set null;

comment on column public.users.preferred_tenant_id is
'The workspace this user should land in. Mirrored into auth.users.app_metadata so custom_access_token_hook can honour it; advisory, and never a grant: RLS still checks the membership behind the claims it selects.';

-- public.users.preferred_tenant_id is the source of truth because it is a column
-- on a table the application already has RLS for, and because it can be read
-- back. app_metadata is the copy, because that is all the hook can see.
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

comment on function public.sync_auth_user_preferred_tenant() is
'Mirrors public.users.preferred_tenant_id into auth.users.app_metadata.preferred_tenant_id, which is the only place custom_access_token_hook can see it.';

drop trigger if exists sync_auth_user_preferred_tenant on public.users;

create trigger sync_auth_user_preferred_tenant
after insert or update of preferred_tenant_id on public.users
for each row
execute function public.sync_auth_user_preferred_tenant();

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

drop trigger if exists guard_users_preferred_tenant on public.users;

create trigger guard_users_preferred_tenant
before insert or update of preferred_tenant_id on public.users
for each row
execute function public.guard_users_preferred_tenant();

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
-- VOLATILE, not STABLE: the body UPDATEs memberships to activate an invite on
-- first sign-in, and a STABLE function cannot write. Must match migration
-- 20260821103013, or the next `supabase db diff` would revert the live hook to
-- STABLE and every sign-in with a membership would error.
volatile
security definer
set search_path = public
as $$
declare
    claims          jsonb;
    app_metadata    jsonb;
    preferred_tenant uuid;
    v_tenant_id     uuid;
    v_tenant_role   text;
    v_tenant_slug   text;
    v_membership_id uuid;
begin
    --------------------------------------------------------
    -- Existing JWT claims
    --------------------------------------------------------

    claims := COALESCE(event -> 'claims', '{}'::jsonb);

    app_metadata := COALESCE(claims -> 'app_metadata', '{}'::jsonb);

    -- Validated before the cast rather than caught after it: this function runs
    -- inside token minting, so anything it raises is a failed sign-in, and
    -- app_metadata is writable by anything that can reach the user record.
    preferred_tenant := case
        when app_metadata ->> 'preferred_tenant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (app_metadata ->> 'preferred_tenant_id')::uuid
        else null
    end;

    --------------------------------------------------------
    -- Pick the caller's membership.
    --
    -- One token carries one tenant_id / tenant_role / tenant_slug, and every RLS
    -- policy in the database reads those three claims, so this ORDER BY is a
    -- permission decision about which workspace the session acts in -- not a
    -- display detail. It was `created_at` alone, i.e. whichever membership row
    -- was inserted first, which nobody chose and nobody can see.
    --
    --   * active before invited: an invite is not access until it is accepted;
    --   * the preferred workspace, if the caller has a membership in it;
    --   * staff before customer: an agent of one workspace who is also a portal
    --     customer of another lands in the one where the agent shell works. The
    --     portal reads through the admin client and is unaffected either way.
    --
    -- Every candidate is still a real, non-disabled membership, so the claims
    -- can only ever name a tenant the user belongs to.
    --------------------------------------------------------

    select
        m.id,
        m.tenant_id,
        m.role::text,
        t.slug
    into
        v_membership_id,
        v_tenant_id,
        v_tenant_role,
        v_tenant_slug
    from public.memberships m
    join public.tenants t
        on t.id = m.tenant_id
    where m.user_id = (event ->> 'user_id')::uuid
      and m.status <> 'disabled'
    order by
        case
            when m.status = 'active' then 0
            else 1
        end,
        case
            when preferred_tenant is not null
                 and m.tenant_id = preferred_tenant then 0
            else 1
        end,
        case
            when m.role <> 'customer' then 0
            else 1
        end,
        -- created_at, then id: two memberships inserted in one transaction share
        -- a timestamp, and without the id the choice would vary between calls.
        m.created_at,
        m.id
    limit 1;

    --------------------------------------------------------
    -- Activate the invite on first sign-in (idempotent).
    --------------------------------------------------------

    if v_membership_id is not null then
        update public.memberships
        set
            status = 'active',
            joined_at = COALESCE(joined_at, now()),
            updated_at = now()
        where id = v_membership_id
          and status = 'invited';
    end if;

    --------------------------------------------------------
    -- Add tenant_id claim
    --------------------------------------------------------

    if v_tenant_id is not null then
        claims := jsonb_set(
            claims,
            '{tenant_id}',
            to_jsonb(v_tenant_id),
            true
        );
    end if;

    --------------------------------------------------------
    -- Add tenant_role claim
    --------------------------------------------------------

    if v_tenant_role is not null then
        claims := jsonb_set(
            claims,
            '{tenant_role}',
            to_jsonb(v_tenant_role),
            true
        );
    end if;

    --------------------------------------------------------
    -- Add tenant_slug claim
    --------------------------------------------------------

    if v_tenant_slug is not null then
        claims := jsonb_set(
            claims,
            '{tenant_slug}',
            to_jsonb(v_tenant_slug),
            true
        );
    end if;

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

comment on function public.custom_access_token_hook(jsonb) is
'Supabase Auth custom access token hook. Picks one workspace for the session and writes tenant_id / tenant_role / tenant_slug, which every RLS policy reads.';

commit;
