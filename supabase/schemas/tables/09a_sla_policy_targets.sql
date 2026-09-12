-- ==========================================================
-- File: 09a_sla_policy_targets.sql
--
-- One row per (policy, priority). Holds the minute targets the design edits
-- as prose in the SLA editor ("15 minutes", "8 business hours").
-- ==========================================================

create table if not exists public.sla_policy_targets
(
    id uuid primary key
        default gen_random_uuid(),

    -- Denormalised for RLS, matching ticket_tags / attachments. Always equal
    -- to the parent policy's tenant_id; the service writes both.
    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    policy_id uuid
        not null
        references public.sla_policies(id)
        on delete cascade,

    priority_scope public.ticket_priority
        not null,

    first_response_mins integer
        not null
        check (first_response_mins > 0),

    resolution_mins integer
        not null
        check (resolution_mins > 0),

    -- Whether the matching prose said "business hours/days". Stored so the
    -- editor can round-trip the string; the clock itself is still wall time
    -- until a calculator honours business_hours.schedule_json.
    first_response_business boolean
        not null
        default false,

    resolution_business boolean
        not null
        default false,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    constraint uq_sla_policy_priority
        unique (policy_id, priority_scope),

    constraint chk_sla_resolution_ge_first_response
        check (resolution_mins >= first_response_mins)
);

comment on table public.sla_policy_targets is
'Per-priority first-response and resolution targets for an sla_policies row.';

------------------------------------------------------------
-- Indexes
------------------------------------------------------------

create index if not exists idx_sla_policy_targets_policy
on public.sla_policy_targets(policy_id);

create index if not exists idx_sla_policy_targets_tenant
on public.sla_policy_targets(tenant_id);

create index if not exists idx_sla_policy_targets_priority
on public.sla_policy_targets(tenant_id, priority_scope);
