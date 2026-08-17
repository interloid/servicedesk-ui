-- =====================================================
-- Ticket Tags
-- =====================================================

create table if not exists public.ticket_tags
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    ticket_id uuid
        not null
        references public.tickets(id)
        on delete cascade,

    tag_id uuid
        not null
        references public.tags(id)
        on delete cascade,

    created_at timestamptz
        not null
        default now(),

    constraint uq_ticket_tag
        unique(ticket_id, tag_id)
);

----------------------------------------------------
-- Indexes
----------------------------------------------------

create index idx_ticket_tags_ticket
on public.ticket_tags(ticket_id);

create index idx_ticket_tags_tag
on public.ticket_tags(tag_id);

create index idx_ticket_tags_tenant
on public.ticket_tags(tenant_id);