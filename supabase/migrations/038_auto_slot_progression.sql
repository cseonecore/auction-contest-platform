-- ============================================================
-- Migration 038: Automatic slot progression (5-second delay)
-- ============================================================
-- When the admin manually opens the first slot of a round via the
-- existing Open Slot flow, automatic progression starts: each time a
-- slot is finalized as SOLD or UNSOLD, the next eligible slot of the
-- SAME round is opened automatically 5 seconds later.
--
-- Design (backend-authoritative, integrates with the existing
-- engine — no new auction tables, no changes to bid rules or timers):
--   * `auction_slot_progressions` — one row per round that has an
--     active progression sequence. Tracks the pending transition,
--     the scheduled time, and the completion state.
--   * `activate_slot_progression(round, slot_id)` — called by
--     open_slot(): the manual Open Slot click starts/continues the
--     sequence for that round.
--   * `schedule_slot_progression(round, slot_id)` — called by
--     settle_slot() when a slot is finalized: arms the 5-second
--     transition. Only progression rounds have a row, so no
--     progression exists without an admin-initiated open.
--   * `auto_advance_auction_if_scheduled()` — the driver. Claim the
--     pending transition (idempotent), then open the next eligible
--     slot of the pinned round using the existing select_auction_question()
--     + open_bidding() sequence. When no more slots remain in the
--     round it marks the progression complete (does NOT start round 2).
--   * pg_cron (when available) ticks the driver every minute;
--     get_live_auction_state() also drives it on every read so a
--     connected admin/participant/projector page keeps it moving.
-- ============================================================

create table if not exists public.auction_slot_progressions (
  round                     integer primary key
                            check (round in (1, 2, 3)),
  auto_active               boolean not null default true,
  last_completed_slot_id    uuid references public.slots (id) on delete set null,
  transition_pending        boolean not null default false,
  transition_executed_at    timestamptz,
  scheduled_transition_at   timestamptz,
  retry_count               integer not null default 0,
  round_complete            boolean not null default false,
  message                   text,
  updated_at                timestamptz not null default clock_timestamp()
);

create index if not exists auction_slot_progressions_pending_idx
  on public.auction_slot_progressions (scheduled_transition_at)
  where transition_pending and auto_active;

comment on table public.auction_slot_progressions is
  'One row per round with an active automatic slot progression. transition_pending + scheduled_transition_at drive the backend 5-second slot opening.';

alter table public.auction_slot_progressions enable row level security;

drop policy if exists "Public view slot progressions" on public.auction_slot_progressions;
create policy "Public view slot progressions"
on public.auction_slot_progressions
for select
to authenticated, anon
using (true);

revoke insert, update, delete on public.auction_slot_progressions from authenticated, anon;
grant select on public.auction_slot_progressions to authenticated, anon;


