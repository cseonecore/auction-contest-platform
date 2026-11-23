-- ==============================================================================
-- BID2BUILD - CONSOLIDATED PRODUCTION MIGRATION RUNBOOK
-- Project ref : qqbuauryvhgssmmxiiuh (bid2build)
-- Generated   : 2026-11-17 01.27
-- Source      : supabase/migrations/010..020 (authoritative, identical content)
--
-- HOW TO USE
--   1. Read docs/auction-deployment-readiness.md (verification section).
--   2. Run the PRE-FLIGHT block (read-only) and paste the output back.
--   3. Run this whole file in the Supabase SQL Editor (single run).
--   4. Run the POST-FLIGHT block and paste the output back.
--
-- MIGRATION 008 IS DELIBERATELY NOT INCLUDED:
--   it seeds TWO auction items per topic (40 items). The contest now has
--   ONE auction item per topic (20 items); migration 011 reconciles that
--   safely, so running 008 is unnecessary.
-- ==============================================================================

-- =============================================================================
-- FILE: supabase/migrations/010_single_device_sessions.sql
-- =============================================================================
-- Migration 010: Single-device session enforcement
-- ============================================================
-- Tracks active authenticated sessions per user to prevent
-- simultaneous logins on multiple devices.
-- Enforced server-side; frontend restrictions are supplementary.
-- ============================================================

-- 1. Create the active_sessions table
-- Stores the session identifier per authenticated user.
-- The UNIQUE constraint on user_id ensures only one active session per account.
create table if not exists public.active_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null, -- Supabase session identifier
  created_at timestamptz not null default now(),
  constraint uq_active_sessions_user unique (user_id)
);

-- 2. Index for session lookups
create index if not exists idx_active_sessions_user
  on public.active_sessions(user_id);

-- 3. RLS: Enable row level security on active_sessions
alter table public.active_sessions enable row level security;

-- 4. RLS Policy: Authenticated users can view their own active session
create policy "Users view own active session"
on public.active_sessions
for select
to authenticated
using (user_id = auth.uid());

-- 5. RLS Policy: Service role can manage all sessions (bypass RLS)
create policy "Service role manage sessions"
on public.active_sessions
for all
to service_role
using (true)
with check (true);

-- 6. RPC: check_session_active
-- Checks if the current user already has an active session.
-- Returns false if another device is already logged in (active session exists).
-- Returns true if no active session exists (new login allowed).
-- Note: called BEFORE login to check for existing sessions.
-- If auth.uid() is null (user not logged in), returns true to allow login.
create or replace function public.check_session_active()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_session_count integer;
begin
  v_user_id := auth.uid();

  -- If user is not logged in (no session), allow the login attempt
  if v_user_id is null then
    return true;
  end if;

  -- Check if there's an existing active session for this user
  select count(*) into v_session_count
  from public.active_sessions
  where user_id = v_user_id;

  if v_session_count > 0 then
    -- Another device is already logged in
    return false;
  end if;

  -- No active session; allow new login
  return true;
end;
$$;

-- 7. RPC: mark_session_active
-- Marks the current session as active for the authenticated user.
-- Called AFTER successful login to establish the new active session.
-- Overwrites any previous session record (the new login wins).
create or replace function public.mark_session_active()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return false;
  end if;

  -- Insert or overwrite the active session record for this user
  -- Use a unique session identifier based on userId and timestamp
  insert into public.active_sessions (user_id, session_id)
  values (v_user_id, concat('session_', v_user_id, '_', extract(epoch from now())))
  on conflict (user_id) do update
  set session_id = concat('session_', v_user_id, '_', extract(epoch from now())),
      created_at = now();

  return true;
end;
$$;

-- 8. RPC: invalidate_current_session
-- Invalidates the current session (e.g., on logout).
-- Removes the session record so the user must re-authenticate.
create or replace function public.invalidate_current_session()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return false;
  end if;

  delete from public.active_sessions
  where user_id = v_user_id;

  return true;
end;
$$;

-- 9. Grant execute permissions to authenticated users
grant execute on function public.check_session_active() to authenticated;
grant execute on function public.mark_session_active() to authenticated;
grant execute on function public.invalidate_current_session() to authenticated;

