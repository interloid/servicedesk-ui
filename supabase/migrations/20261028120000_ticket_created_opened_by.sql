-- =====================================================
-- Ticket "Created by" and "Opened by"
-- =====================================================
--
-- The ticket page names who raised the ticket and which team member opened
-- it first. Neither was stored: tickets only carried the requester.
--
--   created_by  the staff user who raised it from the queue; null when the
--               customer raised it on the portal (portal_create_request runs
--               as service role, so auth.uid() is null there). Tickets from
--               before this column are null too and read as the customer's.
--   opened_by   the first agent, manager or tenant admin to open the ticket
--   opened_at   when they did
--
-- Both are stamped by tickets_stamp_people from auth.uid(), never from the
-- request body, and are fixed once set.
--
-- Mirrors supabase/schemas/tables/10_tickets.sql and
-- supabase/schemas/triggers/tickets_people.sql.

alter table public.tickets
    add column if not exists created_by uuid
        references public.users(id) on delete set null,
    add column if not exists opened_by uuid
        references public.users(id) on delete set null,
    add column if not exists opened_at timestamptz;

create or replace function public.tickets_stamp_people()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        -- A signed-in staff insert is theirs; a service-role insert (the
        -- portal) keeps whatever it passed, which is nothing today.
        new.created_by := coalesce(auth.uid(), new.created_by);
        new.opened_by := null;
        new.opened_at := null;
        return new;
    end if;

    new.created_by := old.created_by;
    if old.opened_by is not null then
        new.opened_by := old.opened_by;
        new.opened_at := old.opened_at;
    elsif new.opened_by is not null then
        -- Only "me, now": a client can't record someone else as the opener.
        new.opened_by := coalesce(auth.uid(), new.opened_by);
        new.opened_at := now();
    end if;
    return new;
end;
$$;

drop trigger if exists tickets_stamp_people on public.tickets;
create trigger tickets_stamp_people
before insert or update of created_by, opened_by, opened_at on public.tickets
for each row
execute function public.tickets_stamp_people();
