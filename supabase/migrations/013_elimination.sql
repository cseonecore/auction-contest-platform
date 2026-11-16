-- ============================================================
-- Migration 013: Elimination system
-- ============================================================
-- Participation rules are enforced by the database:
--   * A team that fails a mandatory participation window may be
--     eliminated by the admin (or automatically by a rule sweep).
--   * An eliminated team cannot bid, cannot win a slot and cannot
--     receive an auction bonus.
--   * Elimination is reversible and always recorded with a reason
--     and a timestamp.
--
-- The registration status of a team is never overwritten: this
-- table is a separate, additive record.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Elimination records
-- ─────────────────────────────────────────────────────────────
create table if not exists public.team_eliminations (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  rule          text not null default 'manual'
                  check (rule in ('no_selection', 'no_bid', 'manual', 'other')),
  reason        text not null,
  eliminated_at timestamptz not null default now(),
  eliminated_by uuid,
  restored_at   timestamptz,
  restored_by   uuid,
  restore_note  text
);

comment on table public.team_eliminations is
  'Participation elimination log. A team is eliminated while it has an active '
  '(not restored) record here. Registration status is untouched.';

create index if not exists idx_team_eliminations_team
  on public.team_eliminations (team_id, eliminated_at desc);
create index if not exists idx_team_eliminations_active
  on public.team_eliminations (team_id)
  where restored_at is null;

-- At most one active elimination per team.
create unique index if not exists team_eliminations_active_unique_idx
  on public.team_eliminations (team_id)
  where restored_at is null;

comment on index public.team_eliminations_active_unique_idx is
  'A team can only hold one active elimination record at a time.';


-- ─────────────────────────────────────────────────────────────
-- 2. Read helper
-- ─────────────────────────────────────────────────────────────
create or replace function public.team_is_eliminated(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_eliminations e
    where e.team_id = p_team_id
      and e.restored_at is null
  );
$$;

revoke all on function public.team_is_eliminated(uuid) from public;
grant execute on function public.team_is_eliminated(uuid) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 3. Admin elimination / restoration
-- ─────────────────────────────────────────────────────────────
create or replace function public.eliminate_team(
  p_team_id uuid,
  p_reason  text,
  p_rule    text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
  v_exists    boolean;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to eliminate a team';
  end if;

  if p_team_id is null then
    raise exception 'A team must be supplied';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'An elimination reason is required';
  end if;

  if p_rule not in ('no_selection', 'no_bid', 'manual', 'other') then
    raise exception 'Unknown elimination rule: %', p_rule;
  end if;

  select t.name into v_team_name
  from public.teams t
  where t.id = p_team_id;

  if not found then
    raise exception 'Team not found';
  end if;

  select public.team_is_eliminated(p_team_id) into v_exists;
  if v_exists then
    raise exception 'Team "%" is already eliminated', v_team_name;
  end if;

  insert into public.team_eliminations (team_id, rule, reason, eliminated_by)
  values (p_team_id, p_rule, trim(p_reason), auth.uid());

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), null, 'team_eliminated', 'team', p_team_id,
    jsonb_build_object('rule', p_rule, 'reason', trim(p_reason), 'team_name', v_team_name)
  );

  return jsonb_build_object(
    'success',       true,
    'team_id',       p_team_id,
    'team_name',     v_team_name,
    'rule',          p_rule,
    'reason',        trim(p_reason),
    'eliminated_at', clock_timestamp()
  );
end;
$$;

revoke all on function public.eliminate_team(uuid, text, text) from public;
grant execute on function public.eliminate_team(uuid, text, text) to authenticated, service_role;


create or replace function public.restore_team(
  p_team_id uuid,
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
  v_elim_id   uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to restore a team';
  end if;

  select t.name into v_team_name
  from public.teams t
  where t.id = p_team_id;

  if not found then
    raise exception 'Team not found';
  end if;

  select e.id into v_elim_id
  from public.team_eliminations e
  where e.team_id = p_team_id
    and e.restored_at is null
  order by e.eliminated_at desc
  limit 1;

  if v_elim_id is null then
    raise exception 'Team "%" is not eliminated', v_team_name;
  end if;

  update public.team_eliminations
  set restored_at = clock_timestamp(),
      restored_by = auth.uid(),
      restore_note = nullif(trim(coalesce(p_note, '')), '')
  where id = v_elim_id;

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), null, 'team_restored', 'team', p_team_id,
    jsonb_build_object('note', p_note, 'team_name', v_team_name)
  );

  return jsonb_build_object(
    'success',    true,
    'team_id',    p_team_id,
    'team_name',  v_team_name,
    'restored_at', clock_timestamp()
  );
end;
$$;

revoke all on function public.restore_team(uuid, text) from public;
grant execute on function public.restore_team(uuid, text) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. Elimination history reader
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_elimination_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to read the elimination history';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id',            e.id,
          'team_id',       e.team_id,
          'team_name',     t.name,
          'rule',          e.rule,
          'reason',        e.reason,
          'eliminated_at', e.eliminated_at,
          'eliminated_by', e.eliminated_by,
          'restored_at',   e.restored_at,
          'restored_by',   e.restored_by,
          'restore_note',  e.restore_note,
          'active',        (e.restored_at is null)
        )
        order by e.eliminated_at desc
      )
      from public.team_eliminations e
      join public.teams t on t.id = e.team_id
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_elimination_history() from public;
grant execute on function public.get_elimination_history() to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────
alter table public.team_eliminations enable row level security;

drop policy if exists "Teams view own elimination" on public.team_eliminations;
create policy "Teams view own elimination"
on public.team_eliminations
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

drop policy if exists "Admins manage eliminations" on public.team_eliminations;
create policy "Admins manage eliminations"
on public.team_eliminations
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke insert, update, delete on public.team_eliminations from authenticated;
grant select on public.team_eliminations to authenticated;
grant insert, update, delete on public.team_eliminations to service_role;