-- =============================================================================
-- FILE: supabase/migrations/011_auction_core.sql
-- =============================================================================
-- ============================================================
-- Migration 011: Auction core — session state machine, server
-- authoritative timer fields, single auction item per topic,
-- and an idempotent seed of the 20 contest problem statements.
-- ============================================================
-- Safety profile
--   * Purely additive: no table is dropped, no column is dropped.
--   * No historical auction data is deleted or overwritten.
--     The only DELETE in this file removes *pristine surplus
--     pending* items (status='pending', zero bid, no leader,
--     no winner, zero bid rows) produced by the 2-items-per-topic
--     seed in migration 008. Every removal is written to
--     audit_log with action 'slot_reconciled'.
--   * Idempotent: safe to re-run.
--
-- Order matters: surplus items are reconciled BEFORE the
-- one-active-item-per-topic index is created, otherwise the index
-- build would fail on a database that still carries the old
-- 2-items-per-topic seed.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Auction session (contest-level state machine + clock)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.auction_sessions (
  id                            uuid primary key default gen_random_uuid(),
  status                        text not null default 'draft'
                                  check (status in (
                                    'draft', 'ready', 'question_selection',
                                    'bidding_open', 'bidding_closed',
                                    'finalizing', 'question_assigned',
                                    'solving', 'completed', 'cancelled')),
  round                         integer not null default 1 check (round in (1, 2)),
  is_paused                     boolean not null default false,
  active_slot_id                uuid,
  -- Server-authoritative solving clock
  timer_status                  text not null default 'idle'
                                  check (timer_status in ('idle','running','paused','expired','completed')),
  timer_started_at              timestamptz,
  timer_ends_at                 timestamptz,
  timer_paused_at               timestamptz,
  paused_remaining_seconds      integer not null default 0 check (paused_remaining_seconds >= 0),
  total_bonus_seconds           integer not null default 0 check (total_bonus_seconds >= 0),
  total_manual_extension_seconds integer not null default 0 check (total_manual_extension_seconds >= 0),
  settings_snapshot             jsonb not null default '{}'::jsonb,
  started_at                    timestamptz,
  ended_at                      timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

comment on table public.auction_sessions is
  'Contest-level auction session. Holds the authoritative state machine, '
  'pause flag and the solving clock that bonus time extends.';

alter table public.auction_sessions enable row level security;

create unique index if not exists auction_sessions_single_active_idx
  on public.auction_sessions (status)
  where status in ('ready','question_selection','bidding_open','bidding_closed',
                   'finalizing','question_assigned','solving');

create index if not exists idx_auction_sessions_status on public.auction_sessions (status);


-- ─────────────────────────────────────────────────────────────
-- 2. Slot timer fields + session link + ordering + timestamps
-- ─────────────────────────────────────────────────────────────
alter table public.slots
  add column if not exists session_id uuid references public.auction_sessions(id) on delete set null;
alter table public.slots
  add column if not exists timer_status text not null default 'idle'
    check (timer_status in ('idle','running','paused','expired','completed'));
alter table public.slots
  add column if not exists timer_started_at timestamptz;
alter table public.slots
  add column if not exists timer_paused_at timestamptz;
alter table public.slots
  add column if not exists paused_remaining_seconds integer not null default 0
    check (paused_remaining_seconds >= 0);
alter table public.slots
  add column if not exists total_bonus_seconds integer not null default 0
    check (total_bonus_seconds >= 0);
alter table public.slots
  add column if not exists total_manual_extension_seconds integer not null default 0
    check (total_manual_extension_seconds >= 0);
alter table public.slots
  add column if not exists question_number integer;
alter table public.slots
  add column if not exists sold_at timestamptz;
alter table public.slots
  add column if not exists created_at timestamptz not null default now();

comment on column public.slots.end_time is
  'Authoritative bidding deadline for this item. '
  'remaining_seconds = max(0, end_time - server_now).';
comment on column public.slots.timer_status is
  'idle | running | paused | expired | completed. When paused, '
  'paused_remaining_seconds holds the preserved remaining time and bids are rejected.';

create index if not exists idx_slots_topic on public.slots (topic_id);
create index if not exists idx_slots_status on public.slots (status);
create index if not exists idx_slots_session on public.slots (session_id);


-- ─────────────────────────────────────────────────────────────
-- 3. Idempotent seed of the 20 problem statements
--    (same identifiers as migration 008)
-- ─────────────────────────────────────────────────────────────
insert into public.topics (id, level, title, description, criterion)
values
  ('11111111-0001-4000-8000-000000000001', 'easy', 'Campus Life Tech',
   'Lost-and-found, canteen queues, event discovery.',
   '{"focus": "Real-time updates, notification reliability"}'::jsonb),
  ('11111111-0001-4000-8000-000000000002', 'easy', 'Student Finance',
   'Budgeting and split-expense apps.',
   '{"focus": "Calculation accuracy, data privacy"}'::jsonb),
  ('11111111-0001-4000-8000-000000000003', 'easy', 'Hyperlocal Marketplace',
   'Buy, sell, or rent within campus.',
   '{"focus": "Listing flow, trust and verification"}'::jsonb),
  ('11111111-0001-4000-8000-000000000004', 'easy', 'Smart Attendance and Timetable',
   'QR-based attendance, clash-free scheduling.',
   '{"focus": "Anti-proxy checks, accuracy of clash detection"}'::jsonb),
  ('11111111-0001-4000-8000-000000000005', 'easy', 'Fun and Creative Tech',
   'Meme generators, music recommenders, campus games.',
   '{"focus": "Originality, shareability, fun factor"}'::jsonb),
  ('11111111-0001-4000-8000-000000000006', 'easy', 'Gamified Learning',
   'Quests, points, and levels for boring subjects.',
   '{"focus": "Engagement loop, learning effectiveness"}'::jsonb),
  ('11111111-0001-4000-8000-000000000007', 'easy', 'Green Campus',
   'Energy tracking, waste sorting, carpooling.',
   '{"focus": "Measurable impact, data tracking"}'::jsonb),
  ('11111111-0001-4000-8000-000000000008', 'easy', 'Club and Event Management',
   'Registrations, volunteer tracking, certificates.',
   '{"focus": "Workflow completeness, certificate automation"}'::jsonb),
  ('11111111-0001-4000-8000-000000000009', 'easy', 'Hostel and Mess Management',
   'Menu feedback, room requests, complaint tracking.',
   '{"focus": "Complaint lifecycle, admin dashboard"}'::jsonb),
  ('11111111-0001-4000-8000-000000000010', 'easy', 'Notes and Resource Sharing',
   'Platforms to share and organize study material.',
   '{"focus": "Search and organization, content quality control"}'::jsonb),
  ('22222222-0002-4000-8000-000000000001', 'hard', 'AI Study Buddy',
   'Personalized notes, doubt solving, exam prep.',
   '{"focus": "Answer accuracy, personalization, hallucination handling"}'::jsonb),
  ('22222222-0002-4000-8000-000000000002', 'hard', 'Fake News and Deepfake Detection',
   'Spot fake media and misinformation.',
   '{"focus": "Detection accuracy on test samples, explainability"}'::jsonb),
  ('22222222-0002-4000-8000-000000000003', 'hard', 'Accessibility Tools',
   'Sign language translation, voice navigation.',
   '{"focus": "Recognition accuracy, latency, inclusive design"}'::jsonb),
  ('22222222-0002-4000-8000-000000000004', 'hard', 'Open Source for NGOs',
   'Real-world tools with real users and constraints.',
   '{"focus": "Real stakeholder fit, sustainability, scalability"}'::jsonb),
  ('22222222-0002-4000-8000-000000000005', 'hard', 'Career Readiness',
   'Resume analyzers, mock interview bots, skill-gap mapping.',
   '{"focus": "Feedback quality, scoring consistency"}'::jsonb),
  ('22222222-0002-4000-8000-000000000006', 'hard', 'Women''s Safety',
   'Smart alerts, safe routes, incident reporting.',
   '{"focus": "Response speed, offline reliability, privacy"}'::jsonb),
  ('22222222-0002-4000-8000-000000000007', 'hard', 'Mental Wellness',
   'Anonymous peer support, stress trackers, burnout detection.',
   '{"focus": "Anonymity, safe-response handling, ethical design"}'::jsonb),
  ('22222222-0002-4000-8000-000000000008', 'hard', 'Cybersecurity for Students',
   'Phishing and scam detection, password safety tools.',
   '{"focus": "Detection rate, false positives, security of the app itself"}'::jsonb),
  ('22222222-0002-4000-8000-000000000009', 'hard', 'AR/VR Learning',
   'Immersive labs, virtual campus tours, simulations.',
   '{"focus": "Immersion, performance, device compatibility"}'::jsonb),
  ('22222222-0002-4000-8000-000000000010', 'hard', 'Disaster and Emergency Response',
   'Early alerts, evacuation guidance, volunteer coordination.',
   '{"focus": "Alert reliability, low-connectivity support, coordination flow"}'::jsonb)
on conflict (id) do nothing;


-- ─────────────────────────────────────────────────────────────
-- 3b. Identity alignment
--
-- Registration originally inserted the captain's `members` row with a
-- random uuid and then pointed `teams.captain_id` at that row. The
-- identity chain that PostgreSQL relies on is
--
--     auth.users.id  ==  members.id  ==  teams.captain_id
--
-- `current_team_id()`, `is_team_captain()` and `place_bid()` all
-- resolve the caller through `auth.uid()`, so with a broken chain NO
-- captain could ever bid and RLS could never resolve "my own team".
--
-- `align_identities()` re-aligns the captain row with its Auth
-- account. It is a no-op on a database where the chain is already
-- correct, and it is safe to re-run.
-- ─────────────────────────────────────────────────────────────
create or replace function public.align_identities()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teams_fixed   integer := 0;
  v_members_fixed integer := 0;
begin
  -- 1. Point the team at the Auth account of its captain.
  update public.teams t
  set    captain_id = u.id
  from   public.members m
  join   auth.users u on lower(u.email) = lower(m.email)
  where  m.id = t.captain_id
    and  t.captain_id <> u.id;

  get diagnostics v_teams_fixed = row_count;

  -- 2. Re-key the captain member row onto the same Auth account.
  update public.members m
  set    id = u.id
  from   auth.users u
  where  lower(u.email) = lower(m.email)
    and  m.id <> u.id
    and  exists (select 1 from public.teams t where t.captain_id = u.id);

  get diagnostics v_members_fixed = row_count;

  if v_teams_fixed > 0 or v_members_fixed > 0 then
    insert into public.audit_log (action, entity_type, entity_id, details)
    values (
      'identity_aligned', 'identity', null,
      jsonb_build_object(
        'teams_realigned',   v_teams_fixed,
        'members_realigned', v_members_fixed
      )
    );
  end if;

  return jsonb_build_object(
    'success',           true,
    'teams_realigned',   v_teams_fixed,
    'members_realigned', v_members_fixed
  );
end;
$$;

revoke all on function public.align_identities() from public;
grant execute on function public.align_identities() to service_role;

do $$
declare
  v_result jsonb;
begin
  v_result := public.align_identities();
  raise notice 'Identity alignment: %', v_result;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 4. Reconcile the surplus items created by the 2-per-topic seed
--    Only pristine, never-bid, never-sold PENDING items are removed,
--    and only when the topic already keeps another item.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_surplus record;
begin
  for v_surplus in
    with ranked as (
      select s.id,
             s.topic_id,
             s.status,
             s.current_bid,
             s.leader_team_id,
             s.winner_team_id,
             row_number() over (
               partition by s.topic_id
               order by (case when s.status in ('open', 'sold') then 0
                              when s.status = 'skipped' then 2
                              else 1 end),
                        s.created_at nulls last,
                        s.id
             ) as keep_rank
      from public.slots s
    )
    select r.id, r.topic_id, t.title
    from ranked r
    join public.topics t on t.id = r.topic_id
    where r.keep_rank > 1
      and r.status = 'pending'
      and r.current_bid = 0
      and r.leader_team_id is null
      and r.winner_team_id is null
      and not exists (select 1 from public.bids b where b.slot_id = r.id)
      and not exists (
        select 1 from public.slots k
        where k.topic_id = r.topic_id and k.status = 'sold'
      )
  loop
    insert into public.audit_log (action, entity_type, entity_id, details)
    values (
      'slot_reconciled', 'slot', v_surplus.id,
      jsonb_build_object(
        'reason',   'one_auction_item_per_topic',
        'topic_id', v_surplus.topic_id,
        'title',    v_surplus.title
      )
    );
    delete from public.slots where id = v_surplus.id;
  end loop;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 5. One auction item per topic, one sale per topic
-- ─────────────────────────────────────────────────────────────
-- 5a. At most one SOLD item per topic: a problem statement can
--     never be sold twice.
create unique index if not exists slots_topic_sold_once_idx
  on public.slots (topic_id)
  where status = 'sold';

comment on index public.slots_topic_sold_once_idx is
  'Guarantees a problem statement is sold at most once across the whole contest.';

-- 5b. At most one ACTIVE (pending/open) item per topic.
create unique index if not exists slots_one_active_per_topic_idx
  on public.slots (topic_id)
  where status in ('pending', 'open');

comment on index public.slots_one_active_per_topic_idx is
  'Guarantees a topic never has two simultaneously active auction items.';

-- 5c. Trigger producing a readable error instead of a raw
--     unique-violation when the active-item rule is breached.
create or replace function public.enforce_single_active_slot_per_topic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A problem statement that has already been sold is closed for sale.
  if new.status in ('pending', 'open') and exists (
    select 1
    from public.slots s
    where s.topic_id = new.topic_id
      and s.id <> new.id
      and s.status = 'sold'
  ) then
    raise exception
      'Topic % has already been sold and cannot be auctioned again.',
      new.topic_id
      using errcode = 'check_violation';
  end if;

  -- Only one active item may exist per topic.
  if new.status in ('pending', 'open') and exists (
    select 1
    from public.slots s
    where s.topic_id = new.topic_id
      and s.id <> new.id
      and s.status in ('pending', 'open')
  ) then
    raise exception
      'Topic % already has an active auction item. Only one auction item may exist per topic.',
      new.topic_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_single_active_slot_per_topic on public.slots;
create trigger trg_single_active_slot_per_topic
  before insert or update of topic_id, status on public.slots
  for each row execute function public.enforce_single_active_slot_per_topic();


-- ─────────────────────────────────────────────────────────────
-- 6. Typed settings accessor used by every engine function
--    so no rule is ever hardcoded in SQL.
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_setting_int(p_key text, p_default integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw jsonb;
  v_num integer;
begin
  select value into v_raw
  from public.settings
  where key = p_key;

  if v_raw is null then
    return p_default;
  end if;

  -- plain jsonb number / numeric string
  if (v_raw #>> '{}') ~ '^-?[0-9]+$' then
    v_num := (v_raw #>> '{}')::integer;
  elsif jsonb_typeof(v_raw) = 'object' then
    if (v_raw ->> 'value') ~ '^-?[0-9]+$' then
      v_num := (v_raw ->> 'value')::integer;
    elsif (v_raw ->> 'seconds') ~ '^-?[0-9]+$' then
      v_num := (v_raw ->> 'seconds')::integer;
    elsif (v_raw ->> 'points') ~ '^-?[0-9]+$' then
      v_num := (v_raw ->> 'points')::integer;
    elsif (v_raw ->> 'per_unspent') ~ '^-?[0-9]+$' then
      v_num := (v_raw ->> 'per_unspent')::integer;
    end if;
  end if;

  return coalesce(v_num, p_default);
end;
$$;

revoke all on function public.get_setting_int(text, integer) from public;
grant execute on function public.get_setting_int(text, integer) to authenticated, anon, service_role;

comment on function public.get_setting_int(text, integer) is
  'Reads an integer setting from public.settings with a safe default. '
  'All auction rules (min bid, min raise, windows, bonus seconds) resolve through this.';


-- ─────────────────────────────────────────────────────────────
-- 7. Ensure every still-sellable topic owns exactly one active
--    auction item, and number the items for display
--    (1..10 easy, 11..20 hard).
-- ─────────────────────────────────────────────────────────────
insert into public.slots (topic_id, round, status, current_bid, min_bid, question_number)
select n.id,
       case when n.level = 'easy' then 1 else 2 end,
       'pending', 0, public.get_setting_int('min_bid', 10), n.qnum
from (
  select t.id,
         t.level,
         (case when t.level = 'easy' then 0 else 10 end)
           + row_number() over (partition by t.level order by t.id) as qnum
  from public.topics t
) n
where not exists (
  select 1 from public.slots sl
  where sl.topic_id = n.id
    and sl.status in ('pending', 'open', 'sold')
);

update public.slots s
set question_number = n.qnum
from (
  select t.id as topic_id,
         (case when t.level = 'easy' then 0 else 10 end)
           + row_number() over (partition by t.level order by t.id) as qnum
  from public.topics t
) n
where n.topic_id = s.topic_id
  and s.question_number is null;

create index if not exists idx_slots_question_number
  on public.slots (round, question_number);

-- An item's floor is never below the configured minimum.
update public.slots s
set min_bid = greatest(coalesce(s.min_bid, 10), public.get_setting_int('min_bid', 10))
where s.min_bid is null or s.min_bid < public.get_setting_int('min_bid', 10);


-- ─────────────────────────────────────────────────────────────
-- 8. Contest settings (authoritative, read by the engine)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value)
values
  ('min_bid', '10'::jsonb),
  ('min_raise', '10'::jsonb),
  ('opening_window_seconds', '10'::jsonb),
  ('timer_extension_seconds', '5'::jsonb),
  ('starting_wallet_balance', '100'::jsonb),
  ('bonus_points_rate', '{"points": 1, "per_unspent": 10}'::jsonb),
  ('bonus_time_seconds', '60'::jsonb),
  ('solving_timer_seconds', '120'::jsonb),
  ('manual_timer_extension_seconds', '15'::jsonb),
  ('elimination_enabled', 'false'::jsonb)
on conflict (key) do nothing;


-- ─────────────────────────────────────────────────────────────
-- 9. Verification helpers (safe to re-run)
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes
  from (
    select topic_id from public.slots
    where status in ('pending', 'open')
    group by topic_id having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception 'Migration 011 aborted: % topic(s) still have more than one active auction item.', v_dupes;
  end if;
end;
$$;


-- =============================================================================
-- FILE: supabase/migrations/012_wallet_ledger.sql
-- =============================================================================
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


-- =============================================================================
-- FILE: supabase/migrations/013_elimination.sql
-- =============================================================================
-- ============================================================
-- Migration 013: Elimination system
-- ============================================================
-- Participation rules are enforced by the database:
--   * A team that fails a mandatory participation window may be
--     eliminated by the admin (or automatically by a rule sweep).
--   * An eliminated team cannot bid, cannot win a slot and cannot
--     receive an auction bonus.
--   * Elimination is reversible and always recorded with a reason
--     and a timestamp.
--
-- The registration status of a team is never overwritten: this
-- table is a separate, additive record.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Elimination records
-- ─────────────────────────────────────────────────────────────
create table if not exists public.team_eliminations (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  rule          text not null default 'manual'
                  check (rule in ('no_selection', 'no_bid', 'manual', 'other')),
  reason        text not null,
  eliminated_at timestamptz not null default now(),
  eliminated_by uuid,
  restored_at   timestamptz,
  restored_by   uuid,
  restore_note  text
);

comment on table public.team_eliminations is
  'Participation elimination log. A team is eliminated while it has an active '
  '(not restored) record here. Registration status is untouched.';

create index if not exists idx_team_eliminations_team
  on public.team_eliminations (team_id, eliminated_at desc);
create index if not exists idx_team_eliminations_active
  on public.team_eliminations (team_id)
  where restored_at is null;

-- At most one active elimination per team.
create unique index if not exists team_eliminations_active_unique_idx
  on public.team_eliminations (team_id)
  where restored_at is null;

comment on index public.team_eliminations_active_unique_idx is
  'A team can only hold one active elimination record at a time.';


-- ─────────────────────────────────────────────────────────────
-- 2. Read helper
-- ─────────────────────────────────────────────────────────────
create or replace function public.team_is_eliminated(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_eliminations e
    where e.team_id = p_team_id
      and e.restored_at is null
  );
$$;

revoke all on function public.team_is_eliminated(uuid) from public;
grant execute on function public.team_is_eliminated(uuid) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 3. Admin elimination / restoration
-- ─────────────────────────────────────────────────────────────
create or replace function public.eliminate_team(
  p_team_id uuid,
  p_reason  text,
  p_rule    text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
  v_exists    boolean;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to eliminate a team';
  end if;

  if p_team_id is null then
    raise exception 'A team must be supplied';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'An elimination reason is required';
  end if;

  if p_rule not in ('no_selection', 'no_bid', 'manual', 'other') then
    raise exception 'Unknown elimination rule: %', p_rule;
  end if;

  select t.name into v_team_name
  from public.teams t
  where t.id = p_team_id;

  if not found then
    raise exception 'Team not found';
  end if;

  select public.team_is_eliminated(p_team_id) into v_exists;
  if v_exists then
    raise exception 'Team "%" is already eliminated', v_team_name;
  end if;

  insert into public.team_eliminations (team_id, rule, reason, eliminated_by)
  values (p_team_id, p_rule, trim(p_reason), auth.uid());

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), null, 'team_eliminated', 'team', p_team_id,
    jsonb_build_object('rule', p_rule, 'reason', trim(p_reason), 'team_name', v_team_name)
  );

  return jsonb_build_object(
    'success',       true,
    'team_id',       p_team_id,
    'team_name',     v_team_name,
    'rule',          p_rule,
    'reason',        trim(p_reason),
    'eliminated_at', clock_timestamp()
  );
end;
$$;

revoke all on function public.eliminate_team(uuid, text, text) from public;
grant execute on function public.eliminate_team(uuid, text, text) to authenticated, service_role;


create or replace function public.restore_team(
  p_team_id uuid,
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
  v_elim_id   uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to restore a team';
  end if;

  select t.name into v_team_name
  from public.teams t
  where t.id = p_team_id;

  if not found then
    raise exception 'Team not found';
  end if;

  select e.id into v_elim_id
  from public.team_eliminations e
  where e.team_id = p_team_id
    and e.restored_at is null
  order by e.eliminated_at desc
  limit 1;

  if v_elim_id is null then
    raise exception 'Team "%" is not eliminated', v_team_name;
  end if;

  update public.team_eliminations
  set restored_at = clock_timestamp(),
      restored_by = auth.uid(),
      restore_note = nullif(trim(coalesce(p_note, '')), '')
  where id = v_elim_id;

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), null, 'team_restored', 'team', p_team_id,
    jsonb_build_object('note', p_note, 'team_name', v_team_name)
  );

  return jsonb_build_object(
    'success',    true,
    'team_id',    p_team_id,
    'team_name',  v_team_name,
    'restored_at', clock_timestamp()
  );
end;
$$;

revoke all on function public.restore_team(uuid, text) from public;
grant execute on function public.restore_team(uuid, text) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. Elimination history reader
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_elimination_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to read the elimination history';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id',            e.id,
          'team_id',       e.team_id,
          'team_name',     t.name,
          'rule',          e.rule,
          'reason',        e.reason,
          'eliminated_at', e.eliminated_at,
          'eliminated_by', e.eliminated_by,
          'restored_at',   e.restored_at,
          'restored_by',   e.restored_by,
          'restore_note',  e.restore_note,
          'active',        (e.restored_at is null)
        )
        order by e.eliminated_at desc
      )
      from public.team_eliminations e
      join public.teams t on t.id = e.team_id
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_elimination_history() from public;
grant execute on function public.get_elimination_history() to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────
alter table public.team_eliminations enable row level security;

