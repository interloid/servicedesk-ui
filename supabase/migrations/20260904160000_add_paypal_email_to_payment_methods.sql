alter table public.payment_methods
    add column if not exists paypal_email text;
