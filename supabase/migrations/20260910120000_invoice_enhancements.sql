-- =====================================================
-- Invoice enhancements
-- =====================================================
-- Each invoice carries enough self-contained billing context to render a
-- complete PDF and to answer "what was charged, when, and what comes next":
--
--  invoice_number        sequential per-tenant number shown on the PDF (INV-001)
--  invoice_type          'recurring' (PayPal subscription charge) or 'one_time'
--                        (one-time upgrade charge)
--  subscription_id       the subscriptions row this invoice belongs to
--  paypal_subscription_id the PayPal billing agreement id for recurring charges
--  currency              ISO currency of the PayPal charge
--  subtotal / tax / amount_paid / balance_due   amount summary (tax is 0% today,
--                        but kept always-present for future changes)
--  payment_method        display name of the provider ("PayPal")
--  paid_at               when the payment settled
--  next_billing_date / next_billing_amount  informational "Upcoming billing"
--                        panel; NEVER part of this invoice's totals
--  billing_email         the payer / billing email shown under Bill To
--  paypal_event_id       webhook event id for idempotency (in addition to the
--                        unique paypal_txn_id)

alter table public.invoices
    add column if not exists invoice_number text,
    add column if not exists invoice_type text
        check (invoice_type in ('recurring', 'one_time')),
    add column if not exists subscription_id uuid
        references public.subscriptions(id) on delete set null,
    add column if not exists paypal_subscription_id text,
    add column if not exists currency text not null default 'USD',
    add column if not exists subtotal numeric(10,2),
    add column if not exists tax numeric(10,2),
    add column if not exists amount_paid numeric(10,2),
    add column if not exists balance_due numeric(10,2),
    add column if not exists payment_method text,
    add column if not exists paid_at timestamptz,
    add column if not exists next_billing_date timestamptz,
    add column if not exists next_billing_amount numeric(10,2),
    add column if not exists billing_email text,
    add column if not exists paypal_event_id text;

comment on column public.invoices.invoice_number is
'Sequential per-tenant invoice number (INV-001, INV-002, ...), assigned by trigger';

comment on column public.invoices.invoice_type is
'Whether the charge is a recurring subscription payment or a one-time upgrade';

comment on column public.invoices.next_billing_date is
'Informational upcoming billing date; excluded from this invoice totals';

comment on column public.invoices.next_billing_amount is
'Informational upcoming recurring amount; excluded from this invoice totals';

-- Sequential per-tenant invoice numbers. Locking on the tenant keeps two
-- concurrent inserts from producing the same number.
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

create unique index if not exists idx_invoices_tenant_number
    on public.invoices(tenant_id, invoice_number)
    where invoice_number is not null;

-- Replayed webhooks stay idempotent even before a transaction exists: a denied
-- event is recorded once. The unique paypal_txn_id covers completed sales; this
-- covers denied/failed attempts that may precede the actual charge.
create unique index if not exists idx_invoices_paypal_event
    on public.invoices(paypal_event_id)
    where paypal_event_id is not null;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Give existing rows a sequential number per tenant and a sensible amount
-- summary so old invoices render identically to new ones.
do $$
declare
    r record;
    v_seq int := 0;
    v_tid uuid := null;
begin
    for r in (
        select id, tenant_id, amount, status, plan_name
        from public.invoices
        order by tenant_id, created_at, id
    ) loop
        if v_tid is distinct from r.tenant_id then
            v_tid := r.tenant_id;
            v_seq := 0;
        end if;

        v_seq := v_seq + 1;

        update public.invoices
        set invoice_number = 'INV-' || lpad(v_seq::text, 3, '0'),
            invoice_type = case
                when r.plan_name ilike '%upgrade%' then 'one_time'
                else 'recurring'
            end,
            currency = 'USD',
            subtotal = coalesce(r.amount, 0),
            tax = 0,
            amount_paid = case
                when r.status in ('paid', 'refunded') then coalesce(r.amount, 0)
                else 0
            end,
            balance_due = case
                when r.status in ('paid', 'refunded') then 0
                else coalesce(r.amount, 0)
            end,
            payment_method = 'PayPal',
            paid_at = case
                when r.status in ('paid', 'refunded') then created_at
                else null
            end
        where id = r.id;
    end loop;
end $$;