drop policy if exists "Teams view own elimination" on public.team_eliminations;
create policy "Teams view own elimination"
on public.team_eliminations
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

drop policy if exists "Admins manage eliminations" on public.team_eliminations;
create policy "Admins manage eliminations"
on public.team_eliminations
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke insert, update, delete on public.team_eliminations from authenticated;
grant select on public.team_eliminations to authenticated;
grant insert, update, delete on public.team_eliminations to service_role;


-- =============================================================================
-- FILE: supabase/migrations/014_bonus_time.sql
-- =============================================================================
-- ============================================================
-- Migration 014: Bonus time engine + solution approval
-- ============================================================
-- Workflow
--   question assigned -> team submits -> judge evaluates ->
--   solution approved -> bonus transaction recorded -> solving
--   clock extended -> realtime update published -> every client
--   recalculates the authoritative deadline.
--
-- Guarantees
--   * Only an authorised judge/admin can approve or award.
--   * A bonus is always linked to a submission, a team and a slot.
--   * The same submission can never award the bonus twice
--     (unique index on submission_id).
--   * The clock extension and the ledger insert happen in the
--     same transaction.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Submission columns required by the approval workflow
-- ─────────────────────────────────────────────────────────────
alter table public.submissions
  add column if not exists live_url text;
alter table public.submissions
  add column if not exists approved_by uuid;
alter table public.submissions
  add column if not exists approved_at timestamptz;
alter table public.submissions
  add column if not exists judge_notes text;

alter table public.submissions
  drop constraint if exists submissions_status_check;
alter table public.submissions
  add constraint submissions_status_check
  check (status in ('submitted', 'evaluating', 'evaluated', 'review', 'approved', 'rejected'));

create unique index if not exists submissions_team_slot_unique_idx
  on public.submissions (team_id, slot_id);

comment on column public.submissions.slot_id is
  'The auction item (and therefore the question) this solution answers. '
  'The submitting team must own the slot.';


