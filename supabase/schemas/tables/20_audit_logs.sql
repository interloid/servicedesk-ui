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

    -- Page section, filled from entity/action by audit_logs_fill().
    module text
        not null
        default 'general'
        constraint chk_audit_module check (
            module in (
                'authentication',
                'security',
                'team',
                'customers',
                'sla',
                'billing',
                'settings',
                'general'
            )
        ),

    result text
        not null
        default 'success'
        constraint chk_audit_result check (result in ('success', 'failure')),

    user_agent text,

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

create index idx_audit_tenant_created
on audit_logs(tenant_id, created_at desc);

create index idx_audit_tenant_module_created
on audit_logs(tenant_id, module, created_at desc);
