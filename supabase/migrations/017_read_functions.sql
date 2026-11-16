-- ============================================================
-- Migration 017: Authoritative read functions
-- ============================================================
-- These are the single source of truth for every client. A client
-- always loads the authoritative state first and then applies the
-- incremental events from public.auction_events.
--
-- All payloads are public-safe: no member e-mails, no repository
-- URLs, no judge notes, no private submissions.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. get_live_auction_state — the whole live picture
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_live_auction_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session  public.auction_sessions%rowtype;
  v_slot     public.slots%rowtype;
  v_topic    public.topics%rowtype;
  v_leader   text;
  v_winner   text;
  v_bids     jsonb;
  v_teams    jsonb;
  v_settings jsonb;
  v_events   jsonb;
  v_elims    jsonb;
  v_min_raise integer;
  v_min_bid   integer;
  v_has_slot  boolean := false;
begin
  v_min_raise := greatest(public.get_setting_int('min_raise', 10), 1);
  v_min_bid   := public.get_setting_int('min_bid', 10);

  select * into v_session from public.get_active_session() limit 1;

  select s.* into v_slot
  from public.slots s
  where s.status = 'open'
  order by s.round, s.question_number nulls last, s.id
  limit 1;

  if found then
    v_has_slot := true;
  elsif v_session.active_slot_id is not null then
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

  -- Recent bids for the live item
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

  -- Active teams with their balance and elimination state
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',         t.id,
             'name',       t.name,
             'balance',    coalesce(w.balance, 0),
             'eliminated', public.team_is_eliminated(t.id),
             'current_bid', coalesce(lb.amount, 0)
           ) order by t.name
         ), '[]'::jsonb)
  into v_teams
  from public.teams t
  left join public.wallets w on w.team_id = t.id
  left join lateral (
    select max(b.amount) as amount
    from public.bids b
    where b.team_id = t.id and v_has_slot and b.slot_id = v_slot.id
  ) lb on true;

  -- Configuration snapshot
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  into v_settings
  from public.settings
  where key in ('min_bid','min_raise','opening_window_seconds','timer_extension_seconds',
                'bonus_time_seconds','solving_timer_seconds','starting_wallet_balance',
                'bonus_points_rate');

  -- Recent public events
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

  -- Active eliminations
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'team_id',   el.team_id,
             'team_name', t.name,
             'rule',      el.rule,
             'reason',    el.reason,
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
                            then greatest(coalesce(v_slot.min_bid, v_min_bid), v_min_bid)
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
    'bids',          coalesce(v_bids, '[]'::jsonb),
    'teams',         coalesce(v_teams, '[]'::jsonb),
    'settings',      coalesce(v_settings, '{}'::jsonb),
    'events',        coalesce(v_events, '[]'::jsonb),
    'eliminations',  coalesce(v_elims, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_live_auction_state() from public;
grant execute on function public.get_live_auction_state() to authenticated, anon, service_role;


-- ─────────────────────────────────────────────────────────────
-- 2. get_current_auction_item
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_current_auction_item()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
begin
  v_state := public.get_live_auction_state();
  return coalesce(v_state -> 'active_slot', 'null'::jsonb);
end;
$$;

revoke all on function public.get_current_auction_item() from public;
grant execute on function public.get_current_auction_item() to authenticated, anon, service_role;


-- ─────────────────────────────────────────────────────────────
-- 3. get_auction_history — concluded items
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_auction_history(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'slot_id',         s.id,
          'slot_number',     s.question_number,
          'round',           s.round,
          'status',          s.status,
          'topic_id',        s.topic_id,
          'topic_title',     t.title,
          'current_bid',     s.current_bid,
          'winning_bid',     case when s.status = 'sold' then s.current_bid else 0 end,
          'winner_team_id',  s.winner_team_id,
          'winner_team_name', wt.name,
          'leader_team_id',  s.leader_team_id,
          'leader_team_name', lt.name,
          'sold_at',         s.sold_at,
          'end_time',        s.end_time
        ) order by s.round, s.question_number nulls last, s.id
      )
      from public.slots s
      join public.topics t on t.id = s.topic_id
      left join public.teams wt on wt.id = s.winner_team_id
      left join public.teams lt on lt.id = s.leader_team_id
      where s.status in ('sold', 'skipped')
        and (p_limit is null or p_limit <= 0 or s.question_number <= p_limit)
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_auction_history(integer) from public;
grant execute on function public.get_auction_history(integer) to authenticated, anon, service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. get_team_bid_history
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_team_bid_history(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  v_caller := public.current_team_id();

  if not (public.is_admin() or v_caller = p_team_id) then
    raise exception 'Not authorised to read the bid history of team %', p_team_id;
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id',          b.id,
          'slot_id',     b.slot_id,
          'amount',      b.amount,
          'server_time', b.server_time,
          'topic_title', t.title,
          'slot_status', s.status,
          'is_winning_bid', (s.leader_team_id = b.team_id and s.status = 'open')
        ) order by b.server_time desc
      )
      from public.bids b
      join public.slots s on s.id = b.slot_id
      join public.topics t on t.id = s.topic_id
      where b.team_id = p_team_id
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_team_bid_history(uuid) from public;
grant execute on function public.get_team_bid_history(uuid) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 5. get_team_auction_state — everything a team may see
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_team_auction_state(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_balance integer;
  v_spent   integer;
begin
  v_caller := public.current_team_id();

  if not (public.is_admin() or v_caller = p_team_id) then
    raise exception 'Not authorised to read the auction state of team %', p_team_id;
  end if;

  select w.balance into v_balance from public.wallets w where w.team_id = p_team_id;

  select coalesce(sum(-t.amount), 0) into v_spent
  from public.wallet_transactions t
  where t.team_id = p_team_id and t.tx_type = 'win_deduction';

  return jsonb_build_object(
    'team_id',    p_team_id,
    'balance',    coalesce(v_balance, 0),
    'spent',      v_spent,
    'eliminated', public.team_is_eliminated(p_team_id),
    'elimination', (
      select jsonb_build_object('rule', e.rule, 'reason', e.reason, 'eliminated_at', e.eliminated_at)
      from public.team_eliminations e
      where e.team_id = p_team_id and e.restored_at is null
      order by e.eliminated_at desc limit 1
    ),
    'won_slots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'slot_id',     s.id,
          'round',       s.round,
          'topic_title', t.title,
          'winning_bid', s.current_bid,
          'sold_at',     s.sold_at
        ) order by s.round
      )
      from public.slots s
      join public.topics t on t.id = s.topic_id
      where s.winner_team_id = p_team_id and s.status = 'sold'
    ), '[]'::jsonb),
    'bids', public.get_team_bid_history(p_team_id),
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_team_auction_state(uuid) from public;
grant execute on function public.get_team_auction_state(uuid) to authenticated, service_role;
