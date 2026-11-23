-- Target: Supabase SQL Editor (project qqbuauryvhgssmmxiiuh)
-- Incremental deploy: per-team development add-on in the bidding results table.
-- Apply after migrations 027/028 (and 030 if you use pause/resume). Safe to re-run.

-- ═══════════════════════════════════════════════════════════════════
-- 031 · Per-team development add-on configuration
-- ═══════════════════════════════════════════════════════════════════
-- The admin "Development Time Add-on" was global: every team received the
-- same value. Teams now need individual add-ons (for example, only the teams
-- that solve the hardcore problems get extra time).
--
-- Data model (from migration 028):
--   teams.dev_addon_seconds NULL  -> inherit admin_dev_addon_seconds
--   teams.dev_addon_seconds value -> per-team override, in seconds
--
-- This migration only redefines get_bidding_results() so the admin results
-- table can show and edit the override per team. The existing
-- set_team_dev_addon_seconds(team_id, seconds) RPC already writes the column.
--
-- It also fixes a reporting bug: total_addon_dev_seconds previously included
-- earned bonus time, so the table counted bonuses twice (once as "Admin
-- Add-on" and again as "Add-on Time Earned").
--
-- Safe to re-run. Depends on migrations 027, 028 and 030.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.get_bidding_results()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base        integer;
  v_admin_addon integer;
  v_teams       jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to read bidding results';
  end if;

  v_base := greatest(public.get_setting_int('solving_timer_seconds', 4500), 0);
  v_admin_addon := greatest(public.get_setting_int('admin_dev_addon_seconds', 0), 0);

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
              'total_dev_seconds', v_base
                + coalesce(t.dev_addon_seconds, v_admin_addon)
                + coalesce((
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
        'won_count',                agg.won_count,
        -- NULL means this team inherits the global admin add-on.
        'dev_addon_seconds',        t.dev_addon_seconds,
        'admin_addon_dev_seconds',  v_admin_addon,
        -- Effective add-on only (bonus time is reported separately below).
        'total_addon_dev_seconds',  coalesce(t.dev_addon_seconds, v_admin_addon),
        'total_base_dev_seconds',   v_base,
        'total_bonus_dev_seconds',  agg.bonus_dev_seconds,
        'total_dev_seconds',        v_base
          + coalesce(t.dev_addon_seconds, v_admin_addon)
          + agg.bonus_dev_seconds
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
    'teams',                    coalesce(v_teams, '[]'::jsonb),
    'base_dev_seconds',          v_base,
    'admin_dev_addon_seconds',   v_admin_addon,
    'server_time',               clock_timestamp()
  );
end;
$$;

revoke all on function public.get_bidding_results() from public;
grant execute on function public.get_bidding_results() to authenticated, service_role;

comment on function public.get_bidding_results() is
  'Admin results feed. Each team exposes its per-team dev_addon_seconds override, the global default, the effective add-on, bonus time, and totals.';

notify pgrst, 'reload schema';
