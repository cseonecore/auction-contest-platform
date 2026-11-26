-- Target: Supabase SQL Editor (project qqbuauryvhgssmmxiiuh)
-- Incremental deploy: team size is now 2–3 members and only captain phone numbers are stored.
-- Apply after migration 035. Safe to re-run.

-- ═══════════════════════════════════════════════════════════════════
-- 036 · Team size 2–3 and captain-only phone numbers
-- ═══════════════════════════════════════════════════════════════════
-- Registration and admin/registration now cap a team at 3 members
-- (captain + two teammates) and collect a phone number for the captain only.
--
-- This script applies the same rules to teams that registered earlier:
--   * teams with more than 3 members keep the captain plus the two earliest
--     teammates; removed members are recorded in public.audit_log;
--   * phone numbers stored on non-captain members are cleared.
--
-- Triggers then prevent a 4th member and prevent storing a teammate phone.
-- ═══════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_team       record;
  v_keep_ids   uuid[];
  v_remove_ids uuid[];
  v_removed    jsonb;
begin
  for v_team in
    select t.id, t.name, t.captain_id
    from public.teams t
    where (select count(*) from public.members m where m.team_id = t.id) > 3
  loop
    select array_agg(id order by rn)
    into v_keep_ids
    from (
      select
        m.id,
        row_number() over (
          order by (m.id = v_team.captain_id) desc, m.created_at asc, m.id asc
        ) as rn
      from public.members m
      where m.team_id = v_team.id
      order by (m.id = v_team.captain_id) desc, m.created_at asc, m.id asc
      limit 3
    ) keepers;

    select
      array_agg(id),
      jsonb_agg(
        jsonb_build_object('id', id, 'name', name, 'email', email)
        order by created_at asc, id asc
      )
    into v_remove_ids, v_removed
    from public.members
    where team_id = v_team.id
      and not (id = any(v_keep_ids));

    if v_remove_ids is not null and array_length(v_remove_ids, 1) > 0 then
      insert into public.audit_log (
        actor_id,
        action,
        entity_type,
        entity_id,
        details,
        created_at
      ) values (
        null,
        'team_members_trimmed',
        'team',
        v_team.id,
        jsonb_build_object(
          'team_name', v_team.name,
          'reason', 'team size limit reduced to 3 members',
          'kept_member_ids', to_jsonb(v_keep_ids),
          'removed_members', v_removed,
          'trimmed_at', now()
        ),
        now()
      );

      delete from public.members where id = any(v_remove_ids);
    end if;
  end loop;
end $$;

update public.members m
set phone = null
from public.teams t
where m.team_id = t.id
  and t.captain_id is not null
  and m.id <> t.captain_id
  and m.phone is not null;

update public.members m
set phone = null
where m.phone is not null
  and exists (
    select 1
    from public.teams t
    where t.id = m.team_id
      and t.captain_id is null
  )
  and m.id <> (
    select m2.id
    from public.members m2
    where m2.team_id = m.team_id
    order by m2.created_at asc, m2.id asc
    limit 1
  );

create or replace function public.enforce_team_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(NEW.team_id::text)::bigint);

  select count(*)
  into v_count
  from public.members
  where team_id = NEW.team_id;

  if v_count >= 3 then
    raise exception 'A team can have at most 3 members (the captain plus up to two teammates).';
  end if;

  return NEW;
end;
$$;

drop trigger if exists enforce_team_member_limit on public.members;
create trigger enforce_team_member_limit
before insert on public.members
for each row
execute function public.enforce_team_member_limit();

create or replace function public.enforce_captain_only_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_captain_id uuid;
begin
  if NEW.phone is not null then
    select captain_id
    into v_captain_id
    from public.teams
    where id = NEW.team_id;

    if v_captain_id is not null and NEW.id <> v_captain_id then
      NEW.phone := null;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists enforce_captain_only_phone on public.members;
create trigger enforce_captain_only_phone
before insert or update of phone, team_id on public.members
for each row
execute function public.enforce_captain_only_phone();

commit;