-- ─────────────────────────────────────────────────────────────
-- 2. Bonus transaction ledger
-- ─────────────────────────────────────────────────────────────
create table if not exists public.bonus_transactions (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  slot_id       uuid references public.slots(id) on delete set null,
  topic_id      uuid references public.topics(id) on delete set null,
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  approved_by   uuid not null,
  bonus_seconds integer not null check (bonus_seconds > 0),
  reason        text,
  created_at    timestamptz not null default now()
);

comment on table public.bonus_transactions is
  'One row per awarded bonus. The unique constraint on submission_id makes the '
  'award idempotent — a second attempt returns the existing award instead of '
  'extending the clock again.';

create index if not exists idx_bonus_tx_team
  on public.bonus_transactions (team_id, created_at desc);
create index if not exists idx_bonus_tx_slot
  on public.bonus_transactions (slot_id)
  where slot_id is not null;


-- ─────────────────────────────────────────────────────────────
-- 3. Award the bonus
-- ─────────────────────────────────────────────────────────────
create or replace function public.grant_bonus_time(
  p_submission_id uuid,
  p_reason        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission   public.submissions%rowtype;
  v_slot         public.slots%rowtype;
  v_session      public.auction_sessions%rowtype;
  v_existing     public.bonus_transactions%rowtype;
  v_bonus_secs   integer;
  v_session_id   uuid;
  v_new_ends_at  timestamptz;
  v_new_status   text;
  v_new_paused   integer;
begin
  -- 1. Authorisation (judge or admin only)
  if not public.is_admin_or_judge() then
    raise exception 'Judge or admin access required to award bonus time';
  end if;

  if p_submission_id is null then
    raise exception 'A submission is required to award bonus time';
  end if;

  -- 2. Lock and validate the submission
  select * into v_submission
  from public.submissions s
  where s.id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found';
  end if;

  if v_submission.status <> 'approved' then
    raise exception
      'Solution must be approved before bonus time can be awarded (current status: %)',
      v_submission.status;
  end if;

  -- 3. The team must own the assigned question
  select * into v_slot
  from public.slots s
  where s.id = v_submission.slot_id
  for update;

  if not found then
    raise exception 'Assigned auction item not found for this submission';
  end if;

  if v_slot.winner_team_id is null or v_slot.winner_team_id <> v_submission.team_id then
    raise exception 'Submission is not linked to a question owned by this team';
  end if;

  if public.team_is_eliminated(v_submission.team_id) then
    raise exception 'Eliminated teams cannot earn auction bonus time';
  end if;

  -- 4. Idempotency: one bonus per submission
  select * into v_existing
  from public.bonus_transactions b
  where b.submission_id = p_submission_id;

  if found then
    return jsonb_build_object(
      'success',         true,
      'already_awarded', true,
      'bonus_id',        v_existing.id,
      'bonus_seconds',   v_existing.bonus_seconds,
      'team_id',         v_existing.team_id,
      'slot_id',         v_existing.slot_id,
      'created_at',      v_existing.created_at
    );
  end if;

  -- 5. Duration comes from the authoritative settings
  v_bonus_secs := public.get_setting_int('bonus_time_seconds', 60);
  if v_bonus_secs <= 0 then
    raise exception 'bonus_time_seconds must be a positive number of seconds';
  end if;

  -- 6. Extend the authoritative solving clock (single active session)
  select * into v_session
  from public.auction_sessions s
  where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                     'finalizing','question_assigned','solving')
  order by s.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No active auction session to extend';
  end if;

  v_session_id  := v_session.id;
  v_new_ends_at := v_session.timer_ends_at;
  v_new_status  := v_session.timer_status;
  v_new_paused  := v_session.paused_remaining_seconds;

  if v_session.timer_status = 'paused' then
    -- Preserve the frozen remaining time and grow it.
    v_new_paused := v_session.paused_remaining_seconds + v_bonus_secs;
  elsif v_session.timer_status = 'running' and v_session.timer_ends_at is not null then
    v_new_ends_at := v_session.timer_ends_at + make_interval(secs => v_bonus_secs);
  else
    -- First award starts the solving clock.
    v_new_ends_at := clock_timestamp() + make_interval(secs => v_bonus_secs);
    v_new_status  := 'running';
  end if;

  update public.auction_sessions
  set timer_status              = v_new_status,
      timer_ends_at             = v_new_ends_at,
      timer_started_at          = coalesce(timer_started_at, clock_timestamp()),
      paused_remaining_seconds  = v_new_paused,
      total_bonus_seconds       = total_bonus_seconds + v_bonus_secs,
      updated_at                = clock_timestamp()
  where id = v_session_id;

  -- 7. Record the transaction
  insert into public.bonus_transactions (
    team_id, slot_id, topic_id, submission_id,
    approved_by, bonus_seconds, reason
  )
  values (
    v_submission.team_id, v_slot.id, v_slot.topic_id, p_submission_id,
    auth.uid(), v_bonus_secs, nullif(trim(coalesce(p_reason, '')), '')
  )
  returning id into v_existing.id;

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_submission.team_id, 'bonus_time_granted', 'submission', p_submission_id,
    jsonb_build_object(
      'team_id',       v_submission.team_id,
      'slot_id',       v_slot.id,
      'bonus_seconds', v_bonus_secs,
      'reason',        p_reason,
      'session_id',    v_session_id
    )
  );

  return jsonb_build_object(
    'success',         true,
    'already_awarded', false,
    'bonus_id',        v_existing.id,
    'bonus_seconds',   v_bonus_secs,
    'team_id',         v_submission.team_id,
    'slot_id',         v_slot.id,
    'session_id',      v_session_id,
    'timer_ends_at',   v_new_ends_at,
    'timer_status',    v_new_status
  );
end;
$$;

revoke all on function public.grant_bonus_time(uuid, text) from public;
grant execute on function public.grant_bonus_time(uuid, text) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. Judge approval of a solution
-- ─────────────────────────────────────────────────────────────
create or replace function public.approve_submission(
  p_submission_id uuid,
  p_score         numeric default 0,
  p_notes         text default null,
  p_grant_bonus   boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_slot       public.slots%rowtype;
  v_bonus      jsonb;
  v_eval_id    uuid;
begin
  if not public.is_admin_or_judge() then
    raise exception 'Judge or admin access required to approve a solution';
  end if;

  select * into v_submission
  from public.submissions s
  where s.id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found';
  end if;

  select * into v_slot
  from public.slots s
  where s.id = v_submission.slot_id;

  if not found then
    raise exception 'Assigned auction item not found for this submission';
  end if;

  if v_slot.winner_team_id is null or v_slot.winner_team_id <> v_submission.team_id then
    raise exception 'Submission is not linked to a question owned by this team';
  end if;

  if p_score < 0 then
    raise exception 'Score cannot be negative';
  end if;

  update public.submissions
  set status       = 'approved',
      approved_by  = auth.uid(),
      approved_at  = clock_timestamp(),
      judge_notes  = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_submission_id;

  -- Competition score (kept separate from the auction budget)
  insert into public.evaluations (submission_id, score, report, evaluator_version, status)
  values (
    p_submission_id, p_score,
    jsonb_build_object('notes', p_notes, 'approved_by', auth.uid()),
    'manual', 'completed'
  )
  on conflict (submission_id) do update
    set score         = excluded.score,
        report        = excluded.report,
        evaluator_version = excluded.evaluator_version,
        status        = 'completed',
        evaluated_at  = clock_timestamp();

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_submission.team_id, 'solution_approved', 'submission', p_submission_id,
    jsonb_build_object('score', p_score, 'notes', p_notes, 'slot_id', v_slot.id)
  );

  v_bonus := NULL;
  if coalesce(p_grant_bonus, false) then
    v_bonus := public.grant_bonus_time(p_submission_id, p_notes);
  end if;

  return jsonb_build_object(
    'success',      true,
    'submission_id', p_submission_id,
    'score',        p_score,
    'bonus',        v_bonus
  );
end;
$$;

revoke all on function public.approve_submission(uuid, numeric, text, boolean) from public;
grant execute on function public.approve_submission(uuid, numeric, text, boolean) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 5. Bonus history reader (admin)
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_bonus_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to read the bonus history';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id',            b.id,
          'team_id',       b.team_id,
          'team_name',     t.name,
          'slot_id',       b.slot_id,
          'topic_id',      b.topic_id,
          'submission_id', b.submission_id,
          'approved_by',   b.approved_by,
          'bonus_seconds', b.bonus_seconds,
          'reason',        b.reason,
          'created_at',    b.created_at
        )
        order by b.created_at desc
      )
      from public.bonus_transactions b
      join public.teams t on t.id = b.team_id
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_bonus_history() from public;
grant execute on function public.get_bonus_history() to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────
alter table public.bonus_transactions enable row level security;

drop policy if exists "Teams view own bonus transactions" on public.bonus_transactions;
create policy "Teams view own bonus transactions"
on public.bonus_transactions
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

drop policy if exists "Admins manage bonus transactions" on public.bonus_transactions;
create policy "Admins manage bonus transactions"
on public.bonus_transactions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke insert, update, delete on public.bonus_transactions from authenticated;
grant select on public.bonus_transactions to authenticated;
grant insert, update, delete on public.bonus_transactions to service_role;

-- Submissions: participants may read their own, never write directly.
drop policy if exists "Teams view own submissions" on public.submissions;
create policy "Teams view own submissions"
on public.submissions
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

revoke insert, update, delete on public.submissions from authenticated;
grant select on public.submissions to authenticated;
grant insert, update, delete on public.submissions to service_role;


