-- ═══════════════════════════════════════════════════════════════════
-- 030 · Development timer pause/resume + submission portal toggle
-- ═══════════════════════════════════════════════════════════════════
-- Adds the controls requested for /admin/submissions:
--
--   * Development timer: Start / Pause / Resume / Reset.
--   * Submission portal: Enable / Disable (Disable survives the automatic
--     "last 20 minutes" enablement until an admin re-enables or resets).
--   * Reset clears BOTH the development clock and the submission portal.
--   * Per-team deadlines and DQ math respect a paused timer.
--
-- New settings (all jsonb, matching public.settings):
--   dev_timer_paused_at        epoch millis of the active pause (0 = running)
--   dev_timer_paused_total_ms  accumulated paused milliseconds
--   submissions_suppressed     true when an admin explicitly disabled the portal
--
-- Safe to re-run. Depends on migrations 027 and 028.
-- ═══════════════════════════════════════════════════════════════════

insert into public.settings (key, value) values
  ('dev_timer_paused_at',       '0'::jsonb),
  ('dev_timer_paused_total_ms', '0'::jsonb),
  ('submissions_suppressed',    'false'::jsonb)
on conflict (key) do nothing;


-- ─────────────────────────────────────────────────────────────
-- 1. get_contest_flow_state() — pause-aware authoritative state
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_contest_flow_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base            integer;
  v_addon           integer;
  v_total           integer;
  v_started_ms      bigint;
  v_paused_at_ms    bigint;
  v_paused_total_ms bigint;
  v_now_ms          bigint;
  v_elapsed_ms      bigint;
  v_remaining       integer;
  v_enabled         boolean;
  v_manual          boolean;
  v_suppressed      boolean;
  v_paused          boolean;
  v_status          text;
