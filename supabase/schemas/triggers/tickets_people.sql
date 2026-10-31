-- ==========================================================
-- File: tickets_people.sql
-- Description: Stamp created_by / opened_by from auth.uid()
-- ==========================================================

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
