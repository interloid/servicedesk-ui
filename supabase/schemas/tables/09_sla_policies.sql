-- ==========================================================
-- File: 09_sla_policies.sql
--
-- A policy is a named container (status, applies-to, business hours, breach
-- switches). Per-priority minute targets live in `sla_policy_targets` — one
-- designed policy is FOUR target rows, not four policy rows.
-- ==========================================================

create table if not exists public.sla_policies
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    name text
        not null,

    status public.sla_policy_status
        not null
        default 'active',

    -- Customer-segment scope as the design's select labels it. Not
    -- `ticket_priority` — that lives on each target row.
    applies_to text
        not null
        default 'All customers'
        check (
            applies_to in (
                'Business & Enterprise customers',
                'All customers',
                'Urgent tickets only'
            )
        ),

    business_hours_id uuid
        references public.business_hours(id),

    is_default boolean
        not null
        default false,

    notify_before_breach boolean
        not null
        default true,

    escalate_on_breach boolean
        not null
        default false,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now()
);

comment on table public.sla_policies is
'Named SLA policy containers. Targets by priority live in sla_policy_targets.';

------------------------------------------------------------
-- Indexes
------------------------------------------------------------

create index if not exists idx_sla_policies_tenant
on public.sla_policies(tenant_id);

create index if not exists idx_sla_policies_tenant_default
on public.sla_policies(tenant_id)
where is_default;
