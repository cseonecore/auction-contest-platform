-- Migration 028:
--   Team-specific development times, per-team submission windows,
--   automatic disqualification (DQ), and create_submission window checks.
--
-- Model (flat per team):
--   Team Duration = Base(75min) + Effective Add-on + Earned Bonus
--     Effective Add-on = COALESCE(teams.dev_addon_seconds, admin_dev_addon_seconds)
--     Earned Bonus = sum(bonus_transactions.bonus_seconds for the team)
--   Submission window opens at (deadline − 20 min), closes at (deadline).
--
-- Enforcement is database-backed: get_team_dev_status() (callable by teams,
-- admins, backend) performs the idempotent automatic DQ marking. The create
-- submission route calls it before writing and rejects early/late submissions.
--
-- Base development time is 4500s (75 min) — see 026.

-- ─────────────────────────────────────────────────────────────
-- 1. Team columns
-- ─────────────────────────────────────────────────────────────

alter table public.teams add column if not exists dev_addon_seconds integer;

-- AUTO DQ: timestamp of the moment the team's submission deadline passed and
-- no valid submission exists. NULL while not disqualified. Written by
-- apply_dq_statuses(); never set when a valid submission exists.
alter table public.teams add column if not exists dq_at timestamptz;

-- ─────────────────────────────────────────────────────────────
-- 2. Team-specific duration & deadline helpers
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_team_dev_duration_seconds(p_team_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base        integer;
  v_team_addon  integer;
  v_bonus       integer;
begin
  v_base := greatest(public.get_setting_int('solving_timer_seconds', 4500), 0);

  select coalesce(t.dev_addon_seconds, public.get_setting_int('admin_dev_addon_seconds', 0))
  into v_team_addon
  from public.teams t
  where t.id = p_team_id;
  v_team_addon := coalesce(v_team_addon, 0);

  select coalesce(sum(b.bonus_seconds), 0)
  into v_bonus
  from public.bonus_transactions b
  where b.team_id = p_team_id;

  return greatest(0, v_base + v_team_addon + coalesce(v_bonus, 0));
end;
$$;

revoke all on function public.get_team_dev_duration_seconds(uuid) from public;
grant execute on function public.get_team_dev_duration_seconds(uuid) to authenticated, service_role;

comment on function public.get_team_dev_duration_seconds(uuid) is
  'Team-specific development duration in seconds (base + effective add-on + earned bonus).';

create or replace function public.get_team_dev_deadline(p_team_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.get_setting_bigint('dev_timer_started_at', 0) > 0 then
      to_timestamp(public.get_setting_bigint('dev_timer_started_at', 0) / 1000.0)
        + make_interval(secs => public.get_team_dev_duration_seconds(p_team_id))
    else null
  end;
$$;

revoke all on function public.get_team_dev_deadline(uuid) from public;
grant execute on function public.get_team_dev_deadline(uuid) to authenticated, service_role;

comment on function public.get_team_dev_deadline(uuid) is
  'Team deadline = dev_timer_started_at + team-specific duration (null when timer not started).';

-- ─────────────────────────────────────────────────────────────
-- 3. apply_dq_statuses(): automatic DQ, idempotent
--    Marks dq_at for teams whose deadline passed and who have no valid
--    submission. Idempotent: dq_at is only set once (NULL guard).
-- ─────────────────────────────────────────────────────────────

create or replace function public.apply_dq_statuses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marked integer := 0;
begin
  with marked as (
    update public.teams t
    set dq_at = now()
    where t.dq_at is null
      and public.get_team_dev_deadline(t.id) is not null
      and public.get_team_dev_deadline(t.id) < now()
      and not exists (select 1 from public.submissions s where s.team_id = t.id)
    returning t.id
  )
  select count(*) into v_marked from marked;

  return v_marked;
end;
$$;

revoke all on function public.apply_dq_statuses() from public;
grant execute on function public.apply_dq_statuses() to authenticated, service_role;

comment on function public.apply_dq_statuses() is
  'Marks dq_at on teams whose individual deadline passed without a valid submission. Idempotent.';

-- ─────────────────────────────────────────────────────────────
-- 4. set_team_dev_addon_seconds(): admin sets per-team add-on
-- ─────────────────────────────────────────────────────────────

create or replace function public.set_team_dev_addon_seconds(p_team_id uuid, p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deadline_before timestamptz;
  v_deadline_after timestamptz;
  v_has_sub boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to change team development add-ons.';
  end if;

  -- Lock the team row.
  perform 1 from public.teams t where t.id = p_team_id for update;
  if not found then
    raise exception 'Team not found.';
  end if;

  v_deadline_before := public.get_team_dev_deadline(p_team_id);

  -- Apply the new add-on (nullable: null inherits the global admin_dev_addon_seconds).
  update public.teams
  set dev_addon_seconds = p_seconds
  where id = p_team_id;

  v_deadline_after := public.get_team_dev_deadline(p_team_id);

  -- Safety rule (Part 7): do not shorten the remaining window of a team that
  -- already has a submission. Shortening while a team has a submission is
  -- rejected as an unsafe change.
  if v_deadline_before is not null
     and v_deadline_after is not null
     and v_deadline_after < v_deadline_before then
    select exists (select 1 from public.submissions s where s.team_id = p_team_id) into v_has_sub;
    if v_has_sub then
      raise exception 'Cannot shorten the development duration while the team has a submission. Set an equal or larger add-on.';
    end if;
  end if;

  return public.get_team_dev_status(p_team_id);
end;
$$;

revoke all on function public.set_team_dev_addon_seconds(uuid, integer) from public;
grant execute on function public.set_team_dev_addon_seconds(uuid, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. get_team_dev_status(): authoritative per-team state (teams read it)
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_team_dev_status(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_ms bigint;
  v_total integer;
  v_remaining integer;
  v_deadline timestamptz;
  v_opens_at timestamptz;
  v_status text;
  v_has_sub boolean;
  v_window_open boolean;
  v_dq_at timestamptz;
  v_dq_pending boolean;
  v_server_time timestamptz;
begin
  perform public.apply_dq_statuses();

  v_total := public.get_team_dev_duration_seconds(p_team_id);
  v_started_ms := public.get_setting_bigint('dev_timer_started_at', 0);
  v_deadline := public.get_team_dev_deadline(p_team_id);
  v_server_time := clock_timestamp();

  if v_deadline is null then
    v_status := 'not_started';
    v_remaining := 0;
  else
    v_remaining := greatest(0, floor(extract(epoch from (v_deadline - v_server_time))))::integer;
    v_status := case when v_remaining = 0 then 'finished' else 'running' end;
  end if;

  select coalesce(v_deadline - interval '20 minutes', null) into v_opens_at;

  select exists(select 1 from public.submissions s where s.team_id = p_team_id) into v_has_sub;
  select t.dq_at into v_dq_at from public.teams t where t.id = p_team_id;

  v_window_open := v_deadline is not null
    and v_dq_at is null
    and v_server_time <= v_deadline
    and v_opens_at is not null
    and v_server_time >= v_opens_at;

  v_dq_pending := v_dq_at is null
    and v_deadline is not null
    and v_deadline < v_server_time
    and not v_has_sub;

  return jsonb_build_object(
    'team_id', p_team_id,
    'dev_timer_started_at_ms', nullif(v_started_ms, 0),
    'dev_addon_seconds', (
      select coalesce(t.dev_addon_seconds, public.get_setting_int('admin_dev_addon_seconds', 0))
      from public.teams t
      where t.id = p_team_id
    ),
    'dev_timer_total_seconds', v_total,
    'dev_timer_remaining_seconds', v_remaining,
    'dev_timer_status', v_status,
    'dev_deadline', v_deadline,
    'submission_opens_at', v_opens_at,
    'dq_at', v_dq_at,
    'dq_pending', v_dq_pending,
    'has_submission', v_has_sub,
    'submission_window_open', v_window_open,
    'server_time', v_server_time
  );
end;
$$;

revoke all on function public.get_team_dev_status(uuid) from public;
grant execute on function public.get_team_dev_status(uuid) to authenticated, service_role;

comment on function public.get_team_dev_status(uuid) is
  'Returns the team-specific development timer and submission window state (auto-applies DQ).';

-- ─────────────────────────────────────────────────────────────
-- 6. get_bidding_results(): team-specific durations + DQ state
--    (redefinition of 026 with team columns added)
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_bidding_results()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base   integer;
  v_teams  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to read bidding results';
  end if;

  v_base := greatest(public.get_setting_int('solving_timer_seconds', 4500), 0);

  select coalesce(jsonb_agg(team_obj order by team_name), '[]'::jsonb)
  into v_teams
  from (
    select
      t.name as team_name,
      jsonb_build_object(
        'team_id',        t.id,
        'team_name',      t.name,
        'dq_at',          t.dq_at,
        'captain_name',   cap.name,
        'captain_usn',    upper(split_part(coalesce(cap.email, ''), '@', 1)),
        'members',        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name',       m.name,
              'usn',        upper(split_part(coalesce(m.email, ''), '@', 1)),
              'is_captain', m.id = t.captain_id
            ) order by m.created_at
          )
          from public.members m
          where m.team_id = t.id
        ), '[]'::jsonb),
        'member_count',   (select count(*) from public.members m where m.team_id = t.id),
        'registered_at',  t.created_at,
        'balance',        coalesce(w.balance, 0),
        'eliminated',     public.team_is_eliminated(t.id),
        'qualified',      (agg.won_count >= 2),
        'elimination_reason', (
          select reason from public.team_eliminations
          where team_id = t.id and restored_at is null
          order by eliminated_at desc limit 1
        ),
        'total_spent',    coalesce((
          select sum(-wt.amount)
          from public.wallet_transactions wt
          where wt.team_id = t.id and wt.tx_type = 'win_deduction'
        ), 0),
        'problems',       coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'slot_id',         s.id,
              'question_number', s.question_number,
              'round',           s.round,
              'difficulty',      tp.level,
              'topic_title',     tp.title,
              'winning_bid',     s.current_bid,
              'status',          s.status,
              'sold_at',         s.sold_at,
              'base_dev_seconds',  v_base,
              'bonus_dev_seconds', coalesce((
                select sum(b.bonus_seconds)
                from public.bonus_transactions b
                where b.slot_id = s.id and b.team_id = t.id
              ), 0),
              'total_dev_seconds', v_base + coalesce(t.dev_addon_seconds, public.get_setting_int('admin_dev_addon_seconds', 0)) + coalesce((
                select sum(b.bonus_seconds)
                from public.bonus_transactions b
                where b.slot_id = s.id and b.team_id = t.id
              ), 0)
            ) order by s.round, s.question_number nulls last, s.id
          )
          from public.slots s
          join public.topics tp on tp.id = s.topic_id
          where s.winner_team_id = t.id and s.status = 'sold'
        ), '[]'::jsonb),
        'won_count',               agg.won_count,
        'total_base_dev_seconds',  v_base,
        'total_addon_dev_seconds', public.get_team_dev_duration_seconds(t.id) - v_base,
        'total_bonus_dev_seconds', agg.bonus_dev_seconds,
        'total_dev_seconds',       public.get_team_dev_duration_seconds(t.id)
      ) as team_obj
    from public.teams t
    left join public.wallets w on w.team_id = t.id
    left join lateral (
      select m.*
      from public.members m
      where m.team_id = t.id
      order by (m.id = t.captain_id) desc, m.created_at asc
      limit 1
    ) cap on true
    left join lateral (
      select
        count(*) as won_count,
        coalesce(sum((
          select coalesce(sum(b.bonus_seconds), 0)
          from public.bonus_transactions b
          where b.slot_id = s.id and b.team_id = t.id
        )), 0) as bonus_dev_seconds
      from public.slots s
      where s.winner_team_id = t.id and s.status = 'sold'
    ) agg on true
  ) q;

  return jsonb_build_object(
    'teams',          coalesce(v_teams, '[]'::jsonb),
    'base_dev_seconds', v_base,
    'admin_dev_addon_seconds', public.get_setting_int('admin_dev_addon_seconds', 0),
    'server_time',      clock_timestamp()
  );
end;
$$;

revoke all on function public.get_bidding_results() from public;
grant execute on function public.get_bidding_results() to authenticated, service_role;
