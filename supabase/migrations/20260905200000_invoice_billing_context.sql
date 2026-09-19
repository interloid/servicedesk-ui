-- Add per-invoice billing context so the billing history table can show
-- the plan name and seat count that were actually billed at the time,
-- instead of always reflecting the tenant's current plan.

alter table public.invoices
    add column if not exists plan_name text;

alter table public.invoices
    add column if not exists seats integer;