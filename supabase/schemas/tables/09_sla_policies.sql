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

    description text
        not null
        default ''
        constraint chk_sla_description_length
            check (char_length(description) <= 500),

    status public.sla_policy_status
        not null
        default 'active',

    -- Customer scope. 'Selected customers' limits the policy to the rows in
    -- sla_policy_customers. The last two values are legacy segment labels,
    -- still allowed so old rows stay valid; the editor shows them as 'All
    -- customers'. Not `ticket_priority` — that lives on each target row.
    applies_to text
        not null
        default 'All customers'
        constraint sla_policies_applies_to_check
        check (
            applies_to in (
                'All customers',
                'Selected customers',
                'Business & Enterprise customers',
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

    -- Minutes before a target that the assignee is warned. Up to a day.
    notify_before_mins integer
        not null
        default 15
        constraint chk_sla_notify_before_mins
            check (notify_before_mins between 1 and 1440),

    escalate_on_breach boolean
        not null
        default false,

    escalate_to_role text
        not null
        default 'manager'
        constraint chk_sla_escalate_to_role
            check (escalate_to_role in ('manager', 'tenant_admin')),

    -- Last person to save the policy, for "Updated … by …" in the list.
    updated_by uuid
        references public.users(id)
        on delete set null,

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
