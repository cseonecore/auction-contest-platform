-- ═══════════════════════════════════════════════════════════════════
-- 032 · Unspent-coin bonus: 10 coins = 1 evaluation point
-- ═══════════════════════════════════════════════════════════════════
-- Rule Book §9.8 previously converted unspent auction coins at
-- 1 point per 3 coins. The contest now scores 1 point per 10 coins,
-- rounded down.
--
-- The application computes the projection itself, but the database
-- keeps the canonical rate in public.settings and exposes a
-- projected_bonus value from get_team_points_balance(). Both are
-- aligned here so every surface reports the same number.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Canonical conversion rate: 1 point per 10 unspent coins.
insert into public.settings (key, value)
values ('bonus_points_rate', '{"points": 1, "per_unspent": 10}'::jsonb)
on conflict (key) do update
  set value = excluded.value;

-- 2. Restore get_team_points_balance(), now reading per_unspent
--    directly (the old version resolved the JSONB object through
--    get_setting_int(), which picked "points" and therefore divided
--    the balance by 1 instead of the coin denominator).
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
  v_bonus_per integer;
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

  -- Rule Book §9.8: 1 bonus point per 10 unspent coins, rounded down.
  select case
           when jsonb_typeof(value) = 'object'
             then (value ->> 'per_unspent')::integer
         end
  into v_bonus_per
  from public.settings
  where key = 'bonus_points_rate';

  v_bonus_per := greatest(coalesce(v_bonus_per, 10), 1);

  return jsonb_build_object(
    'team_id',            p_team_id,
    'balance',            coalesce(v_balance, 0),
    'spent',              v_spent,
    'reserved',           v_reserved_total,
    'starting_balance',   public.get_setting_int('starting_wallet_balance', 100),
    'projected_bonus',    (coalesce(v_balance, 0) / v_bonus_per)
  );
end;
$$;

revoke all on function public.get_team_points_balance(uuid) from public;
grant execute on function public.get_team_points_balance(uuid) to authenticated, service_role;
