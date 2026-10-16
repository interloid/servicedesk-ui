-- =====================================================
-- Notifications
-- =====================================================

create table if not exists public.notifications
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    user_id uuid
        not null
        references public.users(id)
        on delete cascade,

    type notification_type
        not null,

    payload_json jsonb
        not null
        default '{}'::jsonb,

    read_at timestamptz,

    created_at timestamptz
        not null
        default now()
);

create index idx_notification_user
on notifications(user_id);

create index idx_notification_tenant
on notifications(tenant_id);

create index idx_notification_read
on notifications(read_at);

create index idx_notification_created
on notifications(created_at desc);

-- Realtime (20260903090000_enable_realtime.sql): full rows on UPDATE/DELETE
-- so realtime can apply RLS, and the table on the supabase_realtime publication.
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = 'notifications'
       )
    THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
END
$$;
