# Supabase Migration Runbook — Bid2Build Auction Engine

**Project:** `qqbuauryvhgssmmxiiuh` (`bid2build`, organisation `lahebcfxwmubieuxjjmq`)
**Console:** https://supabase.com/dashboard/project/qqbuauryvhgssmmxiiuh/sql
**Generated file:** `docs/supabase-migration-runbook.sql`

> **Nothing in this runbook has been executed.** The migrations were validated
> against a real PostgreSQL engine locally (see *Validation* below) but they have
> **not** been applied to the production project. Execute them only after
> reviewing this document, and paste the pre-flight and post-flight output back.

---

## 1. What will change

| # | Migration | Effect |
|---|---|---|
| 1 | `010_single_device_sessions.sql` | Creates `active_sessions` + the single-device RPCs. **Already applied in a fresh chain — not applied to production.** This unblocks login. |
| 2 | `011_auction_core.sql` | Creates `auction_sessions` (state machine + authoritative clock), adds the timer columns to `slots`, seeds the 20 problem statements and exactly **one** auction item per topic, installs the one-active-item-per-topic trigger and the sold-once index, aligns the captain identity chain, and adds `get_setting_int()`. |
| 3 | `012_wallet_ledger.sql` | Creates the append-only `wallet_transactions` ledger + `apply_wallet_transaction()` + `is_judge()` / `is_admin_or_judge()`. |
| 4 | `013_elimination.sql` | Creates `team_eliminations` + `eliminate_team()` / `restore_team()` / `get_elimination_history()`. |
| 5 | `014_bonus_time.sql` | Creates `bonus_transactions`, `grant_bonus_time()` and `approve_submission()`; adds `submissions.live_url` and the approved/rejected states. |
| 6 | `015_auction_engine.sql` | **Replaces** `place_bid`, `open_slot`, `close_slot`, `skip_slot`, `reset_auction` and `create_auction_topic`; adds the session lifecycle and timer functions. |
| 7 | `016_auction_events.sql` | Creates `auction_events` and the triggers that feed it. |
| 8 | `017_read_functions.sql` | Adds the authoritative read functions. |
| 9 | `018_rls_hardening.sql` | Realtime publication, column-level lockdown of `challenge_problems.test_cases`, explicit grants and the write lockdown. |

**Migration 008 is intentionally excluded.** It seeds two auction items per topic
(40 items). The contest now has **one** item per topic (20 items) and
migration 011 reconciles that safely. Running 008 is unnecessary; if you do run
it, 011 will remove the surplus pristine items automatically.

---

## 2. Safety profile

* **No table or column is dropped.** Every migration is additive.
* The only `DELETE` in the set removes *pristine surplus* auction items
  (`status='pending'`, no bid, no leader, no winner, zero bid rows) that were
  produced by the old two-per-topic seed. Every removal is written to
  `audit_log` with `action = 'slot_reconciled'`.
* No historical auction data (bids, winners, sold items) is touched.
* Nothing is applied to the live project by this repository — you execute the
  file yourself.
* No service-role key is stored in the repository.

---

## 3. Pre-flight (read-only — run this first)

Paste this into the SQL Editor and **send me the output**.

```sql
-- 3.1 What is applied today?
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- 3.2 Row counts (must be reviewed before the migration)
select 'teams'        as table_name, count(*) from public.teams
union all select 'members',     count(*) from public.members
union all select 'topics',      count(*) from public.topics
union all select 'slots',       count(*) from public.slots
union all select 'bids',        count(*) from public.bids
union all select 'wallets',     count(*) from public.wallets
union all select 'settings',    count(*) from public.settings
union all select 'submissions', count(*) from public.submissions;

-- 3.3 Auction items per topic (the thing migration 011 reconciles)
select t.title,
       count(*) filter (where s.status in ('pending','open')) as active_items,
       count(*) filter (where s.status = 'sold')             as sold_items
from public.topics t
left join public.slots s on s.topic_id = t.id
group by t.title
order by t.title;

-- 3.4 Identity chain check — the captain's members.id MUST equal auth.users.id
select t.name                as team,
       t.captain_id          as teams_captain_id,
       m.id                  as members_id,
       u.id                  as auth_user_id,
       (m.id = u.id)         as chain_ok
from public.teams t
left join public.members m on m.id = t.captain_id
left join auth.users u     on lower(u.email) = lower(m.email)
order by t.name;

-- 3.5 Slots that a "sold once" rule could conflict with
select topic_id, count(*) as sold_items
from public.slots
where status = 'sold'
group by topic_id
having count(*) > 1;
```

**Stop and send me the output if 3.3 shows more than one active item for a topic
with a bid, or if 3.5 returns any rows.**

---

## 4. Apply

> **The runbook is an upgrade of the production database.** Migrations 001–009
> are already applied in production, which is what the runbook builds on. It
> must **not** be run against an empty database — the earlier migrations create
> the base tables it extends. (A fresh environment should apply 001→018 in
> order instead.)

1. Open the SQL Editor and create a **new query**.
2. Paste the entire contents of `docs/supabase-migration-runbook.sql`.
3. Run it **once**, as a single statement batch.

The runbook is idempotent: re-running it is safe. If a statement fails,
PostgreSQL rolls back the whole batch, so the database is left untouched and you
can send me the error.

