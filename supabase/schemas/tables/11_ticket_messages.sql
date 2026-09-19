-- ==========================================================
-- File: 11_ticket_messages.sql
-- Description: Ticket Conversations
-- ==========================================================

create table if not exists public.ticket_messages
(
    id uuid
        primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    ticket_id uuid
        not null
        references public.tickets(id)
        on delete cascade,

    author_type author_type
        not null,

    author_id uuid
        not null,

    body text
        not null,

    visibility message_visibility
        not null
        default 'public',

    is_edited boolean
        not null
        default false,

    edited_at timestamptz,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    constraint chk_message_body
        check(length(trim(body)) > 0)
);

comment on table public.ticket_messages is
'Conversation messages for a ticket';

comment on column public.ticket_messages.author_type is
'agent | customer | system';

comment on column public.ticket_messages.visibility is
'public or internal';

------------------------------------------------------------
-- Indexes
------------------------------------------------------------

create index if not exists idx_ticket_messages_ticket
on public.ticket_messages(ticket_id);

create index if not exists idx_ticket_messages_tenant
on public.ticket_messages(tenant_id);

create index if not exists idx_ticket_messages_author
on public.ticket_messages(author_id);

create index if not exists idx_ticket_messages_created
on public.ticket_messages(created_at desc);

create index if not exists idx_ticket_messages_visibility
on public.ticket_messages(visibility);

------------------------------------------------------------
-- Full Text Search
------------------------------------------------------------

create index if not exists idx_ticket_messages_search
on public.ticket_messages
using gin
(
    to_tsvector(
        'english',
        coalesce(body,'')
    )
);

