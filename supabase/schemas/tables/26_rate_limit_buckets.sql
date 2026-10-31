-- =====================================================
-- Rate Limit Buckets
-- Fixed-window hit counts for the app's public Server Actions (sign-in,
-- password reset, signup, guest tickets). Kept in the database rather than in
-- server memory so every server instance shares one count per key.
--
-- Written only through public.rate_limit_hit() by the service role; RLS is on
-- with no policies, so no browser client can read or reset a bucket.
-- =====================================================

create table if not exists public.rate_limit_buckets
(
    key text primary key,

    count integer
        not null
        default 0,

    reset_at timestamptz
        not null
);

create index if not exists idx_rate_limit_buckets_reset_at
    on public.rate_limit_buckets (reset_at);

alter table public.rate_limit_buckets enable row level security;