-- =============================================================================
-- FILE: supabase/migrations/015_auction_engine.sql
-- =============================================================================
-- ============================================================
-- Migration 015: Auction engine — settings-driven rules,
-- session state machine, authoritative timer, exactly-once
-- wallet deduction.
-- ============================================================
-- This migration REPLACES the bodies of place_bid, open_slot,
-- close_slot and skip_slot (same signatures, so no grant changes
-- are required) and ADDS the session / timer functions.
--
-- Authorisation is enforced INSIDE these functions (is_admin(),
-- is_admin_or_judge(), current_team_id()), never in the API
-- route alone.
--
-- Concurrency contract for place_bid:
--   1. SELECT ... FROM slots WHERE id = p_slot_id FOR UPDATE
--      serialises every bid for that item.
--   2. The wallet row is locked FOR UPDATE before the balance
--      check.
--   3. The slot's current_bid is only ever increased; the highest
--      bid can never regress.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. place_bid — the only participant-facing write
-- ─────────────────────────────────────────────────────────────
create or replace function public.place_bid(
  p_slot_id uuid,
  p_amount  integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid;
  v_team_id    uuid;
  v_team_name  text;
  v_slot       public.slots%rowtype;
  v_balance    integer;
  v_won_round  boolean;
  v_min_bid    integer;
  v_min_raise  integer;
  v_timer_ext  integer;
  v_bid_id     uuid;
  v_new_end    timestamptz;
begin
  -- ── 1. Authentication ───────────────────────────────────────
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- ── 2. Resolve the caller to their registered team ──────────
  select t.id, t.name
  into   v_team_id, v_team_name
  from   public.teams t
  where  t.captain_id = v_user_id
  limit 1;

  if v_team_id is null then
    select m.team_id, t.name
    into   v_team_id, v_team_name
    from   public.members m
    join   public.teams   t on t.id = m.team_id
    where  m.id        = v_user_id
      and  t.captain_id = v_user_id
    limit 1;
  end if;

  if v_team_id is null then
    raise exception 'Only the team captain can place bids';
  end if;

  -- ── 3. Elimination gate ─────────────────────────────────────
  if public.team_is_eliminated(v_team_id) then
    raise exception 'Your team has been eliminated and can no longer bid';
  end if;

  -- ── 4. Validate the amount ──────────────────────────────────
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid amount must be a positive integer';
  end if;

  -- ── 5. Lock the auction item (prevents concurrent bids) ─────
  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Auction slot not found';
  end if;

  -- ── 6. Item state ───────────────────────────────────────────
  if v_slot.status <> 'open' then
    raise exception 'This auction slot is not open for bidding';
  end if;

  if v_slot.timer_status = 'paused' then
    raise exception 'Bidding is currently paused';
  end if;

  if v_slot.end_time is null or v_slot.end_time <= clock_timestamp() then
    raise exception 'This auction slot has expired';
  end if;

  -- A paused session also blocks bidding.
  if v_slot.session_id is not null and exists (
    select 1 from public.auction_sessions s
    where s.id = v_slot.session_id and s.is_paused
  ) then
    raise exception 'Bidding is currently paused';
  end if;

  -- ── 7. Minimum bid / minimum raise (settings driven) ────────
  v_min_raise := greatest(public.get_setting_int('min_raise', 10), 1);

  if v_slot.leader_team_id is null then
    v_min_bid := greatest(
      coalesce(v_slot.min_bid, 0),
      public.get_setting_int('min_bid', 10)
    );
  else
    v_min_bid := v_slot.current_bid + v_min_raise;
  end if;

  if p_amount < v_min_bid then
    raise exception
      'Bid too low. Current bid is % pts — minimum next bid is % pts.',
      v_slot.current_bid, v_min_bid;
  end if;

  -- ── 8. Cannot bid against yourself ──────────────────────────
  if v_slot.leader_team_id = v_team_id then
    raise exception 'Your team is already the highest bidder on this slot';
  end if;

  -- ── 9. One win per round (Rule Book §5.3) ───────────────────
  select exists(
    select 1
    from public.slots s
    where s.winner_team_id = v_team_id
      and s.round          = v_slot.round
      and s.status         = 'sold'
  )
  into v_won_round;

  if v_won_round then
    raise exception
      'Your team has already won a slot in Round %. Each team may win one slot per round.',
      v_slot.round;
  end if;

  -- ── 10. Balance check (Rule Book §5.1 — a bid costs nothing) ─
  select w.balance
  into   v_balance
  from   public.wallets w
  where  w.team_id = v_team_id
  for    update;

  if not found then
    raise exception 'Wallet not found for this team';
  end if;

  if v_balance < p_amount then
    raise exception
      'Insufficient balance. Your wallet has % pts; this bid requires % pts.',
      v_balance, p_amount;
  end if;

  -- ── 11. Record the bid ──────────────────────────────────────
  insert into public.bids (slot_id, team_id, amount)
  values (p_slot_id, v_team_id, p_amount)
  returning id into v_bid_id;

  -- ── 12. Promote the item (current_bid only ever increases) ─
  v_timer_ext := greatest(public.get_setting_int('timer_extension_seconds', 5), 0);

  v_new_end := greatest(v_slot.end_time, clock_timestamp())
               + make_interval(secs => v_timer_ext);

  update public.slots
  set  current_bid     = p_amount,
       leader_team_id  = v_team_id,
       end_time        = v_new_end,
       timer_status    = 'running',
       timer_started_at = coalesce(timer_started_at, clock_timestamp())
  where id = p_slot_id;

  -- ── 13. Audit ───────────────────────────────────────────────
  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    v_user_id, v_team_id, 'bid_placed', 'slot', p_slot_id,
    jsonb_build_object(
      'bid_id',         v_bid_id,
      'team_id',        v_team_id,
      'team_name',      v_team_name,
      'amount',         p_amount,
      'previous_bid',   v_slot.current_bid,
      'end_time',       v_new_end,
      'timer_extension', v_timer_ext
    )
  );

  -- ── 14. Result ──────────────────────────────────────────────
  return jsonb_build_object(
    'success',         true,
    'slot_id',         p_slot_id,
    'team_id',         v_team_id,
    'team_name',       v_team_name,
    'bid_id',          v_bid_id,
    'amount',          p_amount,
    'current_bid',     p_amount,
    'leader_team_id',  v_team_id,
    'min_next_bid',    p_amount + v_min_raise,
    'wallet_balance',  v_balance,
    'end_time',        v_new_end,
    'server_time',     clock_timestamp()
  );
end;
$$;

revoke all    on function public.place_bid(uuid, integer) from public;
grant execute on function public.place_bid(uuid, integer) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 2. open_slot — pending → open, settings-driven window
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
declare
  v_slot      public.slots%rowtype;
  v_end       timestamptz;
  v_window    integer;
  v_min_bid   integer;
  v_session   uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to open auction slots';
  end if;

  if p_starting_bid is not null and p_starting_bid <= 0 then
    raise exception 'Starting bid points must be a positive integer';
  end if;

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

  if v_slot.status <> 'pending' then
    raise exception
      'Only pending slots can be opened. Current status: %', v_slot.status;
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
  select s.id into v_session
  from public.auction_sessions s
  where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                     'finalizing','question_assigned','solving')
  order by s.created_at desc
  limit 1;

  update public.slots
  set  status           = 'open',
       end_time         = v_end,
       min_bid          = v_min_bid,
       current_bid      = 0,
       leader_team_id  = null,
       timer_status     = 'running',
       timer_started_at = clock_timestamp(),
       session_id       = coalesce(session_id, v_session)
  where id = p_slot_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'slot_opened', 'slot', p_slot_id,
    jsonb_build_object(
      'round',         v_slot.round,
      'topic_id',      v_slot.topic_id,
      'end_time',      v_end,
      'starting_bid',  v_min_bid,
      'window_seconds', v_window
    )
  );

  return jsonb_build_object(
    'success',         true,
    'slot_id',         p_slot_id,
    'status',          'open',
    'end_time',        v_end,
    'starting_bid',    v_min_bid,
    'window_seconds',  v_window,
    'server_time',     clock_timestamp()
  );
end;
$$;

revoke all on function public.open_slot(uuid, integer) from public;
grant execute on function public.open_slot(uuid, integer) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. close_slot — authoritative finalisation, exactly-once debit
-- ─────────────────────────────────────────────────────────────
create or replace function public.close_slot(p_slot_id uuid)
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
begin
  if not public.is_admin() then
    raise exception 'Admin access required to close auction slots';
  end if;

  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Slot not found';
  end if;

  -- Idempotency: a closed item cannot be closed again.
  if v_slot.status <> 'open' then
    raise exception
      'Only open slots can be closed. Current status: %', v_slot.status;
  end if;

  -- Keep the session in sync.
  select s.id into v_session
  from public.auction_sessions s
  where s.active_slot_id = p_slot_id
  limit 1;

  if v_session is null then
    select s.id into v_session
    from public.auction_sessions s
    where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                        'finalizing','question_assigned','solving')
    order by s.created_at desc
    limit 1;
  end if;

  -- ── Case A: no bids → skipped ───────────────────────────────
  if v_slot.leader_team_id is null then
    update public.slots
    set  status          = 'skipped',
         winner_team_id = null,
         timer_status   = 'completed',
         sold_at        = clock_timestamp()
    where id = p_slot_id;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(), 'slot_skipped', 'slot', p_slot_id,
      jsonb_build_object('reason', 'no_bids', 'round', v_slot.round)
    );

    if v_session is not null then
      update public.auction_sessions
      set status = 'bidding_closed', updated_at = clock_timestamp()
      where id = v_session and status in ('bidding_open','finalizing');
    end if;

    return jsonb_build_object(
      'success', true,
      'status',  'skipped',
      'slot_id', p_slot_id,
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
       sold_at        = clock_timestamp()
  where id = p_slot_id;

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_slot.leader_team_id, 'slot_sold', 'slot', p_slot_id,
    jsonb_build_object(
      'winner_team_id', v_slot.leader_team_id,
      'winning_bid',    v_slot.current_bid,
      'round',          v_slot.round,
      'topic_id',       v_slot.topic_id
    )
  );

  if v_session is not null then
    update public.auction_sessions
    set status = 'question_assigned', updated_at = clock_timestamp()
    where id = v_session and status in ('bidding_open','bidding_closed','finalizing');
  end if;

  return jsonb_build_object(
    'success',        true,
    'status',         'sold',
    'slot_id',        p_slot_id,
    'winner_team_id', v_slot.leader_team_id,
    'winning_bid',    v_slot.current_bid,
    'new_balance',    v_balance,
    'server_time',    clock_timestamp()
  );