-- ─────────────────────────────────────────────────────────────
-- 1. activate_slot_progression — called from open_slot()
--    The manual Open Slot click activates (or re-arms) the
--    progression sequence for that round.
-- ─────────────────────────────────────────────────────────────
create or replace function public.activate_slot_progression(
  p_round integer,
  p_slot_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.auction_slot_progressions%rowtype;
begin
  if p_round is null or p_round not in (1, 2, 3) then
    return;
  end if;

  select * into v_row from public.auction_slot_progressions where round = p_round;

  if not found then
    insert into public.auction_slot_progressions (round, auto_active, last_completed_slot_id)
    values (p_round, true, p_slot_id);
  else
    update public.auction_slot_progressions
    set    auto_active        = true,
           round_complete     = false,
           retry_count        = 0,
           message            = null,
           last_completed_slot_id = coalesce(v_row.last_completed_slot_id, p_slot_id),
           updated_at         = clock_timestamp()
    where  round = p_round;
  end if;
end;
$$;

revoke all on function public.activate_slot_progression(integer, uuid) from public;
grant execute on function public.activate_slot_progression(integer, uuid) to service_role;


-- ─────────────────────────────────────────────────────────────
-- 2. schedule_slot_progression — called from settle_slot()
--    Arms the 5-second transition after a slot is finalized as
--    SOLD or UNSOLD. Only fires when a progression row exists and
--    is active, so manual closes elsewhere are unaffected.
-- ─────────────────────────────────────────────────────────────
create or replace function public.schedule_slot_progression(
  p_round integer,
  p_slot_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.auction_slot_progressions%rowtype;
  v_scheduled timestamptz;
begin
  if p_round is null or p_round not in (1, 2, 3) then
    return;
  end if;

  select * into v_row from public.auction_slot_progressions where round = p_round;

  -- Progression is only scheduled for rounds it was initiated for;
  -- if none exists yet (e.g. it was never started) do nothing.
  if not found or not v_row.auto_active then
    return;
  end if;

  v_scheduled := clock_timestamp() + interval '5 seconds';

  update public.auction_slot_progressions
  set    transition_pending      = true,
         transition_executed_at  = null,
         last_completed_slot_id  = coalesce(p_slot_id, v_row.last_completed_slot_id),
         scheduled_transition_at = v_scheduled,
         retry_count             = 0,
         round_complete          = false,
         message                 = null,
         updated_at              = clock_timestamp()
  where  round = p_round;

  perform public.emit_auction_event(
    'slot_progression_scheduled',
    p_slot_id,
    null,
    jsonb_build_object(
      'round',                  p_round,
      'completed_slot_id',      coalesce(p_slot_id, v_row.last_completed_slot_id),
      'scheduled_transition_at', v_scheduled
    )
  );
end;
$$;

revoke all on function public.schedule_slot_progression(integer, uuid) from public;
grant execute on function public.schedule_slot_progression(integer, uuid) to service_role;


-- ─────────────────────────────────────────────────────────────
-- 3. auto_advance_auction_if_scheduled — the driver
--    Claims the due transition and opens the next eligible slot of
--    the SAME round via the existing select_auction_question() +
--    open_bidding() sequence. Idempotent: the claim happens before
--    any slot opens, so duplicate callers cannot double-open.
-- ─────────────────────────────────────────────────────────────
create or replace function public.auto_advance_auction_if_scheduled()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prog   public.auction_slot_progressions%rowtype;
  v_next   public.slots%rowtype;
  v_result jsonb;
  v_msg    text;
begin
  select *
  into   v_prog
  from   public.auction_slot_progressions
  where  auto_active
    and  transition_pending
    and  scheduled_transition_at is not null
    and  scheduled_transition_at <= clock_timestamp()
  order  by scheduled_transition_at asc
  limit  1
  for    update skip locked;

  if not found then
    return jsonb_build_object('success', true, 'advanced', false, 'reason', 'no_pending_transition');
  end if;

  -- Serialise with the manual open path (open_slot_internal takes the
  -- same lock), then check: another slot is already live, so leave the
  -- transition pending. It is armed again by schedule_slot_progression()
  -- whenever that live slot settles, which keeps the manual and the
  -- automatic flow on the same sequence.
  perform pg_advisory_xact_lock(hashtext('bid2build_slot_open'));

  if exists (select 1 from public.slots where status = 'open') then
    return jsonb_build_object(
      'success', true,
      'advanced', false,
      'reason',  'slot_already_open',
      'round',   v_prog.round
    );
  end if;

  -- Claim the transition BEFORE opening anything: exactly one caller
  -- proceeds past this point for a given transition.
  update public.auction_slot_progressions
  set    transition_pending     = false,
         transition_executed_at = clock_timestamp(),
         updated_at             = clock_timestamp()
  where  round = v_prog.round
    and  transition_pending;

  -- Next eligible slot of the SAME round, using the existing order
  -- (round, question_number, id). Never pick a topic that is already
  -- sold and never pick an already-finalized slot.
  select *
  into   v_next
  from   public.slots s
  where  s.round = v_prog.round
    and  (
           s.status = 'pending'
           or (v_prog.round = 3 and s.status = 'skipped')
         )
    and  not exists (
           select 1 from public.slots k
           where k.topic_id = s.topic_id and k.status = 'sold'
         )
  order  by s.round, s.question_number nulls last, s.id
  limit  1
  for    update;

  if not found then
    -- No more eligible slots in this round: stop progression. It is
    -- never restarted automatically — a new sequence starts only
    -- when the admin opens the first slot again.
    update public.auction_slot_progressions
    set    auto_active = false,
           round_complete = true,
           message = 'All eligible slots in Round ' || v_prog.round || ' have completed.',
           updated_at = clock_timestamp()
    where  round = v_prog.round;

    perform public.emit_auction_event(
      'slot_progression_complete',
      null,
      null,
      jsonb_build_object(
        'round',   v_prog.round,
        'message', 'All eligible slots in Round ' || v_prog.round || ' have completed.'
      )
    );

    return jsonb_build_object(
      'success', true,
      'advanced', false,
      'reason',  'round_complete',
      'round',   v_prog.round,
      'server_time', clock_timestamp()
    );
  end if;

  -- Open the next slot with the existing advance flow
  -- (select_auction_question + open_bidding, via their ungated
  -- internals: the gate belongs to the admin RPC entry points, and
  -- this driver also runs from pg_cron / non-admin readers).
  perform public.select_auction_question_internal(v_next.id);
  v_result := public.open_bidding_internal(v_next.id);

  -- The transition executed successfully: clear any retry bookkeeping.
  update public.auction_slot_progressions
  set    retry_count = 0,
         message     = null,
         updated_at  = clock_timestamp()
  where  round = v_prog.round;

  return jsonb_build_object(
    'success', true,
    'advanced', true,
    'round',    v_prog.round,
    'slot_id',  v_next.id,
    'topic_id', v_next.topic_id
  ) || coalesce(v_result, '{}'::jsonb);
exception when others then
  v_msg := sqlerrm;

  -- Never leave the sequence in limbo: a transition that was claimed
  -- but could not be executed (e.g. the session was stopped) is armed
  -- again for another 5 seconds, up to 5 attempts. After that the
  -- progression parks itself with a visible message instead of
  -- retrying forever — a later manual Open Slot restarts it.
  if v_prog.round is not null then
    if coalesce(v_prog.retry_count, 0) + 1 >= 5 then
      update public.auction_slot_progressions
      set    transition_pending     = false,
             auto_active           = false,
             retry_count           = retry_count + 1,
             message               = 'Automatic progression paused after 5 failed attempts: ' || v_msg,
             updated_at            = clock_timestamp()
      where  round = v_prog.round;
    else
      update public.auction_slot_progressions
      set    transition_pending      = true,
             scheduled_transition_at = clock_timestamp() + interval '5 seconds',
             retry_count             = retry_count + 1,
             message                 = 'Automatic progression will retry: ' || v_msg,
             updated_at              = clock_timestamp()
      where  round = v_prog.round;
    end if;
  end if;

  begin
    insert into public.audit_log (action, entity_type, details)
    values (
      'auto_advance_failed', 'auction',
      jsonb_build_object(
        'error', v_msg, 'sqlstate', sqlstate,
        'round', v_prog.round, 'server_time', clock_timestamp()
      )
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('success', false, 'advanced', false, 'reason', 'error', 'error', v_msg);
end;
$$;

-- The driver is backend-only: pg_cron (service_role/postgres) and
-- the security definer read functions call it internally.
revoke all on function public.auto_advance_auction_if_scheduled() from public, anon, authenticated;
grant execute on function public.auto_advance_auction_if_scheduled() to service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. pg_cron heartbeat (when available)
--    Ticks the driver every minute so the 5-second transition is
--    picked up even when no client reads the auction state.
--    Everything is guarded: if pg_cron cannot be created or the
--    schedule is rejected, the failure is only logged and the
--    migration continues (get_live_auction_state() keeps driving
--    the progression on every read either way).
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_job    text := 'bid2build_auto_slot_progression_tick';
  v_schema text;
begin
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    insert into public.audit_log (action, entity_type, details)
    values (
      'pg_cron_progression_job', 'auction',
      jsonb_build_object('status', 'unavailable', 'error', sqlerrm, 'server_time', clock_timestamp())
    );
    return;
  end;

  select n.nspname
  into   v_schema
  from   pg_extension e
  join   pg_namespace n on n.oid = e.extnamespace
  where  e.extname = 'pg_cron';

  if v_schema is null then
    return;
  end if;

  begin
    execute format('select %I.unschedule($1)', v_schema) using v_job;
  exception when others then
    null; -- first run: nothing to unschedule
  end;

  begin
    execute format(
      'select %I.schedule($1, $2, $3)',
      v_schema
    ) using v_job, '*/1 * * * *', 'select public.auto_advance_auction_if_scheduled();';

    insert into public.audit_log (action, entity_type, details)
    values (
      'pg_cron_progression_job', 'auction',
      jsonb_build_object('job_name', v_job, 'status', 'scheduled', 'server_time', clock_timestamp())
    );
  exception when others then
    insert into public.audit_log (action, entity_type, details)
    values (
      'pg_cron_progression_job_failed', 'auction',
      jsonb_build_object('job_name', v_job, 'error', sqlerrm, 'server_time', clock_timestamp())
    );
  end;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 5. Hook into settle_slot (029 version — the live definition)
--    When a slot is finalized as SOLD/UNSOLD, arm the 5-second
--    transition if an automatic progression sequence is active.
-- ─────────────────────────────────────────────────────────────
create or replace function public.settle_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot     public.slots%rowtype;
  v_balance  integer;
  v_bid_id   uuid;
  v_session  uuid;
  v_topic    text;
begin
  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Slot not found';
  end if;

  if v_slot.status <> 'open' then
    raise exception
      'Only open slots can be settled. Current status: %', v_slot.status;
  end if;

  select t.title into v_topic from public.topics t where t.id = v_slot.topic_id;

  select s.id into v_session
  from   public.auction_sessions s
  where  s.active_slot_id = p_slot_id
  limit  1;

  if v_session is null then
    select s.id into v_session
    from public.auction_sessions s
    where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                       'finalizing','question_assigned','solving')
    order by s.created_at desc
    limit 1;
  end if;

  -- ── Case A: no bids → unsold ────────────────────────────────
  if v_slot.leader_team_id is null then
    update public.slots
    set  status          = 'skipped',
         winner_team_id = null,
         timer_status   = 'completed',
         timer_paused_at = null,
         sold_at        = clock_timestamp()
    where id = p_slot_id;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(), 'slot_unsold', 'slot', p_slot_id,
      jsonb_build_object(
        'reason', 'no_bids',
        'round', v_slot.round,
        'topic_title', v_topic
      )
    );

    if v_session is not null then
      update public.auction_sessions
      set status = 'bidding_closed', updated_at = clock_timestamp()
      where id = v_session and status in ('bidding_open','finalizing');
    end if;

    -- Arm the automatic progression transition for this round.
    perform public.schedule_slot_progression(v_slot.round, p_slot_id);

    return jsonb_build_object(
      'success', true,
      'status',  'skipped',
      'outcome', 'unsold',
      'slot_id', p_slot_id,
      'topic_title', v_topic,
      'server_time', clock_timestamp()
    );
  end if;

  -- ── Case B: a winner exists → exactly one wallet debit ──────
  select b.id into v_bid_id
  from public.bids b
  where b.slot_id = p_slot_id and b.team_id = v_slot.leader_team_id
  order by b.server_time desc, b.id desc
  limit 1;

  perform public.apply_wallet_transaction(
    v_slot.leader_team_id,
    'win_deduction',
    -v_slot.current_bid,
    p_slot_id,
    v_bid_id,
    auth.uid(),
    'Winning bid for auction item',
    jsonb_build_object('round', v_slot.round, 'topic_id', v_slot.topic_id)
  );

  select w.balance into v_balance
  from public.wallets w
  where w.team_id = v_slot.leader_team_id;

  update public.slots
  set  status          = 'sold',
       winner_team_id = v_slot.leader_team_id,
       timer_status   = 'completed',
       timer_paused_at = null,
       sold_at        = clock_timestamp()
  where id = p_slot_id;

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_slot.leader_team_id, 'slot_sold', 'slot', p_slot_id,
    jsonb_build_object(
      'winner_team_id', v_slot.leader_team_id,
      'winning_bid',    v_slot.current_bid,
      'round',          v_slot.round,
      'topic_id',       v_slot.topic_id,
      'topic_title',    v_topic
    )
  );

  if v_session is not null then
    update public.auction_sessions
    set status = 'question_assigned', updated_at = clock_timestamp()
    where id = v_session and status in ('bidding_open','bidding_closed','finalizing');
  end if;

  -- Arm the automatic progression transition for this round.
  perform public.schedule_slot_progression(v_slot.round, p_slot_id);

  return jsonb_build_object(
    'success',        true,
    'status',         'sold',
    'slot_id',        p_slot_id,
    'winner_team_id', v_slot.leader_team_id,
    'winning_bid',    v_slot.current_bid,
    'new_balance',    v_balance,
    'topic_title',    v_topic,
    'server_time',    clock_timestamp()
  );
