-- ==========================================================
-- File: 20260926090500_scope_attachments_to_portal_customers.sql
-- Description: Stop portal customers reading every attachment in the tenant
-- ==========================================================
--
-- Split out of 20260926090000 because, unlike that one, this migration REPLACES
-- existing policies rather than adding new objects -- review the four policies
-- below against what is live before applying, in case they have been changed
-- since the repo last saw them.
--
-- The attachments policies were written as
-- `tenant_id = jwt tenant_id AND is_active_membership()`, from a time when
-- every active member of a tenant was staff. portal_link_user makes customers
-- active members too, so as written those policies let any signed-in customer
-- read the metadata of EVERY attachment in the workspace -- filenames and
-- storage paths from other companies' tickets included.
--
-- The storage.objects policies for the same files already scope customers to
-- their own tickets (see policies/storage/ticket_attachments.sql); these bring
-- the metadata table in line with them. Keep the two in step: a customer who
-- can read a row here must be able to read the object it points at.
--
-- Owning the ticket is necessary but not sufficient. An attachment hangs off
-- `message_id`, and a message can be internal: agents attach screenshots,
-- logs and other customers' data to notes the customer is never meant to see.
-- The metadata policies below therefore require the attachment to sit on a
-- PUBLIC message, or on no message at all -- which is where a request's opening
-- files live, since that post is `tickets.description` rather than a row. The
-- storage.objects policies carry the same extra clause, so the signed URL is
-- refused for the same reason the row is.
--
-- Staff roles are unchanged. The first draft of this migration replaced the
-- UPDATE and DELETE policies with narrower ones, which quietly stopped an agent
-- editing or removing an attachment they had just added, and dropped
-- billing_admin entirely. Everything a member could do before, they can still do.

begin;

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

commit;