Expected output: a long list of `CREATE TABLE`, `CREATE FUNCTION`, `CREATE INDEX`
and `DO` block results, ending with the final verification `DO` block.

> The runbook was validated exactly this way locally: migrations 001–009 first,
> then the runbook as **one batch** — 20 topics, 20 auction items, 52 public
> functions, every check green (`npm run test:sql`).

---

## 5. Post-flight verification (read-only — run this after)

```sql
-- 5.1 Every new object exists
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname in
      ('auction_sessions','auction_events','wallet_transactions',
       'bonus_transactions','team_eliminations')) as new_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in
      ('place_bid','open_slot','close_slot','skip_slot','reset_auction',
       'create_auction_topic','start_auction','select_auction_question',
       'open_bidding','close_bidding','finalize_auction','advance_auction',
       'pause_auction','resume_auction','end_auction_session',
       'start_auction_timer','pause_auction_timer','resume_auction_timer',
       'adjust_auction_timer','adjust_bidding_timer','eliminate_team',
       'restore_team','grant_bonus_time','approve_submission',
       'get_live_auction_state','get_auction_history','get_team_auction_state',
       'get_team_bid_history','get_team_points_balance','get_current_auction_item',
       'get_elimination_history','get_bonus_history','apply_wallet_transaction',
       'emit_auction_event','get_setting_int','is_judge','is_admin_or_judge',
       'align_identities')) as new_functions;

-- 5.2 Exactly one active auction item per topic, 20 items in total
select count(*) as active_items from (
  select topic_id from public.slots
  where status in ('pending','open')
  group by topic_id having count(*) > 1
) d;
select count(*) as total_items from public.slots;

-- 5.3 The identity chain is intact
select count(*) as broken_chains
from public.teams t
join public.members m on m.id = t.captain_id
join auth.users u on lower(u.email) = lower(m.email)
where m.id <> u.id;

-- 5.4 RLS is enabled everywhere it must be
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('slots','bids','wallets','wallet_transactions','auction_sessions',
                    'auction_events','bonus_transactions','team_eliminations',
                    'submissions','audit_log')
order by c.relname;

-- 5.5 The realtime publication contains the tables the clients listen to
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;

-- 5.6 The hidden test cases are no longer readable by participants
select has_column_privilege('authenticated', 'public.challenge_problems', 'test_cases', 'SELECT')
  as participants_can_read_test_cases;

-- 5.7 The engine reads its rules from the settings table
select key, value from public.settings
where key in ('min_bid','min_raise','opening_window_seconds','timer_extension_seconds',
              'bonus_time_seconds','starting_wallet_balance')
order by key;
```

**Expected values**

| Check | Expected |
|---|---|
| 5.1 new_tables | `5` |
| 5.1 new_functions | `39` |
| 5.2 active_items | `0` |
| 5.2 total_items | `20` (on the current empty database) |
| 5.3 broken_chains | `0` |
| 5.4 `relrowsecurity` | `true` for all ten tables |
| 5.5 publication | contains `auction_events`, `slots`, `bids`, `wallets`, `settings`, `teams` |
| 5.6 participants_can_read_test_cases | `false` |
| 5.7 settings | the six rules above |

---

## 6. Smoke test after the migration

Run these from the **Supabase SQL Editor** (they impersonate an admin via the
JWT claims, exactly like the test harness does):

```sql
-- 6.1 Impersonate the admin and read the live state
select set_config('request.jwt.claim.sub',
  (select id::text from auth.users where app_metadata->>'role' = 'admin' limit 1), false);
select set_config('request.jwt.claims',
  '{"sub":"' || (select id::text from auth.users where app_metadata->>'role' = 'admin' limit 1)
   || '","app_metadata":{"role":"admin"}}', false);

select public.get_live_auction_state();

-- 6.2 Start the session
select public.start_auction(1);

-- 6.3 Select the first problem statement and open bidding
select public.select_auction_question(
  (select s.id from public.slots s
   join public.topics t on t.id = s.topic_id
   where s.status = 'pending' order by s.question_number limit 1));

select public.open_bidding(
  (select id from public.slots where status = 'open' limit 1));

-- 6.4 The event stream is alive
select event_type, created_at, payload
from public.auction_events
order by created_at desc
limit 10;

-- 6.5 Clean up the smoke test
select public.reset_auction();
```

After 6.5 the database is back to "no session, no bids, full wallets".

---

## 7. Rollback

There is no automated rollback: the migrations are additive, so the safest
recovery is to **restore from a Supabase point-in-time backup**. Take a backup
before running the migrations (Supabase → Database → Backups → *Restore* /
*Download*), and record the restore point here:

```
Backup taken at : ____________  (before running the runbook)
Restore point   : ____________
```

If a statement fails mid-batch, PostgreSQL rolls the whole batch back and the
database is unchanged — just fix the statement and re-run.

---

## 8. Application configuration

No new environment variable is required by the migrations.

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | already set |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | already set |
| `SUPABASE_SERVICE_ROLE_KEY` | **recommended** | Needed by registration (creates the Auth user + the team rows) and by the submission insert. **Server-side only — never expose it to the browser.** If it is absent, registration and submission insertion will fail; everything else works. |

Deploy the application only after the post-flight checks pass.