end;
$$;

revoke all on function public.settle_slot(uuid) from public;


-- ─────────────────────────────────────────────────────────────
-- 6. open_slot internals + gated entry point (023 body)
--    The admin gate stays on the RPC entry point (open_slot); the
--    body lives in open_slot_internal so the backend progression
--    driver can run the exact same opening logic from pg_cron or
--    from a non-admin reader. Bid rules, timers and SOLD/UNSOLD
--    logic are untouched, and a manual open is never blocked by the
--    automatic progression (the driver refuses to open a second live
--    slot instead — see auto_advance_auction_if_scheduled).
-- ─────────────────────────────────────────────────────────────
create or replace function public.open_slot_internal(
  p_slot_id       uuid,
  p_starting_bid  integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot      public.slots%rowtype;
  v_end       timestamptz;
  v_window    integer;
  v_min_bid   integer;
  v_session   public.auction_sessions%rowtype;
begin
  if p_starting_bid is not null and p_starting_bid <= 0 then
    raise exception 'Starting bid points must be a positive integer';
  end if;

  -- Serialise the "is another slot live?" check with the automatic
  -- progression driver, which takes the same lock: two callers can
  -- never both pass it and open two slots at once.
  perform pg_advisory_xact_lock(hashtext('bid2build_slot_open'));

  -- Only one auction item may be open at a time.
  if exists (
    select 1 from public.slots
    where status = 'open' and id <> p_slot_id
  ) then
    raise exception 'Another auction slot is already open for bidding. Close or skip it before opening a new slot.';
  end if;

  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Slot not found';
  end if;

  if v_slot.status not in ('pending', 'skipped') then
    raise exception
      'Only pending or skipped slots can be opened. Current status: %', v_slot.status;
  end if;

  -- The topic must not already have been sold.
  if exists (
    select 1 from public.slots s
    where s.topic_id = v_slot.topic_id and s.status = 'sold'
  ) then
    raise exception 'This problem statement has already been sold and cannot be auctioned again.';
  end if;

  v_window  := greatest(public.get_setting_int('opening_window_seconds', 10), 1);
  v_min_bid := coalesce(
    p_starting_bid,
    greatest(coalesce(v_slot.min_bid, 0), public.get_setting_int('min_bid', 10))
  );

  v_end := clock_timestamp() + make_interval(secs => v_window);

  -- Attach the item to the active session, if there is one.
  select * into v_session
  from public.auction_sessions s
  where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                     'finalizing','question_assigned','solving')
  order by s.created_at desc
  limit 1;

  if v_session.id is not null then
    update public.auction_sessions
    set active_slot_id = p_slot_id, updated_at = clock_timestamp()
    where id = v_session.id;
  end if;

  -- Open the slot, inheriting active session round if available
  update public.slots
  set    status           = 'open',
         current_bid      = 0,
         min_bid          = v_min_bid,
         round            = coalesce(v_session.round, v_slot.round),
         end_time         = v_end,
         leader_team_id   = null,
         winner_team_id   = null,
         timer_status     = 'running',
         timer_started_at = clock_timestamp(),
         timer_paused_at  = null,
         paused_remaining_seconds = v_window,
         sold_at          = null
  where  id = p_slot_id;

  -- Activate automatic progression for the opened slot's round.
  perform public.activate_slot_progression(
    coalesce(v_session.round, v_slot.round),
    p_slot_id
  );

  -- Triggers trg_slot_emit_event and trg_slot_log_audit record the open.
  return jsonb_build_object(
    'success',        true,
    'slot_id',        p_slot_id,
    'status',         'open',
    'round',          coalesce(v_session.round, v_slot.round),
    'end_time',       v_end,
    'window_seconds', v_window,
    'min_bid',        v_min_bid,
    'starting_bid',   v_min_bid,
    'server_time',    clock_timestamp()
  );
