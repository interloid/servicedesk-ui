-- =====================================================
-- Audit Logs
-- =====================================================

create table if not exists public.audit_logs
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    actor_id uuid
        references public.users(id)
        on delete set null,

    action audit_action
        not null,

    entity text
        not null,

    entity_id uuid,

    meta_json jsonb
        default '{}'::jsonb,

    ip inet,

    created_at timestamptz
        not null
        default now()
);

create index idx_audit_tenant
on audit_logs(tenant_id);

create index idx_audit_actor
on audit_logs(actor_id);

create index idx_audit_entity
on audit_logs(entity,entity_id);

create index idx_audit_created
on audit_logs(created_at desc);

create index idx_audit_action
on audit_logs(action);