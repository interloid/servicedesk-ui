-- =====================================================
-- Invoices
-- =====================================================

create table if not exists public.invoices
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    paypal_txn_id text
        unique,

    amount numeric(10,2)
        not null,

    status invoice_status
        not null,
        
    storage_path text,

    period_start date
        not null,

    period_end date
        not null,

    created_at timestamptz
        default now(),

    updated_at timestamptz
        default now(),

    constraint chk_invoice_amount
        check(amount>=0)
);

create index idx_invoice_tenant
on invoices(tenant_id);

create index idx_invoice_status
on invoices(status);

create index idx_invoice_period
on invoices(period_start,period_end);