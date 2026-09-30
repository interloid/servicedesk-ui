-- ==========================================================
-- File: 20260908093100_scope_attachments_to_portal_customers.sql
-- Description: Stop portal customers reading every attachment in the tenant
-- ==========================================================
--
-- REQUIRED BEFORE THE FIRST CUSTOMER SIGNS IN. Split out of
-- 20260908093000 because, unlike that one, this migration REPLACES existing
-- policies rather than adding new objects -- review the four policies below
-- against what is live before applying, in case they have been changed since
-- the repo last saw them.
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

begin;

------------------------------------------------------------
-- Attachment metadata: staff see the tenant, customers see their own tickets
------------------------------------------------------------
--
-- The attachments policies were written when every active member was staff:
-- `tenant_id = jwt tenant_id AND is_active_membership()`. Portal customers are
-- now active members of the tenant, so as written those policies would let any
-- signed-in customer read the metadata of EVERY attachment in the workspace —
-- filenames and storage paths from other companies' tickets included.
--
-- The storage.objects policies for the same files already scope customers to
-- their own tickets (see policies/storage/ticket_attachments.sql); these bring
-- the metadata table in line with them.

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
                'agent'
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
                'agent'
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
        )
    )
);

-- Editing and removing attachment metadata stays staff-only. A customer who
-- attached the wrong file raises it in the thread; letting them rewrite
-- storage_path on a row an agent is reading is not worth the surface.

drop policy if exists "Members can update tenant Attachments" on public.attachments;

create policy "Members can update tenant Attachments"
on public.attachments
for update
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.is_active_membership()
    and public.current_tenant_role() in ('tenant_admin', 'manager', 'agent')
)
with check (
    tenant_id = public.current_tenant_id()
    and public.is_active_membership()
    and public.current_tenant_role() in ('tenant_admin', 'manager', 'agent')
);

drop policy if exists "Members can delete tenant Attachments" on public.attachments;

create policy "Members can delete tenant Attachments"
on public.attachments
for delete
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.is_active_membership()
    and public.current_tenant_role() in ('tenant_admin', 'manager')
);

commit;