end;
$$;

revoke all on function public.open_slot_internal(uuid, integer) from public, anon, authenticated;
grant execute on function public.open_slot_internal(uuid, integer) to service_role;


-- ─────────────────────────────────────────────────────────────
-- 6b. open_slot — the admin RPC entry point (unchanged behaviour)
-- ─────────────────────────────────────────────────────────────
create or replace function public.open_slot(
  p_slot_id       uuid,
  p_starting_bid  integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to open auction slots';
  end if;

  return public.open_slot_internal(p_slot_id, p_starting_bid);
end;
$$;

revoke all on function public.open_slot(uuid, integer) from public;
grant execute on function public.open_slot(uuid, integer) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 6c. open_bidding — internal body (020) + gated entry point
-- ─────────────────────────────────────────────────────────────
create or replace function public.open_bidding_internal(p_slot_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_target  uuid;
  v_result  jsonb;
begin
  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session. Start the auction first.';
  end if;

  v_target := coalesce(p_slot_id, v_session.active_slot_id);
  if v_target is null then
    raise exception 'Select a problem statement before opening bidding';
  end if;

  v_result := public.open_slot_internal(v_target);

  update public.auction_sessions
  set status         = 'bidding_open',
      is_paused      = false,
      active_slot_id = v_target,
      updated_at     = clock_timestamp()
  where id = v_session.id;

  return v_result || jsonb_build_object('session_id', v_session.id, 'session_status', 'bidding_open');
end;
$$;

revoke all on function public.open_bidding_internal(uuid) from public, anon, authenticated;
grant execute on function public.open_bidding_internal(uuid) to service_role;


create or replace function public.open_bidding(p_slot_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to open bidding';
  end if;

  return public.open_bidding_internal(p_slot_id);
end;
$$;

revoke all on function public.open_bidding(uuid) from public;
grant execute on function public.open_bidding(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 6d. select_auction_question — internal body (015) + gated entry
-- ─────────────────────────────────────────────────────────────
create or replace function public.select_auction_question_internal(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot    public.slots%rowtype;
  v_session public.auction_sessions%rowtype;
  v_topic   public.topics%rowtype;
begin
  select * into v_slot
  from public.slots s
  where s.id = p_slot_id
  for update;

  if not found then
    raise exception 'Auction slot not found';
  end if;

  if v_slot.status <> 'pending' then
    raise exception 'Only a pending auction item can be selected. Current status: %', v_slot.status;
  end if;

  if exists (
    select 1 from public.slots s
    where s.topic_id = v_slot.topic_id and s.status = 'sold'
  ) then
    raise exception 'This problem statement has already been sold and cannot be auctioned again.';
  end if;

  select * into v_topic from public.topics t where t.id = v_slot.topic_id;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session. Start the auction first.';
  end if;

  update public.slots
  set session_id = v_session.id
  where id = p_slot_id;

  update public.auction_sessions
  set active_slot_id = p_slot_id,
      status         = 'question_selection',
      updated_at     = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'question_selected', 'slot', p_slot_id,
    jsonb_build_object('topic_id', v_slot.topic_id, 'title', v_topic.title, 'session_id', v_session.id)
  );

  return jsonb_build_object(
    'success',     true,
    'slot_id',     p_slot_id,
    'topic_id',    v_slot.topic_id,
    'topic_title', v_topic.title,
    'level',       v_topic.level,
    'session_id',  v_session.id,
    'status',      'question_selection',
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.select_auction_question_internal(uuid) from public, anon, authenticated;
grant execute on function public.select_auction_question_internal(uuid) to service_role;


create or replace function public.select_auction_question(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to select an auction question';
  end if;

  return public.select_auction_question_internal(p_slot_id);
end;
$$;

revoke all on function public.select_auction_question(uuid) from public;
grant execute on function public.select_auction_question(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 7. get_live_auction_state() (026 definition, extended)
--    a) Drives the automatic progression on every read, wrapped so
--       a failure there can never break the state read, and
--    b) exposes the progression snapshot (`auto_progression`) so
--       clients can render the backend-scheduled 5-second
--       countdown without owning any timing logic.
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_live_auction_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session   public.auction_sessions%rowtype;
  v_slot      public.slots%rowtype;
  v_topic     public.topics%rowtype;
  v_leader    text;
  v_winner    text;
  v_teams     jsonb;
  v_bids      jsonb;
  v_settings  jsonb;
  v_events    jsonb;
  v_elims     jsonb;
  v_prog      jsonb;
  v_has_slot  boolean := false;
  v_min_bid   integer := 10;
  v_min_raise integer := 5;
begin
  -- ── 0. Settle any expired item first ────────────────────────
  perform public.settle_expired_slots();

  -- ── 0b. Tick the automatic slot progression ─────────────────
  -- Backend-authoritative 5-second advance: this keeps the
  -- progression moving for every reader (admin, participants,
  -- projector) even though no frontend timer is trusted as the
  -- source of truth. Never allowed to break the state read.
  begin
    perform public.auto_advance_auction_if_scheduled();
  exception when others then
    begin
      insert into public.audit_log (action, entity_type, details)
      values (
        'auto_advance_failed', 'auction',
        jsonb_build_object('via', 'get_live_auction_state', 'error', sqlerrm, 'server_time', clock_timestamp())
      );
    exception when others then
      null;
    end;
  end;

  v_min_bid   := greatest(public.get_setting_int('min_bid', 10), 1);
  v_min_raise := greatest(public.get_setting_int('min_raise', 5), 1);

  -- Progression snapshot: a pending transition wins, then the most
  -- recently touched round sequence.
  select jsonb_build_object(
           'active',                  p.auto_active,
           'round',                   p.round,
           'transition_pending',      p.transition_pending,
           'scheduled_transition_at', p.scheduled_transition_at,
           'round_complete',          p.round_complete,
           'message',                 p.message
         )
  into   v_prog
  from   public.auction_slot_progressions p
  order  by (case when p.transition_pending then 0
                  when p.auto_active then 1
                  else 2 end),
           p.updated_at desc
  limit  1;

  v_prog := coalesce(v_prog, jsonb_build_object(
    'active', false,
    'round', null,
    'transition_pending', false,
    'scheduled_transition_at', null,
    'round_complete', false,
    'message', null
  ));

  select * into v_session from public.get_active_session() limit 1;

  -- Find the active open slot
  select s.* into v_slot
  from public.slots s
  where s.status = 'open'
  order by s.round, s.question_number nulls last, s.id
  limit 1;
  v_has_slot := found;

  if not v_has_slot and v_session.active_slot_id is not null then
    select s.* into v_slot from public.slots s where s.id = v_session.active_slot_id;
    v_has_slot := found;
  end if;

  if v_has_slot and v_slot.topic_id is not null then
    select t.* into v_topic from public.topics t where t.id = v_slot.topic_id;
  end if;

  if v_has_slot and v_slot.leader_team_id is not null then
    select t.name into v_leader from public.teams t where t.id = v_slot.leader_team_id;
  end if;

  if v_has_slot and v_slot.winner_team_id is not null then
    select t.name into v_winner from public.teams t where t.id = v_slot.winner_team_id;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',         b.id,
             'slot_id',    b.slot_id,
             'team_id',    b.team_id,
             'team_name',  coalesce(t.name, 'Unknown team'),
             'amount',     b.amount,
             'server_time', b.server_time
           ) order by b.server_time desc
         ), '[]'::jsonb)
  into v_bids
  from public.bids b
  left join public.teams t on t.id = b.team_id
  where v_has_slot and b.slot_id = v_slot.id;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',              t.id,
             'name',            t.name,
             'character_index', t.character_index,
             'balance',         coalesce(w.balance, 0),
             'eliminated',      public.team_is_eliminated(t.id),
             'current_bid',     coalesce(lb.amount, 0),
             'won_count',       coalesce(wq.cnt, 0),
             'qualified',       (coalesce(wq.cnt, 0) >= 2),
             'needs_questions', (coalesce(wq.cnt, 0) < 2)
           ) order by t.name
         ), '[]'::jsonb)
  into v_teams
  from public.teams t
  left join public.wallets w on w.team_id = t.id
  left join lateral (
    select count(*) as cnt
    from public.slots s
    where s.winner_team_id = t.id and s.status = 'sold'
  ) wq on true
  left join lateral (
    select max(b.amount) as amount
    from public.bids b
    where b.team_id = t.id and v_has_slot and b.slot_id = v_slot.id
  ) lb on true;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  into v_settings
  from public.settings
  where key in ('min_bid','min_raise','opening_window_seconds','timer_extension_seconds',
                'bonus_time_seconds','solving_timer_seconds','starting_wallet_balance',
                'bonus_points_rate');

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',               e.id,
             'event_type',       e.event_type,
             'slot_id',          e.slot_id,
             'team_id',          e.team_id,
             'payload',          e.payload,
             'timer_ends_at',    e.timer_ends_at,
             'timer_status',     e.timer_status,
             'server_timestamp', e.server_timestamp
           ) order by e.server_timestamp desc
         ), '[]'::jsonb)
  into v_events
  from (
    select * from public.auction_events
    order by server_timestamp desc
    limit 40
  ) e;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'team_id',       el.team_id,
             'team_name',     t.name,
             'rule',          el.rule,
             'reason',        el.reason,
             'eliminated_at', el.eliminated_at
           ) order by el.eliminated_at desc
         ), '[]'::jsonb)
  into v_elims
  from public.team_eliminations el
  join public.teams t on t.id = el.team_id
  where el.restored_at is null;

  return jsonb_build_object(
    'server_time', clock_timestamp(),
    'total_items',  (select count(*) from public.slots),
    'items_sold',   (select count(*) from public.slots where status = 'sold'),
    'items_unsold', (select count(*) from public.slots where status in ('skipped', 'pending') and not exists (select 1 from public.slots k where k.topic_id = public.slots.topic_id and k.status = 'sold')),
    'items_open',   (select count(*) from public.slots where status = 'open'),
    'session', case when v_session.id is null then null else jsonb_build_object(
      'id',         v_session.id,
      'status',     v_session.status,
      'round',      v_session.round,
      'is_paused',  v_session.is_paused,
      'timer_status', v_session.timer_status,
      'timer_ends_at', v_session.timer_ends_at,
      'paused_remaining_seconds', v_session.paused_remaining_seconds,
      'total_bonus_seconds', v_session.total_bonus_seconds,
      'total_manual_extension_seconds', v_session.total_manual_extension_seconds,
      'active_slot_id', v_session.active_slot_id
    ) end,
    'active_slot', case when v_slot.id is null then null else jsonb_build_object(
      'id',           v_slot.id,
      'status',       v_slot.status,
      'round',        v_slot.round,
      'current_bid',  v_slot.current_bid,
      'min_bid',      v_slot.min_bid,
      'min_next_bid', case when v_slot.leader_team_id is null
                            then greatest(coalesce(v_slot.min_bid, 0), v_min_bid)
                            else v_slot.current_bid + v_min_raise end,
      'leader_team_id', v_slot.leader_team_id,
      'leader_team_name', v_leader,
      'winner_team_id', v_slot.winner_team_id,
      'winner_team_name', v_winner,
      'end_time',     v_slot.end_time,
      'timer_status', v_slot.timer_status,
      'paused_remaining_seconds', v_slot.paused_remaining_seconds,
      'question_number', v_slot.question_number,
      'topic', case when v_topic.id is null then null else jsonb_build_object(
        'id',          v_topic.id,
        'level',       v_topic.level,
        'title',       v_topic.title,
        'description', v_topic.description,
        'criterion',   v_topic.criterion
      ) end
    ) end,
    'bids',            coalesce(v_bids, '[]'::jsonb),
    'teams',           coalesce(v_teams, '[]'::jsonb),
    'settings',        coalesce(v_settings, '{}'::jsonb),
    'events',          coalesce(v_events, '[]'::jsonb),
    'eliminations',    coalesce(v_elims, '[]'::jsonb),
    'auto_progression', v_prog
  );