begin
  v_base := greatest(public.get_setting_int('solving_timer_seconds', 4500), 0);
  v_addon := greatest(public.get_setting_int('admin_dev_addon_seconds', 0), 0);
  v_total := v_base + v_addon;

  v_enabled    := public.get_setting_bool('submissions_enabled', false);
  v_manual     := public.get_setting_bool('submissions_manually_enabled', false);
  v_suppressed := public.get_setting_bool('submissions_suppressed', false);

  v_started_ms      := public.get_setting_bigint('dev_timer_started_at', 0);
  v_paused_at_ms    := public.get_setting_bigint('dev_timer_paused_at', 0);
  v_paused_total_ms := greatest(public.get_setting_bigint('dev_timer_paused_total_ms', 0), 0);
  v_now_ms          := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_paused          := v_paused_at_ms > 0;

  if v_started_ms > 0 then
    -- While paused the clock is frozen at dev_timer_paused_at.
    v_elapsed_ms := greatest(
      0,
      (case when v_paused then v_paused_at_ms else v_now_ms end)
        - v_started_ms
        - v_paused_total_ms
    );
    v_remaining := greatest(0, v_total - floor(v_elapsed_ms / 1000.0)::integer);

    -- Idempotent automatic enablement during the final 20 minutes.
    -- Paused timers and an explicit admin Disable both suppress it.
    if (not v_paused)
       and v_remaining <= (20 * 60)
       and (not v_enabled)
       and (not v_manual)
       and (not v_suppressed) then
      update public.settings
      set value = to_jsonb(true)
      where key = 'submissions_enabled'
        and public.get_setting_bool('submissions_enabled', false) = false;
      v_enabled := true;
    end if;

    if v_remaining <= 0 then
      v_status := 'finished';
    elsif v_paused then
      v_status := 'paused';
    else
      v_status := 'running';
    end if;
  else
    v_remaining := v_total;
    v_status := 'not_started';
  end if;

  return jsonb_build_object(
    'dev_timer_started_at_ms', nullif(v_started_ms, 0::bigint),
    'dev_timer_paused_at_ms', nullif(v_paused_at_ms, 0::bigint),
    'dev_timer_paused_total_seconds', floor(v_paused_total_ms / 1000.0)::integer,
    'dev_timer_total_seconds', v_total,
    'dev_timer_remaining_seconds', v_remaining,
    'dev_timer_status', v_status,
    'submissions_enabled', case when v_suppressed then false else v_enabled end,
    'submissions_manually_enabled', v_manual,
    'submissions_suppressed', v_suppressed,
    'submissions_source', case
      when v_suppressed then 'none'
      when v_manual then 'manual'
      when v_enabled then 'auto'
      else 'none'
    end,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_contest_flow_state() from public;
grant execute on function public.get_contest_flow_state() to authenticated, anon, service_role;

comment on function public.get_contest_flow_state() is
  'Authoritative contest flow state: pause-aware development timer + submissions flags. '
  'Auto-enables submissions while running in the final 20 minutes unless disabled.';


-- ─────────────────────────────────────────────────────────────
-- 2. start_dev_timer() — start a fresh timer OR resume a paused one
-- ─────────────────────────────────────────────────────────────
create or replace function public.start_dev_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_ms      bigint;
  v_paused_at_ms    bigint;
  v_paused_total_ms bigint;
  v_now_ms          bigint;
  v_resumed         boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to start the development timer.';
  end if;

  v_started_ms      := public.get_setting_bigint('dev_timer_started_at', 0);
  v_paused_at_ms    := public.get_setting_bigint('dev_timer_paused_at', 0);
  v_paused_total_ms := greatest(public.get_setting_bigint('dev_timer_paused_total_ms', 0), 0);
  v_now_ms          := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  if v_started_ms = 0 then
    -- Start a fresh run.
    insert into public.settings (key, value)
    values
      ('dev_timer_started_at', to_jsonb(v_now_ms)),
      ('dev_timer_paused_at', to_jsonb(0)),
      ('dev_timer_paused_total_ms', to_jsonb(0))
    on conflict (key) do update set value = excluded.value;

    insert into public.audit_log (actor_id, action, entity_type, details, created_at)
    values (
      auth.uid(), 'dev_timer_started', 'settings',
      jsonb_build_object('started_at_ms', v_now_ms),
      clock_timestamp()
    );
  elsif v_paused_at_ms > 0 then
    -- Resume: bank the elapsed pause and clear the pause marker.
    update public.settings
    set value = to_jsonb(v_paused_total_ms + greatest(0, v_now_ms - v_paused_at_ms))
    where key = 'dev_timer_paused_total_ms';

    update public.settings
    set value = to_jsonb(0)
    where key = 'dev_timer_paused_at';

    v_resumed := true;

    insert into public.audit_log (actor_id, action, entity_type, details, created_at)
    values (
      auth.uid(), 'dev_timer_resumed', 'settings',
      jsonb_build_object(
        'paused_at_ms', v_paused_at_ms,
        'resumed_at_ms', v_now_ms,
        'paused_total_ms', v_paused_total_ms + greatest(0, v_now_ms - v_paused_at_ms)
      ),
      clock_timestamp()
    );
  end if;

  -- Running (or finished): idempotent no-op.
  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.start_dev_timer() from public;
grant execute on function public.start_dev_timer() to authenticated;

comment on function public.start_dev_timer() is
  'Admin starts a fresh development timer, or resumes a paused one. Idempotent while running.';


-- ─────────────────────────────────────────────────────────────
-- 3. pause_dev_timer() — freeze the clock without losing progress
-- ─────────────────────────────────────────────────────────────
create or replace function public.pause_dev_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state  jsonb;
  v_now_ms bigint;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to pause the development timer.';
  end if;

  v_state := public.get_contest_flow_state();

  -- Only a running timer can be paused; everything else is a no-op.
  if (v_state ->> 'dev_timer_status') <> 'running' then
    return v_state;
  end if;

  v_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  insert into public.settings (key, value)
  values ('dev_timer_paused_at', to_jsonb(v_now_ms))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(), 'dev_timer_paused', 'settings',
    jsonb_build_object('paused_at_ms', v_now_ms),
    clock_timestamp()
  );

  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.pause_dev_timer() from public;
grant execute on function public.pause_dev_timer() to authenticated;

comment on function public.pause_dev_timer() is
  'Admin freezes the development timer. Resume with start_dev_timer().';


-- ─────────────────────────────────────────────────────────────
-- 4. reset_dev_timer() — clears the dev clock AND the submission portal
-- ─────────────────────────────────────────────────────────────
create or replace function public.reset_dev_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to reset the development timer.';
  end if;

  insert into public.settings (key, value)
  values
    ('dev_timer_started_at', to_jsonb(0)),
    ('dev_timer_paused_at', to_jsonb(0)),
    ('dev_timer_paused_total_ms', to_jsonb(0)),
    ('submissions_enabled', to_jsonb(false)),
    ('submissions_manually_enabled', to_jsonb(false)),
    ('submissions_suppressed', to_jsonb(false))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(),
    'dev_timer_reset',
    'settings',
    jsonb_build_object(
      'reason', 'Admin reset the development timer.',
      'submissions_reset', true
    ),
    clock_timestamp()
  );

  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.reset_dev_timer() from public;
grant execute on function public.reset_dev_timer() to authenticated;

comment on function public.reset_dev_timer() is
  'Admin clears the development timer (including pause state) and closes/resets the submission portal.';


-- ─────────────────────────────────────────────────────────────
-- 5. enable_submissions() — manual open, clears an explicit disable
-- ─────────────────────────────────────────────────────────────
create or replace function public.enable_submissions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to enable submissions.';
  end if;

  insert into public.settings (key, value)
  values
    ('submissions_enabled', to_jsonb(true)),
    ('submissions_manually_enabled', to_jsonb(true)),
    ('submissions_suppressed', to_jsonb(false))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(),
    'submissions_enabled',
    'settings',
    jsonb_build_object('source', 'manual'),
    clock_timestamp()
  );

  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.enable_submissions() from public;
