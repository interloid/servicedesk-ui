-- ==========================================================
-- File: 12_attachments.sql
-- Description: Ticket Attachments
-- ==========================================================

create table if not exists public.attachments
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

    message_id uuid
        references public.ticket_messages(id)
        on delete cascade,

    storage_path text
        not null,

    filename text
        not null,

    original_filename text
        not null,

    mime text
        not null,

    extension text,

    size bigint
        not null,

    uploaded_by uuid
        references public.users(id)
        on delete set null,

    checksum text,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    constraint chk_file_size
        check (size >= 0),

    constraint uq_storage_path
        unique(storage_path)
);

comment on table public.attachments is
'Metadata for files stored in Supabase Storage';

comment on column attachments.storage_path is
'Bucket path';

comment on column attachments.checksum is
'SHA256 or MD5 checksum';