end;
$$;

revoke all on function public.get_live_auction_state() from public;
grant execute on function public.get_live_auction_state() to authenticated, anon, service_role;


-- ─────────────────────────────────────────────────────────────
-- 8. reset_auction() (037 definition, extended)
--    A full reset must also cancel any in-flight automatic slot
--    progression, otherwise a pending 5-second transition could
--    reopen a slot right after a reset.
-- ─────────────────────────────────────────────────────────────
create or replace function public.reset_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starting_balance      integer;
  v_bids_deleted          integer;
  v_slots_reset           integer;
  v_wallets_reset         integer;
  v_ledger_cleared        integer;
  v_submissions_deleted   integer;
  v_evaluations_deleted   integer;
  v_bonus_deleted         integer;
  v_progressions_cleared  integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to reset auction';
  end if;

  lock table public.slots                    in exclusive mode;
  lock table public.bids                     in exclusive mode;
  lock table public.wallets                  in exclusive mode;
  lock table public.submissions              in exclusive mode;
  lock table public.evaluations              in exclusive mode;
  lock table public.bonus_transactions       in exclusive mode;
  lock table public.auction_slot_progressions in exclusive mode;

  v_starting_balance := public.get_setting_int('starting_wallet_balance', 100);
  if v_starting_balance is null or v_starting_balance <= 0 then
    v_starting_balance := 100;
  end if;

  delete from public.bids where id is not null;
  get diagnostics v_bids_deleted = row_count;

  -- The ledger describes the current contest state; a full reset
  -- invalidates it. The reset itself is permanently recorded in
  -- audit_log below.
  delete from public.wallet_transactions where id is not null;
  get diagnostics v_ledger_cleared = row_count;

  -- Submissions belong to an auction allocation: once the allocation is
  -- reset they must disappear too, otherwise the Bidding Results and
  -- Submission pages keep showing the old winners and solutions.
  -- evaluations, eval_updates and bonus_transactions cascade from here.
  select count(*) into v_evaluations_deleted from public.evaluations;
  select count(*) into v_bonus_deleted from public.bonus_transactions;

  delete from public.submissions where id is not null;
  get diagnostics v_submissions_deleted = row_count;

  -- Defensive: cascades should already have removed these.
  delete from public.evaluations where id is not null;
  delete from public.bonus_transactions where id is not null;

  -- Cancel the automatic slot progression sequences (038): a reset
  -- must not leave a scheduled transition that reopens a slot.
  delete from public.auction_slot_progressions where round is not null;
  get diagnostics v_progressions_cleared = row_count;

  update public.slots
  set status                   = 'pending',
      current_bid              = 0,
      min_bid                  = public.get_setting_int('min_bid', 10),
      leader_team_id           = null,
      winner_team_id           = null,
      end_time                 = null,
      timer_status             = 'idle',
      timer_started_at         = null,
      timer_paused_at          = null,
      paused_remaining_seconds = 0,
      total_bonus_seconds      = 0,
      total_manual_extension_seconds = 0,
      session_id               = null,
      sold_at                  = null
  where id is not null;
  get diagnostics v_slots_reset = row_count;

  insert into public.wallets (team_id, balance)
  select id, v_starting_balance from public.teams
  on conflict (team_id) do update set balance = v_starting_balance;
  get diagnostics v_wallets_reset = row_count;

  -- Cancel the advance guard: a reset must not let a queued 3-second
  -- transition reopen a slot afterwards.
  update public.settings set value = 'false' where key = 'auction_advancing';
  update public.settings set value = null    where key = 'next_auction_open_at';

  update public.auction_sessions
  set status = 'cancelled', ended_at = clock_timestamp(), updated_at = clock_timestamp()
  where status not in ('completed', 'cancelled');

  insert into public.audit_log (action, entity_type, entity_id, details)
  values (
    'auction_reset', 'auction', null,
    jsonb_build_object(
      'slots_reset',              v_slots_reset,
      'bids_deleted',             v_bids_deleted,
      'wallets_reset',            v_wallets_reset,
      'ledger_cleared',           v_ledger_cleared,
      'submissions_deleted',      v_submissions_deleted,
      'evaluations_deleted',      v_evaluations_deleted,
      'bonus_transactions_deleted', v_bonus_deleted,
      'progressions_cleared',     v_progressions_cleared,
      'starting_balance',         v_starting_balance,
      'timestamp',                clock_timestamp()
    )
  );

  return jsonb_build_object(
    'success',                    true,
    'slots_reset',                v_slots_reset,
    'bids_deleted',               v_bids_deleted,
    'wallets_reset',              v_wallets_reset,
    'ledger_cleared',             v_ledger_cleared,
    'submissions_deleted',        v_submissions_deleted,
    'evaluations_deleted',        v_evaluations_deleted,
    'bonus_transactions_deleted', v_bonus_deleted,
    'progressions_cleared',       v_progressions_cleared,
    'starting_balance',           v_starting_balance,
    'server_time',                clock_timestamp()
  );
end;
$$;

comment on function public.reset_auction() is
  'Full, audited auction reset: slots, bids, ledger, wallets, submissions, evaluations and bonus time. Cancels active sessions, the advance guard and any automatic slot progression.';

revoke all on function public.reset_auction() from public;
grant execute on function public.reset_auction() to authenticated;

notify pgrst, 'reload schema';
