-- Enable Postgres realtime for the tables used by the service desk UI.
-- Supabase realtime streams row changes for tables attached to the
-- `supabase_realtime` publication. We use REPLICA IDENTITY FULL so that
-- updates carry the full row, which is required for realtime RLS filtering
-- on tenant_id / user_id and for the client to react to SLA/notification
-- status changes.

alter table public.notifications replica identity full;
alter table public.sla_events replica identity full;
alter table public.tickets replica identity full;
alter table public.ticket_messages replica identity full;

-- Scope the notifications SELECT policy to the recipient so realtime only
-- delivers a notification to the user it was created for (notifications carry
-- ticket subjects / message previews that other agents should not receive).
drop policy if exists "Members can view tenant Notifications" on public.notifications;
create policy "Members can view own Notifications" on public.notifications
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid
    and public.is_active_membership()
  );


-- Attach the tables to the realtime publication. Supabase automatically
-- subscribes clients to this publication for any table included here.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sla_events'
  ) then
    alter publication supabase_realtime add table public.sla_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tickets'
  ) then
    alter publication supabase_realtime add table public.tickets;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ticket_messages'
  ) then
    alter publication supabase_realtime add table public.ticket_messages;
  end if;
end $$;