grant execute on function public.enable_submissions() to authenticated;

comment on function public.enable_submissions() is
  'Admin enables the submission portal; submissions_source becomes "manual".';


-- ─────────────────────────────────────────────────────────────
-- 6. disable_submissions() — manual close that survives auto-enable
-- ─────────────────────────────────────────────────────────────
create or replace function public.disable_submissions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to disable submissions.';
  end if;

  insert into public.settings (key, value)
  values
    ('submissions_enabled', to_jsonb(false)),
    ('submissions_manually_enabled', to_jsonb(false)),
    ('submissions_suppressed', to_jsonb(true))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(),
    'submissions_disabled',
    'settings',
    jsonb_build_object('source', 'manual'),
    clock_timestamp()
  );

  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.disable_submissions() from public;
grant execute on function public.disable_submissions() to authenticated;

comment on function public.disable_submissions() is
  'Admin closes the submission portal. Suppresses the automatic last-20-minute enablement until re-enabled or reset.';


-- ─────────────────────────────────────────────────────────────
-- 7. get_team_dev_deadline() — deadline slides while paused
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_team_dev_deadline(p_team_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select
      public.get_setting_bigint('dev_timer_started_at', 0)                      as started_ms,
      public.get_setting_bigint('dev_timer_paused_at', 0)                       as paused_at_ms,
      greatest(public.get_setting_bigint('dev_timer_paused_total_ms', 0), 0)    as paused_total_ms,
      floor(extract(epoch from clock_timestamp()) * 1000)::bigint               as now_ms
  )
  select case
    when s.started_ms > 0 then
      to_timestamp(s.started_ms / 1000.0)
        + make_interval(secs => public.get_team_dev_duration_seconds(p_team_id))
        + (s.paused_total_ms * interval '1 millisecond')
        + case
            when s.paused_at_ms > 0
              then (s.now_ms - s.paused_at_ms) * interval '1 millisecond'
            else interval '0'
          end
    else null
  end
  from s;
$$;

revoke all on function public.get_team_dev_deadline(uuid) from public;
grant execute on function public.get_team_dev_deadline(uuid) to authenticated, service_role;

comment on function public.get_team_dev_deadline(uuid) is
  'Team deadline = start + duration + accumulated pause (+ the current pause while active).';


-- ─────────────────────────────────────────────────────────────
-- 8. get_team_dev_status() — exposes the paused state to teams
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_team_dev_status(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_ms  bigint;
  v_paused_at_ms bigint;
  v_total       integer;
  v_remaining   integer;
  v_deadline    timestamptz;
  v_opens_at    timestamptz;
  v_status      text;
  v_has_sub     boolean;
  v_window_open boolean;
  v_dq_at       timestamptz;
  v_dq_pending  boolean;
  v_server_time timestamptz;
  v_paused      boolean;
begin
  perform public.apply_dq_statuses();

  v_total        := public.get_team_dev_duration_seconds(p_team_id);
  v_started_ms   := public.get_setting_bigint('dev_timer_started_at', 0);
  v_paused_at_ms := public.get_setting_bigint('dev_timer_paused_at', 0);
  v_paused       := v_paused_at_ms > 0;
  v_deadline     := public.get_team_dev_deadline(p_team_id);
  v_server_time  := clock_timestamp();

  if v_deadline is null then
    v_status := 'not_started';
    v_remaining := 0;
  else
    v_remaining := greatest(0, floor(extract(epoch from (v_deadline - v_server_time))))::integer;
    v_status := case
      when v_remaining = 0 then 'finished'
      when v_paused then 'paused'
      else 'running'
    end;
  end if;

  v_opens_at := v_deadline - interval '20 minutes';

  select exists(select 1 from public.submissions s where s.team_id = p_team_id) into v_has_sub;
  select t.dq_at into v_dq_at from public.teams t where t.id = p_team_id;

  v_window_open := v_deadline is not null
    and (not v_paused)
    and v_dq_at is null
    and v_server_time <= v_deadline
    and v_opens_at is not null
    and v_server_time >= v_opens_at;

  v_dq_pending := v_dq_at is null
    and (not v_paused)
    and v_deadline is not null
    and v_deadline < v_server_time
    and not v_has_sub;

  return jsonb_build_object(
    'team_id', p_team_id,
    'dev_timer_started_at_ms', nullif(v_started_ms, 0),
    'dev_timer_paused_at_ms', nullif(v_paused_at_ms, 0),
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
  'Returns the team-specific development timer and submission window state (pause-aware, auto-applies DQ).';


notify pgrst, 'reload schema';
