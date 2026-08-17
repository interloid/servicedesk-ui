-- =====================================================
-- Add public.customers.company
--
-- The queue, the ticket detail header and the customer record all render the requester as
-- two lines — name over company ("Aisha Noor" / "Halcyon Bank") — but no column carried the
-- second line. Reported in docs/QUEUE-DIFF.md §Schema gaps during the UI-only queue pass;
-- this closes it so the queue can be wired to real rows.
--
-- Nullable on purpose: existing customers have no value, and a customer who is an individual
-- legitimately has none. Every call site already omits the caption when it is null.
--
-- Free text rather than an FK to an `organisations` table — see the note in
-- supabase/schemas/tables/06_customers.sql for when to promote it.
-- =====================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS company text;

COMMENT ON COLUMN public.customers.company IS
'Organisation the customer belongs to. Display-only caption; not an FK.';

-- The CSV importer resolves a requester by (tenant_id, email) and back-fills the company on
-- the row it finds, so lookups by email stay the hot path and need no new index. Company is
-- never a search key on its own.
