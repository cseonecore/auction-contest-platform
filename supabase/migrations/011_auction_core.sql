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
  ('bonus_points_rate', '{"points": 1, "per_unspent": 3}'::jsonb),
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
