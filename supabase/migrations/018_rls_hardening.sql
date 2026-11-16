-- ============================================================
-- Migration 018: RLS hardening, realtime publication, grants
-- ============================================================
-- 1. Realtime publication — postgres_changes only fires for
--    tables that are members of the publication. Without this the
--    live interfaces silently degrade to polling.
-- 2. Column-level lockdown of the hidden evaluation data
--    (challenge_problems.test_cases) so a participant can never
--    read the answers.
-- 3. Explicit grants for the new RPCs.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Realtime publication
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'slots', 'bids', 'wallets', 'settings', 'teams',
    'auction_sessions', 'auction_events',
    'wallet_transactions', 'bonus_transactions', 'team_eliminations'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    exception
      when duplicate_object then null;
      when undefined_object then null;   -- publication not present (non-Supabase Postgres)
    end;
  end loop;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 2. Hide the hidden evaluation data
-- ─────────────────────────────────────────────────────────────
-- challenge_problems.test_cases holds the reference answers and
-- test data. It must never be readable by a participant.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'challenge_problems'
      and column_name = 'test_cases'
  ) then
    execute 'revoke select on public.challenge_problems from authenticated, anon';
    execute 'grant select (id, topic_id, title, description, difficulty, points, created_at) '
         || 'on public.challenge_problems to authenticated, anon';
  end if;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 3. Explicit function grants
-- ─────────────────────────────────────────────────────────────
grant execute on function public.place_bid(uuid, integer) to authenticated;
grant execute on function public.open_slot(uuid, integer) to authenticated;
grant execute on function public.close_slot(uuid) to authenticated;
grant execute on function public.skip_slot(uuid) to authenticated;
grant execute on function public.reset_auction() to authenticated;
grant execute on function public.create_auction_topic(text, text, text, integer, jsonb, integer) to authenticated;

grant execute on function public.start_auction(integer) to authenticated;
grant execute on function public.select_auction_question(uuid) to authenticated;
grant execute on function public.open_bidding(uuid) to authenticated;
grant execute on function public.close_bidding(uuid) to authenticated;
grant execute on function public.finalize_auction(uuid) to authenticated;
grant execute on function public.advance_auction() to authenticated;
grant execute on function public.pause_auction() to authenticated;
grant execute on function public.resume_auction() to authenticated;
grant execute on function public.end_auction_session() to authenticated;

grant execute on function public.start_auction_timer(integer) to authenticated;
grant execute on function public.pause_auction_timer() to authenticated;
grant execute on function public.resume_auction_timer() to authenticated;
grant execute on function public.adjust_auction_timer(integer, text) to authenticated;
grant execute on function public.adjust_bidding_timer(integer, uuid, text) to authenticated;

grant execute on function public.eliminate_team(uuid, text, text) to authenticated;
grant execute on function public.restore_team(uuid, text) to authenticated;
grant execute on function public.get_elimination_history() to authenticated;

grant execute on function public.approve_submission(uuid, numeric, text, boolean) to authenticated;
grant execute on function public.grant_bonus_time(uuid, text) to authenticated;
grant execute on function public.get_bonus_history() to authenticated;

grant execute on function public.get_live_auction_state() to authenticated, anon;
grant execute on function public.get_current_auction_item() to authenticated, anon;
grant execute on function public.get_auction_history(integer) to authenticated, anon;
grant execute on function public.get_team_bid_history(uuid) to authenticated;
grant execute on function public.get_team_auction_state(uuid) to authenticated;
grant execute on function public.get_team_points_balance(uuid) to authenticated;

grant execute on function public.get_setting_int(text, integer) to authenticated, anon;
grant execute on function public.team_is_eliminated(uuid) to authenticated, anon;
grant execute on function public.get_active_session() to authenticated, anon;

-- The ledger writer is engine-only.
revoke execute on function public.apply_wallet_transaction(uuid, text, integer, uuid, uuid, uuid, text, jsonb)
  from authenticated, anon, public;
grant execute on function public.apply_wallet_transaction(uuid, text, integer, uuid, uuid, uuid, text, jsonb)
  to service_role;

-- The event emitter is trigger-only.
revoke execute on function public.emit_auction_event(text, uuid, uuid, jsonb)
  from authenticated, anon, public;
grant execute on function public.emit_auction_event(text, uuid, uuid, jsonb)
  to service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. Table grants that back the RLS policies
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Public view auction sessions" on public.auction_sessions;
create policy "Public view auction sessions"
on public.auction_sessions
for select
to authenticated, anon
using (true);

grant select on public.auction_sessions to authenticated, anon;
grant select on public.auction_events to authenticated, anon;
grant select on public.wallets to authenticated;
grant select on public.bids to authenticated, anon;
grant select on public.slots to authenticated, anon;
grant select on public.teams to authenticated, anon;
grant select on public.topics to authenticated, anon;
grant select on public.settings to authenticated, anon;
grant select on public.wallet_transactions to authenticated;
grant select on public.bonus_transactions to authenticated;
grant select on public.team_eliminations to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Write lockdown
-- ─────────────────────────────────────────────────────────────
-- Balances, ledger entries, bonuses, eliminations, events and
-- sessions are written ONLY by SECURITY DEFINER engine functions.
-- This makes "no client-side point manipulation" a database
-- guarantee, not a convention.
revoke insert, update, delete on
  public.wallets,
  public.wallet_transactions,
  public.bonus_transactions,
  public.team_eliminations,
  public.auction_events,
  public.auction_sessions,
  public.submissions,
  public.evaluations,
  public.eval_updates,
  public.audit_log
  from authenticated, anon;

-- Auction items and bids are written only through the engine RPCs.
revoke insert, update, delete on public.slots, public.bids from authenticated, anon;

-- Topics, teams and settings keep their admin-only RLS policies:
-- the admin console edits settings and the team lock directly
-- through the authenticated browser client.
