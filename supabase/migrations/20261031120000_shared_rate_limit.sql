-- RISK-004 (code review 2026-10-30): shared rate-limit counts instead of one
-- Map per server instance. Mirrors supabase/schemas/tables/26_rate_limit_buckets.sql
-- and supabase/schemas/functions/26_rate_limit_hit.sql.

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

-- =====================================================
-- rate_limit_hit
-- Adds p_cost hits to the bucket for p_key and returns its new count and the
-- end of its window. One statement, so two servers counting the same key at
-- the same moment can't both read the old count. An expired window restarts
-- at p_cost.
-- =====================================================

create or replace function public.rate_limit_hit(
    p_key text,
    p_cost integer,
    p_window_ms integer
)
returns table (
    hits integer,
    reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
    -- Expired buckets are dead weight; clear them now and then rather than on
    -- every call.
    if random() < 0.01 then
        delete from public.rate_limit_buckets b where b.reset_at <= now();
    end if;

    return query
    with hit as (
        insert into public.rate_limit_buckets as b (key, count, reset_at)
        values (
            p_key,
            greatest(p_cost, 1),
            now() + make_interval(secs => p_window_ms / 1000.0)
        )
        on conflict (key) do update set
            count = case
                when b.reset_at <= now() then excluded.count
                else b.count + excluded.count
            end,
            reset_at = case
                when b.reset_at <= now() then excluded.reset_at
                else b.reset_at
            end
        returning b.count, b.reset_at
    )
    select hit.count, hit.reset_at from hit;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
