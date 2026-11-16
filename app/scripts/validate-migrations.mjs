/**
 * SQL migration validator.
 *
 * Runs the real PostgreSQL migrations against an embedded Postgres
 * (PGlite — the official Postgres compiled to WebAssembly) so that
 * syntax, plpgsql bodies, triggers, constraints and RLS are really
 * executed before the migrations are handed to the Supabase SQL
 * Editor.
 *
 * It also provides a Supabase-compatible `auth` schema mock so the
 * SECURITY DEFINER functions can be exercised with a simulated
 * authenticated caller.
 *
 *   node scripts/validate-migrations.mjs
 */

import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

/** Minimal Supabase auth schema so auth.uid()/auth.jwt() resolve. */
const AUTH_MOCK = `
-- Supabase roles
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true));
$$;
`

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

async function main() {
  const db = new PGlite()
  await db.waitReady

  await db.exec(AUTH_MOCK)

  const files = migrationFiles()
  const failures = []

  for (const file of files) {
    const raw = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    // PGlite ships without the pgcrypto extension. gen_random_uuid() has been
    // part of core PostgreSQL since v13, so the extension is not required for
    // any statement in this repository.
    const sql = raw.replace(/create extension if not exists pgcrypto;/gi, '-- (pgcrypto not bundled in PGlite; gen_random_uuid() is core in PG13+)')
    try {
      await db.exec(sql)
      console.log(`  PASS  ${file}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ file, message })
      console.error(`  FAIL  ${file}`)
      console.error(`        ${message.split('\n')[0]}`)
      // Stop at the first failure: later migrations depend on earlier ones.
      break
    }
  }

  if (failures.length > 0) {
    console.error('\nMigration validation FAILED.')
    process.exitCode = 1
    await db.close()
    return
  }

  // Post-migration smoke checks ------------------------------------------------
  const checks = [
    {
      name: '20 topics seeded',
      sql: `select count(*)::int as n from public.topics`,
      expect: (r) => r.n === 20,
    },
    {
      name: 'exactly one active auction item per topic',
      sql: `select count(*)::int as n from (
              select topic_id from public.slots
              where status in ('pending','open')
              group by topic_id having count(*) > 1
            ) x`,
      expect: (r) => r.n === 0,
    },
    {
      name: 'auction items equal the number of topics',
      sql: `select count(*)::int as n from public.slots`,
      expect: (r) => r.n === 20,
    },
    {
      name: 'settings present',
      sql: `select count(*)::int as n from public.settings
            where key in ('min_bid','min_raise','opening_window_seconds',
                          'timer_extension_seconds','bonus_time_seconds')`,
      expect: (r) => r.n === 5,
    },
    {
      name: 'new RPCs are callable',
      sql: `select count(*)::int as n from pg_proc p
            join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname = any(array[
              'place_bid','open_slot','close_slot','skip_slot','reset_auction',
              'create_auction_topic','start_auction','select_auction_question',
              'open_bidding','close_bidding','finalize_auction','advance_auction',
              'pause_auction','resume_auction','end_auction_session',
              'start_auction_timer','pause_auction_timer','resume_auction_timer',
              'adjust_auction_timer','eliminate_team','restore_team',
              'grant_bonus_time','approve_submission','get_live_auction_state',
              'get_auction_history','get_team_auction_state','get_team_bid_history',
              'get_team_points_balance','get_current_auction_item',
              'get_elimination_history','get_bonus_history','apply_wallet_transaction',
              'emit_auction_event','get_setting_int','is_judge','is_admin_or_judge'
            ])`,
      expect: (r) => r.n === 36,
    },
    {
      name: 'RLS enabled on every auction table',
      sql: `select count(*)::int as n from pg_class c
            join pg_namespace ns on ns.oid = c.relnamespace
            where ns.nspname = 'public' and c.relkind = 'r'
              and c.relname in ('slots','bids','wallets','wallet_transactions',
                                'auction_sessions','auction_events','bonus_transactions',
                                'team_eliminations','submissions','audit_log')
              and c.relrowsecurity`,
      expect: (r) => r.n === 10,
    },
    {
      name: 'no auction table is left without RLS',
      sql: `select coalesce(string_agg(c.relname, ', '), '') as missing from pg_class c
            join pg_namespace ns on ns.oid = c.relnamespace
            where ns.nspname = 'public' and c.relkind = 'r'
              and c.relname in ('slots','bids','wallets','wallet_transactions',
                                'auction_sessions','auction_events','bonus_transactions',
                                'team_eliminations','submissions','audit_log')
              and not c.relrowsecurity`,
      expect: (r) => r.missing === '',
    },
    {
      name: 'sold-once unique index exists',
      sql: `select count(*)::int as n from pg_indexes
            where schemaname = 'public' and indexname = 'slots_topic_sold_once_idx'`,
      expect: (r) => r.n === 1,
    },
    {
      name: 'win-deduction once index exists',
      sql: `select count(*)::int as n from pg_indexes
            where schemaname = 'public' and indexname = 'wallet_tx_win_deduction_once_idx'`,
      expect: (r) => r.n === 1,
    },
  ]

  console.log('\nPost-migration checks:')
  let failed = 0
  for (const check of checks) {
    try {
      const res = await db.query(check.sql)
      const row = res.rows[0]
      const ok = check.expect(row)
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${check.name} (got ${JSON.stringify(row)})`)
      if (!ok) failed++
    } catch (err) {
      failed++
      console.error(`  FAIL  ${check.name}: ${err.message}`)
    }
  }

  await db.close()

  if (failed > 0) {
    console.error(`\n${failed} post-migration check(s) failed.`)
    process.exitCode = 1
    return
  }

  console.log('\nAll migrations applied cleanly and every post-migration check passed.')

  // Consolidated runbook check ---------------------------------------------
  // The runbook is an UPGRADE of the production database, so it is validated
  // the same way: migrations 001-009 first (they are already applied in
  // production), then the runbook as ONE batch.
  const runbookPath = join(ROOT, 'docs', 'supabase-migration-runbook.sql')
  if (existsSync(runbookPath)) {
    console.log('\nConsolidated runbook (docs/supabase-migration-runbook.sql):')
    const runbook = new PGlite()
    await runbook.waitReady
    await runbook.exec(AUTH_MOCK)

    // Production already has 001-009 applied.
    for (const file of migrationFiles().filter((f) => f < '010')) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(
        /create extension if not exists pgcrypto;/gi,
        '-- (pgcrypto not bundled in PGlite)'
      )
      await runbook.exec(sql)
    }

    const sql = readFileSync(runbookPath, 'utf8').replace(
      /create extension if not exists pgcrypto;/gi,
      '-- (pgcrypto not bundled in PGlite; gen_random_uuid() is core in PG13+)'
    )

    try {
      await runbook.exec(sql)
      const topics = await runbook.query(`select count(*)::int as n from public.topics`)
      const slots = await runbook.query(`select count(*)::int as n from public.slots`)
      const fns = await runbook.query(
        `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname='public'`
      )
      console.log(`  PASS  the runbook applies as a single batch on top of 001-009`)
      console.log(`        topics=${topics.rows[0].n} slots=${slots.rows[0].n} functions=${fns.rows[0].n}`)
      await runbook.close()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`  FAIL  the runbook failed to apply: ${message.split('\n')[0]}`)
      await runbook.close()
      process.exitCode = 1
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
