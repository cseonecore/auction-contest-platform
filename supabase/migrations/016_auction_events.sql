-- ============================================================
-- Migration 016: Normalised auction event stream
-- ============================================================
-- One append-only table carries every live auction event. The
-- participant arena, the admin console and the projector all
-- subscribe to THIS table, so they cannot drift apart and there
-- is a single event contract for the whole platform.
--
-- Event payload is PUBLIC-SAFE by construction: it contains
-- team names, bid amounts, topic titles and timer information
-- only — never member data, repository URLs or judge notes.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Event table
-- ─────────────────────────────────────────────────────────────
create table if not exists public.auction_events (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid references public.auction_sessions(id) on delete set null,
  event_type       text not null,
  slot_id          uuid,
  team_id          uuid,
  payload          jsonb not null default '{}'::jsonb,
  timer_ends_at    timestamptz,
  timer_status     text,
  server_timestamp timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

comment on table public.auction_events is
  'Append-only live event stream. Clients reconcile from the authoritative '
  'state (get_live_auction_state) and then apply these events.';

create index if not exists idx_auction_events_created on public.auction_events (created_at desc);
create index if not exists idx_auction_events_session on public.auction_events (session_id, created_at desc);
create index if not exists idx_auction_events_type on public.auction_events (event_type);


-- ─────────────────────────────────────────────────────────────
-- 2. Emitter helper
-- ─────────────────────────────────────────────────────────────
create or replace function public.emit_auction_event(
  p_event_type text,
  p_slot_id    uuid default null,
  p_team_id    uuid default null,
  p_payload    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_ends_at   timestamptz;
  v_status    text;
begin
  select s.id, s.timer_ends_at, s.timer_status
  into   v_session_id, v_ends_at, v_status
  from   public.auction_sessions s
  where  s.status in ('ready','question_selection','bidding_open','bidding_closed',
                       'finalizing','question_assigned','solving')
  order  by s.created_at desc
  limit  1;

  insert into public.auction_events (
    session_id, event_type, slot_id, team_id, payload, timer_ends_at, timer_status
  )
  values (
    v_session_id, p_event_type, p_slot_id, p_team_id,
    coalesce(p_payload, '{}'::jsonb), v_ends_at, v_status
  );
end;
$$;

revoke all on function public.emit_auction_event(text, uuid, uuid, jsonb) from public;
grant execute on function public.emit_auction_event(text, uuid, uuid, jsonb) to service_role;


-- ─────────────────────────────────────────────────────────────
-- 3. Slot trigger — lifecycle + highest bid + timer changes
-- ─────────────────────────────────────────────────────────────
create or replace function public.trg_slots_emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic_title text;
  v_leader_name text;
  v_winner_name text;
begin
  select t.title into v_topic_title
  from public.topics t
  where t.id = new.topic_id;

  if new.leader_team_id is not null then
    select t.name into v_leader_name
    from public.teams t
    where t.id = new.leader_team_id;
  end if;

  if new.winner_team_id is not null then
    select t.name into v_winner_name
    from public.teams t
    where t.id = new.winner_team_id;
  end if;

  if (tg_op = 'INSERT') then
    perform public.emit_auction_event(
      case when new.status = 'open' then 'bidding_opened' else 'question_selected' end,
      new.id,
      new.leader_team_id,
      jsonb_build_object(
        'slot_id',       new.id,
        'status',        new.status,
        'round',         new.round,
        'topic_title',   v_topic_title,
        'current_bid',   new.current_bid,
        'leader_name',   v_leader_name,
        'end_time',      new.end_time,
        'timer_status',  new.timer_status
      )
    );
    return new;
  end if;

  -- Status transitions
  if new.status is distinct from old.status then
    perform public.emit_auction_event(
      case new.status
        when 'open'   then 'bidding_opened'
        when 'sold'   then 'auction_finalized'
        when 'skipped' then 'bidding_closed'
        else 'slot_updated'
      end,
      new.id,
      coalesce(new.winner_team_id, new.leader_team_id),
      jsonb_build_object(
        'slot_id',      new.id,
        'status',       new.status,
        'previous_status', old.status,
        'round',        new.round,
        'topic_title',  v_topic_title,
        'current_bid',  new.current_bid,
        'leader_name',  v_leader_name,
        'winner_name',  v_winner_name,
        'winning_bid',  new.current_bid,
        'end_time',     new.end_time
      )
    );
  end if;

  -- Highest bid changed
  if new.current_bid is distinct from old.current_bid and new.status = 'open' then
    perform public.emit_auction_event(
      'highest_bid_changed',
      new.id,
      new.leader_team_id,
      jsonb_build_object(
        'slot_id',     new.id,
        'current_bid', new.current_bid,
        'previous_bid', old.current_bid,
        'leader_name', v_leader_name,
        'end_time',    new.end_time
      )
    );
  end if;

  -- Timer state changed
  if new.timer_status is distinct from old.timer_status then
    perform public.emit_auction_event(
      case new.timer_status
        when 'paused' then 'timer_paused'
        when 'running' then 'timer_resumed'
        else 'timer_updated'
      end,
      new.id,
      null,
      jsonb_build_object(
        'slot_id',      new.id,
        'timer_status', new.timer_status,
        'end_time',     new.end_time,
        'paused_remaining_seconds', new.paused_remaining_seconds
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_slots_emit_event on public.slots;
create trigger trg_slots_emit_event
  after insert or update on public.slots
  for each row execute function public.trg_slots_emit_event();


-- ─────────────────────────────────────────────────────────────
-- 4. Bid trigger
-- ─────────────────────────────────────────────────────────────
create or replace function public.trg_bids_emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
  v_slot      public.slots%rowtype;
begin
  select t.name into v_team_name
  from public.teams t
  where t.id = new.team_id;

  select * into v_slot from public.slots s where s.id = new.slot_id;

  perform public.emit_auction_event(
    'bid_placed',
    new.slot_id,
    new.team_id,
    jsonb_build_object(
      'bid_id',      new.id,
      'slot_id',     new.slot_id,
      'team_id',     new.team_id,
      'team_name',   v_team_name,
      'amount',      new.amount,
      'current_bid', v_slot.current_bid,
      'end_time',    v_slot.end_time,
      'server_time', new.server_time
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_bids_emit_event on public.bids;
create trigger trg_bids_emit_event
  after insert on public.bids
  for each row execute function public.trg_bids_emit_event();


-- ─────────────────────────────────────────────────────────────
-- 5. Wallet ledger trigger (public, sanitised)
-- ─────────────────────────────────────────────────────────────
create or replace function public.trg_wallet_tx_emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
begin
  select t.name into v_team_name
  from public.teams t
  where t.id = new.team_id;

  perform public.emit_auction_event(
    case when new.tx_type = 'win_deduction' then 'auction_finalized' else 'points_changed' end,
    new.slot_id,
    new.team_id,
    jsonb_build_object(
      'team_id',       new.team_id,
      'team_name',     v_team_name,
      'tx_type',       new.tx_type,
      'amount',        new.amount,
      'balance_after', new.balance_after
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_wallet_tx_emit_event on public.wallet_transactions;
create trigger trg_wallet_tx_emit_event
  after insert on public.wallet_transactions
  for each row execute function public.trg_wallet_tx_emit_event();


-- ─────────────────────────────────────────────────────────────
-- 6. Bonus trigger
-- ─────────────────────────────────────────────────────────────
create or replace function public.trg_bonus_emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
begin
  select t.name into v_team_name
  from public.teams t
  where t.id = new.team_id;

  perform public.emit_auction_event(
    'bonus_time_granted',
    new.slot_id,
    new.team_id,
    jsonb_build_object(
      'team_id',       new.team_id,
      'team_name',     v_team_name,
      'slot_id',       new.slot_id,
      'bonus_seconds', new.bonus_seconds,
      'reason',        new.reason
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_bonus_emit_event on public.bonus_transactions;
create trigger trg_bonus_emit_event
  after insert on public.bonus_transactions
  for each row execute function public.trg_bonus_emit_event();


-- ─────────────────────────────────────────────────────────────
-- 7. Elimination trigger
-- ─────────────────────────────────────────────────────────────
create or replace function public.trg_elimination_emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
begin
  select t.name into v_team_name
  from public.teams t
  where t.id = new.team_id;

  if (tg_op = 'INSERT') then
    perform public.emit_auction_event(
      'team_eliminated',
      null,
      new.team_id,
      jsonb_build_object(
        'team_id',   new.team_id,
        'team_name', v_team_name,
        'rule',      new.rule,
        'reason',    new.reason
      )
    );
  elsif new.restored_at is not null and old.restored_at is null then
    perform public.emit_auction_event(
      'team_restored',
      null,
      new.team_id,
      jsonb_build_object(
        'team_id',   new.team_id,
        'team_name', v_team_name
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_elimination_emit_event on public.team_eliminations;
create trigger trg_elimination_emit_event
  after insert or update on public.team_eliminations
  for each row execute function public.trg_elimination_emit_event();


-- ─────────────────────────────────────────────────────────────
-- 8. RLS — the projector reads this table without a session
-- ─────────────────────────────────────────────────────────────
alter table public.auction_events enable row level security;

drop policy if exists "Public view auction events" on public.auction_events;
create policy "Public view auction events"
on public.auction_events
for select
to authenticated, anon
using (true);

revoke insert, update, delete on public.auction_events from authenticated, anon;
grant select on public.auction_events to authenticated, anon;
grant insert, update, delete on public.auction_events to service_role;
