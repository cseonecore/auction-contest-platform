-- Migration 027:
--   Central, database-backed development timer and submission controls:
--   1. Settings: dev_timer_started_at (epoch millis), submissions_enabled,
--      submissions_manually_enabled (all defaulted through upserts).
--   2. public.get_admin_dev_time_config(): base (75 min) + admin add-on total.
--   3. public.set_admin_dev_addon_seconds(p_seconds): admin-managed add-on,
--      validated (>= 0, capped), never touches the 75-minute base.
--   4. public.get_contest_flow_state(): authoritative contest flow state for
--      teams/projector clients; performs the idempotent, once-only automatic
--      submission enablement when remaining dev time <= 20 minutes.
--   5. public.start_dev_timer(): admin starts the centrally stored timer;
--      idempotent (no accidental restart while running).
--   6. public.reset_dev_timer(): admin clears the timer for a new round.
--   7. public.enable_submissions(): admin opens the submission portal.
--
-- Timer math is done against clock_timestamp(), never on any client.

-- ─────────────────────────────────────────────────────────────
-- 1. Settings seeds (idempotent for upgraded DBs)
-- ─────────────────────────────────────────────────────────────

insert into public.settings (key, value)
values
  ('dev_timer_started_at', '0'::jsonb),
  ('submissions_enabled', 'false'::jsonb),
  ('submissions_manually_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 2. get_admin_dev_time_config()
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_admin_dev_time_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base  integer;
  v_addon integer;
begin
  v_base  := greatest(public.get_setting_int('solving_timer_seconds', 4500), 0);
  v_addon := greatest(public.get_setting_int('admin_dev_addon_seconds', 0), 0);

  return jsonb_build_object(
    'base_dev_seconds',   v_base,
    'addon_dev_seconds',  v_addon,
    'total_dev_seconds',  v_base + v_addon
  );
end;
$$;

revoke all on function public.get_admin_dev_time_config() from public;
grant execute on function public.get_admin_dev_time_config() to authenticated, anon, service_role;

comment on function public.get_admin_dev_time_config() is
  'Returns base development time (75 min) + admin add-on. Total = base + add-on.';

-- ─────────────────────────────────────────────────────────────
-- 3. set_admin_dev_addon_seconds(p_seconds) — admin-managed add-on
-- ─────────────────────────────────────────────────────────────

create or replace function public.set_admin_dev_addon_seconds(p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secs integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to configure development time add-ons.';
  end if;

  -- Validate: no negative values; cap to keep the config sane.
  v_secs := coalesce(p_seconds, 0);
  v_secs := greatest(v_secs, 0);
  v_secs := least(v_secs, 3600);

  insert into public.settings (key, value)
  values ('admin_dev_addon_seconds', to_jsonb(v_secs))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(),
    'admin_dev_addon_updated',
    'settings',
    jsonb_build_object('addon_dev_seconds', v_secs, 'total_dev_seconds', (public.get_admin_dev_time_config() ->> 'total_dev_seconds')::int),
    clock_timestamp()
  );

  return public.get_admin_dev_time_config();
end;
$$;

revoke all on function public.set_admin_dev_addon_seconds(integer) from public;
grant execute on function public.set_admin_dev_addon_seconds(integer) to authenticated;

comment on function public.set_admin_dev_addon_seconds(integer) is
  'Admin sets the manual add-on development time. Base time (75 min) is never modified here.';

create or replace function public.get_setting_bigint(p_key text, p_default bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw  jsonb;
  v_str  text;
begin
  select value into v_raw
  from public.settings
  where key = p_key;

  if v_raw is null then
    return p_default;
  end if;

  v_str := lower(coalesce(v_raw #>> '{}', ''));
  if v_str ~ '^-?[0-9]+$' then
    return v_str::bigint;
  end if;

  if jsonb_typeof(v_raw) = 'object' then
    v_str := lower(coalesce(v_raw ->> 'ms', v_raw ->> 'milliseconds', v_raw ->> 'seconds', v_raw ->> 'value'));
    if v_str ~ '^-?[0-9]+$' then
      return v_str::bigint;
    end if;
  end if;

  return p_default;
end;
$$;

revoke all on function public.get_setting_bigint(text, bigint) from public;
grant execute on function public.get_setting_bigint(text, bigint) to authenticated, anon, service_role;

comment on function public.get_setting_bigint(text, bigint) is
  'Reads a bigint setting from public.settings with a safe default.';

-- ─────────────────────────────────────────────────────────────
-- 4. get_contest_flow_state() — authoritative state for everyone
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_contest_flow_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base      integer;
  v_addon     integer;
  v_total     integer;
  v_started_ms bigint;
  v_started_at timestamptz;
  v_elapsed   double precision;
  v_remaining integer;
  v_enabled   boolean;
  v_manual    boolean;
  v_status    text;
begin
  v_base  := greatest(public.get_setting_int('solving_timer_seconds', 4500), 0);
  v_addon := greatest(public.get_setting_int('admin_dev_addon_seconds', 0), 0);
  v_total := v_base + v_addon;
  v_enabled := public.get_setting_bool('submissions_enabled', false);
  v_manual  := public.get_setting_bool('submissions_manually_enabled', false);

  v_started_ms := public.get_setting_bigint('dev_timer_started_at', 0);

  if v_started_ms > 0 then
    v_started_at := to_timestamp(v_started_ms / 1000.0);
    v_elapsed := coalesce(extract(epoch from (clock_timestamp() - v_started_at)), 0::numeric)::double precision;
    v_remaining := greatest(0, v_total - floor(v_elapsed)::integer);

    -- Idempotent, once-only automatic submission enablement:
    -- When the centrally stored development time reaches the final 20 minutes
    -- (remaining <= 1200s), enable submissions. Manual enablement wins: if the
    -- admin already enabled submissions, nothing changes here.
    if v_remaining <= (20 * 60) and not v_enabled and not v_manual then
      update public.settings
      set value = to_jsonb(true)
      where key = 'submissions_enabled'
        and public.get_setting_bool('submissions_enabled', false) = false;
      v_enabled := true;
    end if;

    if v_remaining <= 0 then
      v_status := 'finished';
    else
      v_status := 'running';
    end if;
  else
    v_remaining := v_total;
    v_status := 'not_started';
  end if;

  return jsonb_build_object(
    'dev_timer_started_at_ms', nullif(v_started_ms, 0::bigint),
    'dev_timer_total_seconds', v_total,
    'dev_timer_remaining_seconds', v_remaining,
    'dev_timer_status', v_status,
    'submissions_enabled', v_enabled,
    'submissions_manually_enabled', v_manual,
    'submissions_source', case
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
  'Authoritative contest flow state: dev timer + submissions flags. '
  'Auto-enables submissions idempotently when remaining dev time <= 20 min.';

-- ─────────────────────────────────────────────────────────────
-- 5. start_dev_timer() — admin starts the central dev timer
-- ─────────────────────────────────────────────────────────────

create or replace function public.start_dev_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_ms bigint;
  v_total integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to start the development timer.';
  end if;

  -- Idempotent: if the timer is already running, do NOT restart it.
  v_started_ms := public.get_setting_bigint('dev_timer_started_at', 0);
  if v_started_ms > 0 then
    return public.get_contest_flow_state();
  end if;

  v_started_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  insert into public.settings (key, value)
  values ('dev_timer_started_at', to_jsonb(v_started_ms))
  on conflict (key) do update set value = excluded.value;

  v_total := (public.get_admin_dev_time_config() ->> 'total_dev_seconds')::integer;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(),
    'dev_timer_started',
    'settings',
    jsonb_build_object('started_at_ms', v_started_ms, 'total_seconds', v_total),
    clock_timestamp()
  );

  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.start_dev_timer() from public;
grant execute on function public.start_dev_timer() to authenticated;

comment on function public.start_dev_timer() is
  'Admin starts the centrally stored development timer. Idempotent while running.';

-- ─────────────────────────────────────────────────────────────
-- 6. reset_dev_timer() — admin clears the timer (intentional restart)
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
  values ('dev_timer_started_at', to_jsonb(0))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(),
    'dev_timer_reset',
    'settings',
    jsonb_build_object('reason', 'Admin reset the development timer.'),
    clock_timestamp()
  );

  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.reset_dev_timer() from public;
grant execute on function public.reset_dev_timer() to authenticated;

comment on function public.reset_dev_timer() is
  'Admin clears the centrally stored development timer so it can be started again.';

-- ─────────────────────────────────────────────────────────────
-- 7. enable_submissions() — admin opens the submission portal
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
    ('submissions_manually_enabled', to_jsonb(true))
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
