-- Migration 006: Fix wallet schema
-- ============================================================
-- Rule Book v1.0, Section 5.1 (official clarification):
--   "Every team has 100 points."
--   "Points are deducted from the wallet only when a team wins a slot.
--    Losing bids cost nothing."
--   "Points left unspent after both rounds earn bonus evaluation points
--    (Section 9.8) but have no cash equivalent."
--
-- The original schema (001) modelled per-round wallets (round 1 & 2
-- as separate rows). This migration replaces it with a single unified
-- wallet per team (100 points, no round separation).
-- ============================================================

-- Step 1: Drop old RLS policies that reference the old table shape
drop policy if exists "Teams view own wallets" on public.wallets;
drop policy if exists "Admins manage wallets"  on public.wallets;

-- Step 2: Drop the old wallets table
-- (safe: no other table has a FK into wallets)
drop table if exists public.wallets;

-- Step 3: Create the unified wallet table
create table public.wallets (
  team_id    uuid        primary key
               references public.teams(id) on delete cascade,
  balance    integer     not null default 100
               check (balance >= 0),
  created_at timestamptz not null default now()
);

comment on table public.wallets is
  'Unified 100-point wallet per team. '
  'Balance is deducted only when the team wins a slot (close_slot). '
  'Losing bids cost nothing.';

comment on column public.wallets.balance is
  'Current point balance. Starts at 100. '
  'Deductions happen in close_slot(), never in place_bid().';

-- Step 4: Enable RLS
alter table public.wallets enable row level security;

-- Step 5: Teams may view their own wallet; admins see all
create policy "Teams view own wallet"
on public.wallets
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

-- Step 6: Admins can manage wallets (manual corrections if needed)
create policy "Admins manage wallets"
on public.wallets
for all
to authenticated
using  (public.is_admin())
with check (public.is_admin());

