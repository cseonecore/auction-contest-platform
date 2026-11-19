-- Migration 009: Additive public read policies for auction visibility
-- ============================================================
-- Allows participants and viewers to read:
--   1. settings (min_bid, min_raise, opening_window_seconds, timer_extension_seconds)
--   2. teams (id, name, captain_id, locked) for the live auction leaderboard
--   3. slots and topics (for auction tracking)
-- All writes remain strictly restricted to admin or RPCs.
-- ============================================================

-- 1. Read settings (safe public config)
drop policy if exists "Authenticated view settings" on public.settings;
create policy "Authenticated view settings"
on public.settings
for select
to authenticated, anon
using (true);

-- 2. Read teams for live leaderboard display
drop policy if exists "Authenticated view teams" on public.teams;
create policy "Authenticated view teams"
on public.teams
for select
to authenticated, anon
using (true);

-- 3. Read topics for auction viewers
drop policy if exists "Public view topics" on public.topics;
create policy "Public view topics"
on public.topics
for select
to authenticated, anon
using (true);

-- 4. Read slots for auction viewers
drop policy if exists "Public view slots" on public.slots;
create policy "Public view slots"
on public.slots
for select
to authenticated, anon
using (true);

-- 5. Read bids for live bidding feed
drop policy if exists "Public view bids" on public.bids;
create policy "Public view bids"
on public.bids
for select
to authenticated, anon
using (true);
