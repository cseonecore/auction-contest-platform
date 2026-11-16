-- ============================================================
-- Migration 012: Wallet ledger + authorization helpers
-- ============================================================
-- Rule Book §5.1 is preserved: losing bids cost nothing and the
-- winning amount is deducted exactly once, during transactional
-- finalisation. This migration adds the append-only ledger that
-- makes every balance change explainable and idempotent.
--
--   * `wallet_transactions` is append-only (no UPDATE, no DELETE
--     for participants).
--   * A partial unique index guarantees a slot can only ever
--     produce ONE 'win_deduction' entry, so a concurrent or
--     retried finalisation can never double-charge.
--   * `apply_wallet_transaction()` locks the wallet row and
--     writes the ledger row in the same transaction.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Authorization helpers (used by every engine function)
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_judge()
returns boolean
language sql
stable
as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('judge', 'admin'),
    false
  );
$$;

create or replace function public.is_admin_or_judge()
returns boolean
language sql
stable
as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'judge'),
    false
  );
$$;

revoke all on function public.is_judge() from public;
revoke all on function public.is_admin_or_judge() from public;
grant execute on function public.is_judge() to authenticated, service_role;
grant execute on function public.is_admin_or_judge() to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 2. Append-only wallet ledger
-- ─────────────────────────────────────────────────────────────
create table if not exists public.wallet_transactions (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams(id) on delete cascade,
  tx_type        text not null
                   check (tx_type in (
                     'win_deduction',    -- winning bid deducted at finalisation
                     'manual_adjustment',-- admin correction (signed)
                     'reset',            -- contest reset to the starting balance
                     'refund'            -- admin refund (signed)
                   )),
  amount         integer not null,          -- signed delta applied to balance
  balance_after  integer not null check (balance_after >= 0),
  slot_id        uuid references public.slots(id) on delete set null,
  bid_id         uuid references public.bids(id) on delete set null,
  actor_id       uuid,
  note           text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

comment on table public.wallet_transactions is
  'Append-only ledger of every wallet balance change. Rule Book §5.1: a bid never '
  'changes the balance; only a won slot (win_deduction) does.';

create index if not exists idx_wallet_tx_team
  on public.wallet_transactions (team_id, created_at desc);
create index if not exists idx_wallet_tx_slot
  on public.wallet_transactions (slot_id)
  where slot_id is not null;

-- Exactly-once guard: one win_deduction per slot, forever.
create unique index if not exists wallet_tx_win_deduction_once_idx
  on public.wallet_transactions (slot_id)
  where tx_type = 'win_deduction' and slot_id is not null;

comment on index public.wallet_tx_win_deduction_once_idx is
  'Makes a duplicate winning-bid deduction impossible, including under concurrent '
  'finalisation attempts.';


-- ─────────────────────────────────────────────────────────────
-- 3. Atomic apply helper (lock + mutate + ledger)
-- ─────────────────────────────────────────────────────────────
create or replace function public.apply_wallet_transaction(
  p_team_id  uuid,
  p_tx_type  text,
  p_amount   integer,
  p_slot_id  uuid default null,
  p_bid_id   uuid default null,
  p_actor_id uuid default null,
  p_note     text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
  v_new_balance integer;
begin
  if p_amount is null then
    raise exception 'Wallet transaction amount is required';
  end if;

  -- Lock the wallet row so concurrent mutations serialise.
  select w.balance
  into   v_balance
  from   public.wallets w
  where  w.team_id = p_team_id
  for    update;

  if not found then
    raise exception 'Wallet not found for team %', p_team_id;
  end if;

  v_new_balance := v_balance + p_amount;

  if v_new_balance < 0 then
    raise exception
      'Insufficient balance. Team % has % pts; % pts were requested.',
      p_team_id, v_balance, -p_amount;
  end if;

  update public.wallets
  set    balance = v_new_balance
  where  team_id = p_team_id;

  insert into public.wallet_transactions (
    team_id, tx_type, amount, balance_after,
    slot_id, bid_id, actor_id, note, metadata
  )
  values (
    p_team_id, p_tx_type, p_amount, v_new_balance,
    p_slot_id, p_bid_id, p_actor_id, p_note, coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'success',        true,
    'team_id',        p_team_id,
    'tx_type',        p_tx_type,
    'amount',         p_amount,
    'balance_before', v_balance,
    'balance_after',  v_new_balance
  );
end;
$$;

revoke all on function public.apply_wallet_transaction(uuid, text, integer, uuid, uuid, uuid, text, jsonb) from public;
grant execute on function public.apply_wallet_transaction(uuid, text, integer, uuid, uuid, uuid, text, jsonb)
  to service_role;

comment on function public.apply_wallet_transaction(uuid, text, integer, uuid, uuid, uuid, text, jsonb) is
  'Locks the wallet, applies a signed delta and appends the ledger row atomically. '
  'Not callable by participants — only by SECURITY DEFINER engine functions.';


-- ─────────────────────────────────────────────────────────────
-- 4. Ledger read helpers
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_team_points_balance(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_team uuid;
  v_balance integer;
  v_spent integer;
  v_reserved integer;
  v_reserved_total integer;
begin
  -- The caller may read their own balance; admins read anybody's.
  v_caller_team := public.current_team_id();

  if not (public.is_admin() or v_caller_team = p_team_id) then
    raise exception 'Not authorised to read the points balance of team %', p_team_id;
  end if;

  select w.balance into v_balance
  from public.wallets w
  where w.team_id = p_team_id;

  select coalesce(sum(-t.amount), 0) into v_spent
  from public.wallet_transactions t
  where t.team_id = p_team_id
    and t.tx_type = 'win_deduction';

  select coalesce(max(t.amount), 0) into v_reserved
  from public.wallet_transactions t
  where t.team_id = p_team_id;

  v_reserved_total := 0; -- Rule Book §5.1: bids never reserve points.

  return jsonb_build_object(
    'team_id',            p_team_id,
    'balance',            coalesce(v_balance, 0),
    'spent',              v_spent,
    'reserved',           v_reserved_total,
    'starting_balance',   public.get_setting_int('starting_wallet_balance', 100),
    'projected_bonus',    (coalesce(v_balance, 0) / greatest(public.get_setting_int('bonus_points_rate', 3), 1))
  );
end;
$$;

revoke all on function public.get_team_points_balance(uuid) from public;
grant execute on function public.get_team_points_balance(uuid) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────
alter table public.wallet_transactions enable row level security;

drop policy if exists "Teams view own wallet ledger" on public.wallet_transactions;
create policy "Teams view own wallet ledger"
on public.wallet_transactions
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

drop policy if exists "Admins manage wallet ledger" on public.wallet_transactions;
create policy "Admins manage wallet ledger"
on public.wallet_transactions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Participants must never write the ledger directly.
revoke insert, update, delete on public.wallet_transactions from authenticated;
grant select on public.wallet_transactions to authenticated;
grant insert, update, delete on public.wallet_transactions to service_role;
