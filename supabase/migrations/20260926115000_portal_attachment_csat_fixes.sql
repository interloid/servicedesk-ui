-- ==========================================================
-- File: 20260926115000_portal_attachment_csat_fixes.sql
-- Description: Review fixes to the portal migrations that are already live
-- ==========================================================
--
-- 20260908093000 .. 20260908231500 are applied on the hosted project, so they
-- are left exactly as they ran. Everything the 2026-10-01 and 2026-10-02
-- reviews changed in them lives here instead:
--
--   1. attachments: a customer only sees and attaches files on PUBLIC messages
--      (or the opening post), only as themselves; edit/delete stays staff, with
--      the four staff roles that had it before customers held memberships
--      (20260908093100 had dropped billing_admin, and agent from delete).
--   2. csat_ratings: agent_user_id comes from the ticket, and only the comment
--      may change after a rating is recorded (csat_ratings_guard).
--
-- Every statement is replace-or-drop-first, so the file is safe to re-run.

begin;

-- ----------------------------------------------------------
-- 1. Attachments metadata policies
-- ----------------------------------------------------------

------------------------------------------------------------
-- Attachment metadata: staff see the tenant, customers see their own tickets'
------------------------------------------------------------

drop policy if exists "Members can view tenant Attachments" on public.attachments;

create policy "Members can view tenant Attachments"
on public.attachments
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and (
        (
            public.is_active_membership()
            and public.current_tenant_role() in (
                'tenant_admin',
                'manager',
                'agent',
                'billing_admin'
            )
        )

        or

        (
            public.current_tenant_role() = 'customer'
            and exists (
                select 1
                from public.tickets t
                join public.customers c
                    on c.id = t.requester_customer_id
                where t.id = public.attachments.ticket_id
                  and t.tenant_id = public.current_tenant_id()
                  and c.portal_user_id = auth.uid()
            )
            -- Public messages only. `message_id is null` is the request's own
            -- opening post, which has no ticket_messages row of its own.
            and (
                public.attachments.message_id is null
                or exists (
                    select 1
                    from public.ticket_messages m
                    where m.id = public.attachments.message_id
                      and m.visibility = 'public'
                )
            )
        )
    )
);

drop policy if exists "Members can create tenant Attachments" on public.attachments;

create policy "Members can create tenant Attachments"
on public.attachments
for insert
to authenticated
with check (
    tenant_id = public.current_tenant_id()
    and (
        (
            public.is_active_membership()
            and public.current_tenant_role() in (
                'tenant_admin',
                'manager',
                'agent',
                'billing_admin'
            )
        )

        or

        (
            public.current_tenant_role() = 'customer'
            and exists (
                select 1
                from public.tickets t
                join public.customers c
                    on c.id = t.requester_customer_id
                where t.id = public.attachments.ticket_id
                  and t.tenant_id = public.current_tenant_id()
                  and c.portal_user_id = auth.uid()
            )
            -- Same rule as the select branch above, so a customer cannot attach
            -- to a message they may not read...
            and (
                public.attachments.message_id is null
                or exists (
                    select 1
                    from public.ticket_messages m
                    where m.id = public.attachments.message_id
                      and m.visibility = 'public'
                )
            )
            -- ...nor claim an attachment somebody else uploaded, which is what
            -- an agent's file on their own reply looks like from the outside.
            and public.attachments.uploaded_by = auth.uid()
        )
    )
);

-- Editing and deleting attachment metadata is staff only, with the same four
-- roles that could do it before customers held memberships (every active member
-- then was one of these). Left as "any active member", a customer could PATCH
-- storage_path on an attachment of their own ticket to point at another
-- customer's file -- and the portal signs storage_path with the admin client, so
-- that became a working download link. The portal never edits or deletes these
-- rows with a customer session; a customer who attached the wrong file raises it
-- in the thread.

drop policy if exists "Members can update tenant Attachments" on public.attachments;

create policy "Members can update tenant Attachments"
on public.attachments
for update
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.is_active_membership()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager',
        'agent',
        'billing_admin'
    )
)
with check (
    tenant_id = public.current_tenant_id()
    and public.is_active_membership()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager',
        'agent',
        'billing_admin'
    )
);

drop policy if exists "Members can delete tenant Attachments" on public.attachments;

create policy "Members can delete tenant Attachments"
on public.attachments
for delete
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.is_active_membership()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager',
        'agent',
        'billing_admin'
    )
);

-- ----------------------------------------------------------
-- 2. CSAT rating guard
-- ----------------------------------------------------------

create or replace function public.csat_ratings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        select t.assignee_user_id into new.agent_user_id
        from public.tickets t
        where t.id = new.ticket_id;

    elsif (
        new.ticket_id,
        new.customer_id,
        new.resolved_at,
        new.agent_user_id,
        new.tenant_id,
        new.score
    ) is distinct from (
        old.ticket_id,
        old.customer_id,
        old.resolved_at,
        old.agent_user_id,
        old.tenant_id,
        old.score
    ) then
        raise exception 'only the comment is editable on a rating'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function public.csat_ratings_guard() is
'Fills agent_user_id from the ticket on insert and refuses any update that moves a rating off the score, resolution, customer, handler or tenant it was recorded against.';

drop trigger if exists csat_ratings_guard on public.csat_ratings;

create trigger csat_ratings_guard
before insert or update on public.csat_ratings
for each row
execute function public.csat_ratings_guard();

commit;
