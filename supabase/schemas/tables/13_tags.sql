create table if not exists public.tags (
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    name text
        not null,

    color text,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    constraint uq_tag_name
        unique (tenant_id, name)
);