-- Add updated_at to invoices so the paypal-webhook handler can timestamp storage updates.
ALTER TABLE public.invoices
  ADD COLUMN updated_at timestamptz DEFAULT now();