end;
$$;

revoke all on function public.close_slot(uuid) from public;
grant execute on function public.close_slot(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 4. skip_slot — admin override
-- ─────────────────────────────────────────────────────────────
create or replace function public.skip_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.slots%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to skip slots';
  end if;

  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Slot not found';
  end if;

  if v_slot.status not in ('pending', 'open') then
    raise exception
      'Only pending or open slots can be skipped. Current status: %', v_slot.status;
  end if;

  update public.slots
  set  status          = 'skipped',
       winner_team_id = null,
       leader_team_id = null,
       current_bid    = 0,
       end_time       = null,
       timer_status   = 'completed'
  where id = p_slot_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'slot_skipped', 'slot', p_slot_id,
    jsonb_build_object('reason', 'admin_override', 'round', v_slot.round)
  );

  return jsonb_build_object(
    'success', true,
    'status',  'skipped',
    'slot_id', p_slot_id,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.skip_slot(uuid) from public;
grant execute on function public.skip_slot(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 5. Session lifecycle
-- ─────────────────────────────────────────────────────────────
-- IMPORTANT: this MUST return SETOF. A function returning a bare composite
-- type always yields exactly one row (all-NULL when the inner query finds
-- nothing), which silently breaks every `if found` check below.
drop function if exists public.get_active_session();
create or replace function public.get_active_session()
returns setof public.auction_sessions
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.auction_sessions s
  where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                     'finalizing','question_assigned','solving')
  order by s.created_at desc
  limit 1;
$$;

revoke all on function public.get_active_session() from public;
grant execute on function public.get_active_session() to authenticated, anon, service_role;


create or replace function public.start_auction(p_round integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_snapshot jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to start the auction';
  end if;

  if p_round is null or p_round not in (1, 2) then
    raise exception 'Round must be 1 or 2';
  end if;

  select * into v_session from public.get_active_session() limit 1;

  if found then
    return jsonb_build_object(
      'success',          true,
      'already_started',  true,
      'session_id',       v_session.id,
      'status',           v_session.status,
      'round',            v_session.round
    );
  end if;

  select jsonb_object_agg(key, value) into v_snapshot
  from public.settings
  where key in ('min_bid','min_raise','opening_window_seconds','timer_extension_seconds',
                'bonus_time_seconds','solving_timer_seconds','starting_wallet_balance');

  insert into public.auction_sessions (
    status, round, is_paused, timer_status, started_at, settings_snapshot
  )
  values (
    'ready', p_round, false, 'idle', clock_timestamp(), coalesce(v_snapshot, '{}'::jsonb)
  )
  returning * into v_session;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'auction_started', 'auction_session', v_session.id,
    jsonb_build_object('round', p_round, 'settings', v_snapshot)
  );

  return jsonb_build_object(
    'success',         true,
    'already_started', false,
    'session_id',      v_session.id,
    'status',          v_session.status,
    'round',           v_session.round,
    'server_time',     clock_timestamp()
  );
end;
$$;

revoke all on function public.start_auction(integer) from public;
grant execute on function public.start_auction(integer) to authenticated;


create or replace function public.select_auction_question(p_slot_id uuid)
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
  if not public.is_admin() then
    raise exception 'Admin access required to select an auction question';
  end if;

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

revoke all on function public.select_auction_question(uuid) from public;
grant execute on function public.select_auction_question(uuid) to authenticated;


create or replace function public.open_bidding(p_slot_id uuid default null)
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
  if not public.is_admin() then
    raise exception 'Admin access required to open bidding';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session. Start the auction first.';
  end if;

  v_target := coalesce(p_slot_id, v_session.active_slot_id);
  if v_target is null then
    raise exception 'Select a problem statement before opening bidding';
  end if;

  v_result := public.open_slot(v_target);

  update public.auction_sessions
  set status = 'bidding_open', is_paused = false, updated_at = clock_timestamp()
  where id = v_session.id;

  return v_result || jsonb_build_object('session_id', v_session.id, 'session_status', 'bidding_open');
end;
$$;

revoke all on function public.open_bidding(uuid) from public;
grant execute on function public.open_bidding(uuid) to authenticated;


create or replace function public.close_bidding(p_slot_id uuid default null)
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
  if not public.is_admin() then
    raise exception 'Admin access required to close bidding';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  v_target := coalesce(p_slot_id, v_session.active_slot_id);
  if v_target is null then
    raise exception 'There is no open auction item to close';
  end if;

  v_result := public.close_slot(v_target);

  update public.auction_sessions
  set status = 'bidding_closed', updated_at = clock_timestamp()
  where id = v_session.id
    and status in ('bidding_open', 'question_selection', 'finalizing');

  return v_result || jsonb_build_object('session_id', v_session.id);
end;
$$;

revoke all on function public.close_bidding(uuid) from public;
grant execute on function public.close_bidding(uuid) to authenticated;


create or replace function public.finalize_auction(p_slot_id uuid default null)
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
  if not public.is_admin() then
    raise exception 'Admin access required to finalize the auction';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  v_target := coalesce(p_slot_id, v_session.active_slot_id);
  if v_target is null then
    raise exception 'There is no auction item to finalize';
  end if;

  v_result := public.close_slot(v_target);

  update public.auction_sessions
  set status = 'solving', updated_at = clock_timestamp()
  where id = v_session.id;

  return v_result || jsonb_build_object('session_id', v_session.id, 'session_status', 'solving');
end;
$$;

revoke all on function public.finalize_auction(uuid) from public;
grant execute on function public.finalize_auction(uuid) to authenticated;


create or replace function public.advance_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_open    public.slots%rowtype;
  v_next    public.slots%rowtype;
  v_result  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to advance the auction';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session. Start the auction first.';
  end if;

  -- Close the running item, if any.
  select * into v_open
  from public.slots s
  where s.status = 'open'
  order by s.round, s.question_number nulls last, s.id
  limit 1
  for update;

  if found then
    perform public.close_slot(v_open.id);
  end if;

  -- Pick the next pending item.
  select * into v_next
  from public.slots s
  where s.status = 'pending'
    and s.round = v_session.round
    and not exists (
      select 1 from public.slots k
      where k.topic_id = s.topic_id and k.status = 'sold'
    )
  order by s.round, s.question_number nulls last, s.id
  limit 1
  for update;

  if not found then
    update public.auction_sessions
    set status = 'completed', ended_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_session.id;

    return jsonb_build_object(
      'success',      true,
      'session_id',   v_session.id,
      'session_status','completed',
      'message',      'No further auction items remain for this round.'
    );
  end if;

  perform public.select_auction_question(v_next.id);
  v_result := public.open_bidding(v_next.id);

  return v_result || jsonb_build_object(
    'session_id', v_session.id,
    'next_slot_id', v_next.id,
    'session_status', 'bidding_open'
  );
end;
$$;

revoke all on function public.advance_auction() from public;
grant execute on function public.advance_auction() to authenticated;


create or replace function public.pause_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_slot    public.slots%rowtype;
  v_remaining integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to pause the auction';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  update public.auction_sessions
  set is_paused = true, updated_at = clock_timestamp()
  where id = v_session.id;

  -- Freeze the running item's clock.
  select * into v_slot
  from public.slots s
  where s.id = v_session.active_slot_id
  for update;

  if found and v_slot.status = 'open' and v_slot.end_time is not null then
    v_remaining := greatest(0, ceil(extract(epoch from (v_slot.end_time - clock_timestamp()))))::integer;

    update public.slots
    set timer_status             = 'paused',
        timer_paused_at          = clock_timestamp(),
        paused_remaining_seconds = v_remaining
    where id = v_slot.id;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'auction_paused', 'auction_session', v_session.id,
    jsonb_build_object('paused_remaining_seconds', v_remaining)
  );

  return jsonb_build_object(
    'success',    true,
    'session_id', v_session.id,
    'is_paused',  true,
    'paused_remaining_seconds', v_remaining,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.pause_auction() from public;
grant execute on function public.pause_auction() to authenticated;


create or replace function public.resume_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_slot    public.slots%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to resume the auction';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  update public.auction_sessions
  set is_paused = false, updated_at = clock_timestamp()
  where id = v_session.id;

  select * into v_slot
  from public.slots s
  where s.id = v_session.active_slot_id
  for update;

  if found and v_slot.status = 'open' and v_slot.timer_status = 'paused' then
    update public.slots
    set timer_status    = 'running',
        end_time        = clock_timestamp() + make_interval(secs => v_slot.paused_remaining_seconds),
        timer_paused_at = null
    where id = v_slot.id;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'auction_resumed', 'auction_session', v_session.id, '{}'::jsonb
  );

  return jsonb_build_object(
    'success',    true,
    'session_id', v_session.id,
    'is_paused',  false,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.resume_auction() from public;
grant execute on function public.resume_auction() to authenticated;


create or replace function public.end_auction_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_open    public.slots%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to end the auction session';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  select * into v_open
  from public.slots s
  where s.status = 'open'
  limit 1
  for update;

  if found then
    perform public.close_slot(v_open.id);
  end if;

  update public.auction_sessions
  set status = 'completed', ended_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'auction_completed', 'auction_session', v_session.id, '{}'::jsonb
  );

  return jsonb_build_object(
    'success',    true,
    'session_id', v_session.id,
    'status',     'completed',
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.end_auction_session() from public;
grant execute on function public.end_auction_session() to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 6. Authoritative solving clock
-- ─────────────────────────────────────────────────────────────
create or replace function public.start_auction_timer(p_seconds integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_secs    integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to start the timer';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  if v_session.timer_status = 'running' then
    return jsonb_build_object(
      'success', true, 'session_id', v_session.id,
      'timer_status', v_session.timer_status,
      'timer_ends_at', v_session.timer_ends_at
    );
  end if;

  v_secs := coalesce(p_seconds, public.get_setting_int('solving_timer_seconds', 120));

  update public.auction_sessions
  set timer_status     = 'running',
      timer_started_at = coalesce(timer_started_at, clock_timestamp()),
      timer_ends_at    = clock_timestamp() + make_interval(secs => v_secs),
      updated_at       = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'timer_started', 'auction_session', v_session.id,
    jsonb_build_object('seconds', v_secs)
  );

  return jsonb_build_object(
    'success', true, 'session_id', v_session.id,
    'timer_status', 'running',
    'timer_ends_at', clock_timestamp() + make_interval(secs => v_secs),
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.start_auction_timer(integer) from public;
grant execute on function public.start_auction_timer(integer) to authenticated;


create or replace function public.pause_auction_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session   public.auction_sessions%rowtype;
  v_remaining integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to pause the timer';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  if v_session.timer_status <> 'running' or v_session.timer_ends_at is null then
    raise exception 'The timer is not running';
  end if;

  v_remaining := greatest(0, ceil(extract(epoch from (v_session.timer_ends_at - clock_timestamp()))))::integer;

  update public.auction_sessions
  set timer_status             = 'paused',
      timer_paused_at          = clock_timestamp(),
      paused_remaining_seconds = v_remaining,
      updated_at               = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'timer_paused', 'auction_session', v_session.id,
    jsonb_build_object('paused_remaining_seconds', v_remaining)
  );

  return jsonb_build_object(
    'success', true, 'session_id', v_session.id,
    'timer_status', 'paused',
    'paused_remaining_seconds', v_remaining,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.pause_auction_timer() from public;
grant execute on function public.pause_auction_timer() to authenticated;


create or replace function public.resume_auction_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_ends_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to resume the timer';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  if v_session.timer_status <> 'paused' then
    raise exception 'The timer is not paused';
  end if;

  v_ends_at := clock_timestamp() + make_interval(secs => v_session.paused_remaining_seconds);

  update public.auction_sessions
  set timer_status    = 'running',
      timer_ends_at   = v_ends_at,
      timer_paused_at = null,
      updated_at      = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'timer_resumed', 'auction_session', v_session.id,
    jsonb_build_object('timer_ends_at', v_ends_at)
  );

  return jsonb_build_object(
    'success', true, 'session_id', v_session.id,
    'timer_status', 'running',
    'timer_ends_at', v_ends_at,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.resume_auction_timer() from public;
grant execute on function public.resume_auction_timer() to authenticated;


create or replace function public.adjust_auction_timer(
  p_seconds integer,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_ends_at timestamptz;
  v_paused  integer;
  v_status  text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to adjust the timer';
  end if;

  if p_seconds is null or p_seconds = 0 then
    raise exception 'A non-zero number of seconds is required';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  v_status := v_session.timer_status;
  v_ends_at := v_session.timer_ends_at;
  v_paused  := v_session.paused_remaining_seconds;

  if v_status = 'paused' then
    v_paused := greatest(0, v_paused + p_seconds);
  else
    if v_ends_at is null then
      v_ends_at := clock_timestamp();
    end if;
    v_ends_at := v_ends_at + make_interval(secs => p_seconds);
    if v_status = 'idle' then
      v_status := 'running';
    end if;
  end if;

  update public.auction_sessions
  set timer_status                   = v_status,
      timer_ends_at                  = v_ends_at,
      paused_remaining_seconds       = v_paused,
      total_manual_extension_seconds = total_manual_extension_seconds + p_seconds,
      updated_at                     = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'timer_extended', 'auction_session', v_session.id,
    jsonb_build_object('seconds', p_seconds, 'reason', p_reason, 'timer_ends_at', v_ends_at)
  );

  return jsonb_build_object(
    'success', true, 'session_id', v_session.id,
    'timer_status', v_status,
    'timer_ends_at', v_ends_at,
    'seconds', p_seconds,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.adjust_auction_timer(integer, text) from public;
grant execute on function public.adjust_auction_timer(integer, text) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 6b. adjust_bidding_timer — extend the bidding deadline of an
--     open auction item (the clock that a bid also extends).
-- ─────────────────────────────────────────────────────────────
create or replace function public.adjust_bidding_timer(
  p_seconds integer,
  p_slot_id uuid default null,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot    public.slots%rowtype;
  v_ends_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to adjust the bidding timer';
  end if;

  if p_seconds is null or p_seconds = 0 then
    raise exception 'A non-zero number of seconds is required';
  end if;

  if p_slot_id is null then
    select s.* into v_slot
    from public.slots s
    where s.status = 'open'
    order by s.round, s.question_number nulls last, s.id
    limit 1
    for update;
  else
    select s.* into v_slot
    from public.slots s
    where s.id = p_slot_id
    for update;
  end if;

  if not found then
    raise exception 'No open auction item to adjust';
  end if;

  if v_slot.status <> 'open' then
    raise exception 'Only an open auction item has a bidding timer';
  end if;

  v_ends_at := greatest(coalesce(v_slot.end_time, clock_timestamp()), clock_timestamp())
               + make_interval(secs => p_seconds);

  update public.slots
  set end_time = v_ends_at,
      timer_status = case when timer_status = 'paused' then 'paused' else 'running' end,
      total_manual_extension_seconds = total_manual_extension_seconds + p_seconds
  where id = v_slot.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'timer_extended', 'slot', v_slot.id,
    jsonb_build_object('seconds', p_seconds, 'reason', p_reason, 'end_time', v_ends_at)
  );

  return jsonb_build_object(
    'success', true,
    'slot_id', v_slot.id,
    'end_time', v_ends_at,
    'seconds', p_seconds,
    'timer_status', v_slot.timer_status,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.adjust_bidding_timer(integer, uuid, text) from public;
grant execute on function public.adjust_bidding_timer(integer, uuid, text) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 7. reset_auction — explicit, audited full reset
-- ─────────────────────────────────────────────────────────────
create or replace function public.reset_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starting_balance integer;
  v_bids_deleted     integer;
  v_slots_reset      integer;
  v_wallets_reset    integer;
  v_ledger_cleared   integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to reset auction';
  end if;

  lock table public.slots in exclusive mode;
  lock table public.bids in exclusive mode;
  lock table public.wallets in exclusive mode;

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

  update public.auction_sessions
  set status = 'cancelled', ended_at = clock_timestamp(), updated_at = clock_timestamp()
  where status not in ('completed', 'cancelled');

  insert into public.audit_log (action, entity_type, entity_id, details)
  values (
    'auction_reset', 'auction', null,
    jsonb_build_object(
      'slots_reset',    v_slots_reset,
      'bids_deleted',   v_bids_deleted,
      'wallets_reset',  v_wallets_reset,
      'ledger_cleared', v_ledger_cleared,
      'starting_balance', v_starting_balance,
      'timestamp',      clock_timestamp()
    )
  );

  return jsonb_build_object(
    'success',          true,
    'slots_reset',      v_slots_reset,
    'bids_deleted',     v_bids_deleted,
    'wallets_reset',    v_wallets_reset,
    'ledger_cleared',   v_ledger_cleared,
    'starting_balance', v_starting_balance,
    'server_time',      clock_timestamp()
  );
end;
$$;

revoke all on function public.reset_auction() from public;
grant execute on function public.reset_auction() to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 8. create_auction_topic — respects one-item-per-topic
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_auction_topic(
  p_title        text,
  p_description  text,
  p_level        text,
  p_starting_bid integer default null,
  p_criterion    jsonb default null,
  p_slots_count  integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic_id uuid;
  v_round    integer;
  v_i        integer;
  v_slots    jsonb := '[]'::jsonb;
  v_slot_id  uuid;
  v_min_bid  integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to create auction topics';
  end if;

  if p_title is null or trim(p_title) = '' then
    raise exception 'Topic title is required';
  end if;

  if p_level not in ('easy', 'hard') then
    raise exception 'Topic level must be either easy or hard';
  end if;

  v_min_bid := coalesce(
    p_starting_bid,
    greatest(public.get_setting_int('min_bid', 10), 1)
  );

  if v_min_bid <= 0 then
    raise exception 'Starting bid must be a positive integer';
  end if;

  -- One auction item per problem statement.
  if p_slots_count is null or p_slots_count < 1 then
    p_slots_count := 1;
  end if;

  if exists (
    select 1 from public.topics where lower(title) = lower(trim(p_title))
  ) then
    raise exception 'A topic with title "%" already exists', trim(p_title);
  end if;

  v_round := case when p_level = 'easy' then 1 else 2 end;

  begin
    insert into public.topics (level, title, description, criterion)
    values (p_level, trim(p_title), nullif(trim(p_description), ''), p_criterion)
    returning id into v_topic_id;
  exception
    when unique_violation then
      raise exception 'A topic with title "%" already exists', trim(p_title);
  end;

  for v_i in 1..p_slots_count loop
    begin
      insert into public.slots (topic_id, round, status, current_bid, min_bid)
      values (v_topic_id, v_round, 'pending', 0, v_min_bid)
      returning id into v_slot_id;
    exception
      when check_violation then
        raise exception 'Only one auction item may exist per problem statement.';
    end;

    v_slots := v_slots || jsonb_build_object('slot_id', v_slot_id, 'round', v_round);
  end loop;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'topic_created', 'topic', v_topic_id,
    jsonb_build_object(
      'title',        trim(p_title),
      'level',        p_level,
      'round',        v_round,
      'starting_bid', v_min_bid,
      'slots_count',  p_slots_count
    )
  );

  return jsonb_build_object(
    'success',      true,
    'topic_id',     v_topic_id,
    'title',        trim(p_title),
    'level',        p_level,
    'round',        v_round,
    'starting_bid', v_min_bid,
    'slots',        v_slots,
    'server_time',  clock_timestamp()
  );
end;
$$;

revoke all on function public.create_auction_topic(text, text, text, integer, jsonb, integer) from public;
grant execute on function public.create_auction_topic(text, text, text, integer, jsonb, integer) to authenticated;


-- =============================================================================
-- FILE: supabase/migrations/016_auction_events.sql
-- =============================================================================
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


-- =============================================================================
-- FILE: supabase/migrations/017_read_functions.sql
-- =============================================================================
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


-- =============================================================================
-- FILE: supabase/migrations/018_rls_hardening.sql
-- =============================================================================
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


-- =============================================================================
-- FILE: supabase/migrations/019_session_event_stream.sql
-- =============================================================================
-- ============================================================
-- Migration 019: Session lifecycle event stream
-- ============================================================
-- The participant arena reconciles from INSERT events on
-- public.auction_events (migration 016). Slot, bid, wallet, bonus
-- and elimination changes all publish events, but the SESSION state
-- machine did not: start / end / pause / resume / reset were silent.
-- A participant watching the event stream could therefore never
-- observe a session restart (Stop → Start) or a pause through
-- realtime alone.
--
-- This migration adds an AFTER trigger on public.auction_sessions
-- that publishes, through the existing public.emit_auction_event():
--
--     session_started   a session row is created (Start)
--     session_ended     a session transitions to 'completed' (Stop)
--     auction_paused    is_paused false → true
--     auction_resumed   is_paused true → false
--     auction_reset     an active session is cancelled by a reset
--
-- It introduces no new tables, no new RPCs and changes no rules.
-- Idempotent: safe to re-run.
-- ============================================================

create or replace function public.trg_auction_sessions_emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ── INSERT: a new session was created (start_auction) ───────
  if (tg_op = 'INSERT') then
    perform public.emit_auction_event(
      'session_started',
      null,
      null,
      jsonb_build_object(
        'session_id', new.id,
        'status',     new.status,
        'round',      new.round,
        'is_paused',  new.is_paused
      )
    );
    return new;
  end if;

  -- ── UPDATE: session completed (end_auction_session / Stop) ──
  if new.status = 'completed' and old.status <> 'completed' then
    perform public.emit_auction_event(
      'session_ended',
      null,
      null,
      jsonb_build_object(
        'session_id',      new.id,
        'round',           new.round,
        'previous_status', old.status,
        'ended_at',        new.ended_at
      )
    );
  end if;

  -- ── UPDATE: an active session was cancelled (reset_auction) ─
  if new.status = 'cancelled'
     and old.status in ('ready','question_selection','bidding_open','bidding_closed',
                        'finalizing','question_assigned','solving') then
    perform public.emit_auction_event(
      'auction_reset',
      null,
      null,
      jsonb_build_object(
        'session_id',      new.id,
        'previous_status', old.status
      )
    );
  end if;

  -- ── UPDATE: pause / resume ──────────────────────────────────
  if new.is_paused is distinct from old.is_paused then
    perform public.emit_auction_event(
      case when new.is_paused then 'auction_paused' else 'auction_resumed' end,
      null,
      null,
      jsonb_build_object(
        'session_id', new.id,
        'is_paused',  new.is_paused
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auction_sessions_emit_event on public.auction_sessions;
create trigger trg_auction_sessions_emit_event
  after insert or update of status, is_paused on public.auction_sessions
  for each row execute function public.trg_auction_sessions_emit_event();

comment on function public.trg_auction_sessions_emit_event() is
  'Publishes session lifecycle changes (start / end / pause / resume / '
  'reset) to the public.auction_events stream via emit_auction_event().';


-- =============================================================================
-- FILE: supabase/migrations/020_session_active_slot_sync.sql
-- =============================================================================
-- ============================================================
-- Migration 020: keep `auction_sessions.active_slot_id` in sync
-- ============================================================
-- Defect fixed
-- -------------
-- The admin "Open Slot" button calls `open_bidding(slot_id)` directly,
-- without first calling `select_auction_question()`. `open_slot()` only
-- attached the slot to the session (`slots.session_id`) and never wrote
-- `auction_sessions.active_slot_id`, so the session did not know which
-- item was live.
--
-- Consequences:
--   * `pause_auction()` looked up `active_slot_id`, found NULL, and did
--     NOT freeze the live item's clock. The countdown kept running while
--     the auction was paused, so on resume the item could already be
--     expired and participants could no longer bid.
--   * `resume_auction()` likewise had no item to restore.
--
-- Fix
-- ---
--   1. `open_slot()` records the live item on the session.
--   2. `open_bidding()` records it too (defence in depth, and repairs any
--      slot opened by an older client build before this migration).
--   3. `pause_auction()` / `resume_auction()` fall back to the single
--      `status = 'open'` slot when `active_slot_id` is still NULL, so
--      items opened before this migration pause correctly as well.
--
-- No RPC signature, table, policy or grant changes: this migration only
-- replaces the four function bodies. UI and state management are
-- untouched.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. open_slot — link the opened item to its session
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
declare
  v_slot      public.slots%rowtype;
  v_end       timestamptz;
  v_window    integer;
  v_min_bid   integer;
  v_session   uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to open auction slots';
  end if;

  if p_starting_bid is not null and p_starting_bid <= 0 then
    raise exception 'Starting bid points must be a positive integer';
  end if;

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

  if v_slot.status <> 'pending' then
    raise exception
      'Only pending slots can be opened. Current status: %', v_slot.status;
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
  select s.id into v_session
  from public.auction_sessions s
  where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                     'finalizing','question_assigned','solving')
  order by s.created_at desc
  limit 1;

  -- IMPORTANT: the session must know which item is live so the pause /
  -- resume pair can freeze and restore that item's clock.
  if v_session is not null then
    update public.auction_sessions
    set  active_slot_id = p_slot_id,
         updated_at     = clock_timestamp()
    where id = v_session;
  end if;

  update public.slots
  set  status           = 'open',
       end_time         = v_end,
       min_bid          = v_min_bid,
       current_bid      = 0,
       leader_team_id  = null,
       timer_status     = 'running',
       timer_started_at = clock_timestamp(),
       session_id       = coalesce(session_id, v_session)
  where id = p_slot_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'slot_opened', 'slot', p_slot_id,
    jsonb_build_object(
      'round',         v_slot.round,
      'topic_id',      v_slot.topic_id,
      'end_time',      v_end,
      'starting_bid',  v_min_bid,
      'window_seconds', v_window
    )
  );

  return jsonb_build_object(
    'success',         true,
    'slot_id',         p_slot_id,
    'status',          'open',
    'end_time',        v_end,
    'starting_bid',    v_min_bid,
    'window_seconds',  v_window,
    'server_time',     clock_timestamp()
  );
end;
$$;

revoke all on function public.open_slot(uuid, integer) from public;
grant execute on function public.open_slot(uuid, integer) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 2. open_bidding — persist the live item pointer
-- ─────────────────────────────────────────────────────────────
create or replace function public.open_bidding(p_slot_id uuid default null)
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
  if not public.is_admin() then
    raise exception 'Admin access required to open bidding';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session. Start the auction first.';
  end if;

  v_target := coalesce(p_slot_id, v_session.active_slot_id);
  if v_target is null then
    raise exception 'Select a problem statement before opening bidding';
  end if;

  v_result := public.open_slot(v_target);

  update public.auction_sessions
  set status         = 'bidding_open',
      is_paused      = false,
      active_slot_id = v_target,
      updated_at     = clock_timestamp()
  where id = v_session.id;

  return v_result || jsonb_build_object('session_id', v_session.id, 'session_status', 'bidding_open');
end;
$$;

revoke all on function public.open_bidding(uuid) from public;
grant execute on function public.open_bidding(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. pause_auction — freeze the live item even for sessions that
--    were opened before `active_slot_id` was recorded
-- ─────────────────────────────────────────────────────────────
create or replace function public.pause_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_slot    public.slots%rowtype;
  v_remaining integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to pause the auction';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  update public.auction_sessions
  set is_paused = true, updated_at = clock_timestamp()
  where id = v_session.id;

  -- Freeze the running item's clock.
  select * into v_slot
  from public.slots s
  where s.id = v_session.active_slot_id
  for update;

  -- Fallback: an item opened before migration 020 has no pointer yet.
  if not found then
    select * into v_slot
    from public.slots s
    where s.status = 'open'
    order by s.round, s.question_number nulls last, s.id
    limit 1
    for update;
  end if;

  if found and v_slot.status = 'open' and v_slot.end_time is not null then
    v_remaining := greatest(0, ceil(extract(epoch from (v_slot.end_time - clock_timestamp()))))::integer;

    update public.slots
    set timer_status             = 'paused',
        timer_paused_at          = clock_timestamp(),
        paused_remaining_seconds = v_remaining
    where id = v_slot.id;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'auction_paused', 'auction_session', v_session.id,
    jsonb_build_object('paused_remaining_seconds', v_remaining)
  );

  return jsonb_build_object(
    'success',    true,
    'session_id', v_session.id,
    'is_paused',  true,
    'paused_remaining_seconds', v_remaining,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.pause_auction() from public;
grant execute on function public.pause_auction() to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 4. resume_auction — restore the frozen clock on the same item
-- ─────────────────────────────────────────────────────────────
create or replace function public.resume_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_slot    public.slots%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to resume the auction';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  update public.auction_sessions
  set is_paused = false, updated_at = clock_timestamp()
  where id = v_session.id;

  select * into v_slot
  from public.slots s
  where s.id = v_session.active_slot_id
  for update;

  -- Fallback for items opened before migration 020.
  if not found then
    select * into v_slot
    from public.slots s
    where s.status = 'open'
    order by s.round, s.question_number nulls last, s.id
    limit 1
    for update;
  end if;

  if found and v_slot.status = 'open' and v_slot.timer_status = 'paused' then
    update public.slots
    set timer_status    = 'running',
        end_time        = clock_timestamp() + make_interval(secs => v_slot.paused_remaining_seconds),
        timer_paused_at = null
    where id = v_slot.id;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'auction_resumed', 'auction_session', v_session.id, '{}'::jsonb
  );

  return jsonb_build_object(
    'success',    true,
    'session_id', v_session.id,
    'is_paused',  false,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.resume_auction() from public;
grant execute on function public.resume_auction() to authenticated;


-- =============================================================================
-- END OF MIGRATIONS
-- =============================================================================