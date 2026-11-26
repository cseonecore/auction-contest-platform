-- ═══════════════════════════════════════════════════════════════════
-- 037 · Full auction reset also erases submissions and their results
-- ═══════════════════════════════════════════════════════════════════
-- The admin "Reset Slot → Full reset" action restored slots, bids and
-- wallets, but left rows in `submissions` (and the evaluations / bonus
-- time attached to them). As a result the admin Bidding Results page and
-- the Submission page still listed allocations after a reset.
--
-- This migration redefines reset_auction() so a full reset is truly full:
--   * every slot returns to Pending with no winner/leader/sold_at;
--   * bids and wallet ledger rows are deleted;
--   * submissions are deleted — evaluations, eval_updates and bonus
--     transactions cascade from them;
--   * wallets are restored to the starting balance;
--   * in-flight advance state (auction_advancing / next_auction_open_at)
--     is cleared so a pending 3s transition cannot reopen a slot;
--   * active sessions are cancelled.
--
-- Safe to re-run. Depends on migration 015 (and its 033 successor for
-- clear_team_dq, which is unrelated).
--
-- Run once in the Supabase SQL editor (or `supabase db push`).

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
begin
  if not public.is_admin() then
    raise exception 'Admin access required to reset auction';
  end if;

  lock table public.slots             in exclusive mode;
  lock table public.bids              in exclusive mode;
  lock table public.wallets           in exclusive mode;
  lock table public.submissions       in exclusive mode;
  lock table public.evaluations       in exclusive mode;
  lock table public.bonus_transactions in exclusive mode;

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
    'starting_balance',           v_starting_balance,
    'server_time',                clock_timestamp()
  );
end;
$$;

comment on function public.reset_auction() is
  'Full, audited auction reset: slots, bids, ledger, wallets, submissions, evaluations and bonus time. Cancels active sessions and clears the advance guard.';

revoke all on function public.reset_auction() from public;
grant execute on function public.reset_auction() to authenticated;

notify pgrst, 'reload schema';
