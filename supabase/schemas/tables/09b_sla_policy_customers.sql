-- ==========================================================
-- File: 09b_sla_policy_customers.sql
--
-- The customers a policy is limited to when its applies_to is
-- 'Selected customers'. Empty for 'All customers' policies.
-- ==========================================================

create table if not exists public.sla_policy_customers
(
    -- Denormalised for RLS, like sla_policy_targets. Always equal to the
    -- policy's and the customer's tenant_id; RLS checks both.
    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    policy_id uuid
        not null
        references public.sla_policies(id)
        on delete cascade,

    customer_id uuid
        not null
        references public.customers(id)
        on delete cascade,

    created_at timestamptz
        not null
        default now(),

    primary key (policy_id, customer_id)
);

comment on table public.sla_policy_customers is
'Customers an SLA policy is limited to when applies_to = ''Selected customers''.';

------------------------------------------------------------
-- Indexes
------------------------------------------------------------

create index if not exists idx_sla_policy_customers_tenant
on public.sla_policy_customers(tenant_id);

create index if not exists idx_sla_policy_customers_customer
on public.sla_policy_customers(customer_id);
