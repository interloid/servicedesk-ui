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

    plan_name text,

    seats integer,

    period_start date
        not null,

    period_end date
        not null,

    -- Self-contained billing context so each invoice renders a complete PDF
    -- and records what was charged, when, and what comes next.
    invoice_number text,

    invoice_type text
        check (invoice_type in ('recurring', 'one_time')),

    subscription_id uuid
        references public.subscriptions(id)
        on delete set null,

    paypal_subscription_id text,

    currency text
        not null
        default 'USD',

    subtotal numeric(10,2),

    tax numeric(10,2),

    amount_paid numeric(10,2),

    balance_due numeric(10,2),

    payment_method text,

    paid_at timestamptz,

    next_billing_date timestamptz,

    next_billing_amount numeric(10,2),

    billing_email text,

    paypal_event_id text,

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

create unique index if not exists idx_invoices_tenant_number
on invoices(tenant_id, invoice_number)
where invoice_number is not null;

-- Replayed webhooks stay idempotent even before a transaction exists: a denied
-- event is recorded once. The unique paypal_txn_id covers completed sales; this
-- covers denied/failed attempts that may precede the actual charge.
create unique index if not exists idx_invoices_paypal_event
on invoices(paypal_event_id)
where paypal_event_id is not null;

-- Sequential per-tenant invoice numbers (INV-001, INV-002, ...). Locking on the
-- tenant keeps concurrent inserts from producing a duplicate number.
create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
as $$
declare
    v_seq int;
begin
    if new.invoice_number is null then
        perform pg_advisory_xact_lock(
            hashtextextended('invoice:' || new.tenant_id::text, 0)
        );
        select coalesce(
            max((regexp_replace(invoice_number, '[^0-9]', '', 'g'))::int),
            0
        ) + 1
        into v_seq
        from public.invoices
        where tenant_id = new.tenant_id
          and invoice_number is not null;

        new.invoice_number := 'INV-' || lpad(v_seq::text, 3, '0');
    end if;

    return new;
end;
$$;

drop trigger if exists trg_invoices_assign_number on public.invoices;

create trigger trg_invoices_assign_number
    before insert on public.invoices
    for each row
    execute function public.assign_invoice_number();