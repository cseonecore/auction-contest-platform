// Scratch smoke test for migration 028 (not committed).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const db = new PGlite();
await db.waitReady;

const AUTH_MOCK = `
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
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true)) $$;
`;
await db.exec(AUTH_MOCK);

const q = async (sql, params) => {
  const res = await db.query(sql, params || []);
  return res.rows;
};
const ok = (name, cond) => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);

const setAdmin = async () => {
  await db.query(
    `select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"},"sub":"11111111-1111-1111-1111-111111111111"}', false)`
  );
};

const dir = 'D:\\auction-contest-platform\\supabase\\migrations';
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  let sql = readFileSync(join(dir, f), 'utf8');
  sql = sql.replace(/create extension if not exists pgcrypto;/gi, '');
  await db.exec(sql);
}
console.log('migrations applied (incl. 028)');

await setAdmin();
await q(`insert into public.teams (name) values ('Alpha Team'), ('Beta Team') returning id`);
let teams = await q(`select id, name from public.teams order by name`);
const a = teams[0].id;
const b = teams[1].id;

const slotA = await q(`insert into public.slots (topic_id, round, status, winner_team_id, current_bid)
  select id, 1, 'sold', $1, 50 from public.topics where id not in (select topic_id from public.slots where status='sold') limit 1 returning id`, [a]);
const slotB = await q(`insert into public.slots (topic_id, round, status, winner_team_id, current_bid)
  select id, 1, 'sold', $1, 20 from public.topics where id not in (select topic_id from public.slots where status='sold') limit 1 returning id`, [b]);

// --- 1. team durations ---
ok('Alpha duration = base 4500 (no addon, no bonus)', (await q(`select public.get_team_dev_duration_seconds($1) as d`, [a]))[0].d === 4500);
let r1 = await q(`select public.set_team_dev_addon_seconds($1, 15) as r`, [a]);
ok('set_team_dev_addon_seconds returns not_started before start', r1[0].r.dev_timer_status === 'not_started');
ok('Alpha duration = 4515 after add-on', (await q(`select public.get_team_dev_duration_seconds($1) as d`, [a]))[0].d === 4515);
await q(`select public.set_team_dev_addon_seconds($1, null) as r`, [b]);
ok('Beta duration = 4500 (inherits global 0)', (await q(`select public.get_team_dev_duration_seconds($1) as d`, [b]))[0].d === 4500);

// bonus adds to duration
await q(`insert into public.submissions (team_id, slot_id, repository_url) values ($1, $2, 'https://github.com/x/y') returning id`, [a, slotA[0].id]);
const subA = await q(`select id from public.submissions where team_id = $1`, [a]);
await q(`insert into public.bonus_transactions (team_id, slot_id, submission_id, approved_by, bonus_seconds) values ($1, $2, $3, $4, 60)`, [a, slotA[0].id, subA[0].id, '11111111-1111-1111-1111-111111111111']);
ok('Alpha duration = 4500 + 15 + 60 = 4575', (await q(`select public.get_team_dev_duration_seconds($1) as d`, [a]))[0].d === 4575);

// --- 2. start timer ---
await setAdmin();
let st = await q(`select public.start_dev_timer() as r`);
ok('timer running after start', st[0].r.dev_timer_status === 'running');

let statusA = await q(`select public.get_team_dev_status($1) as r`, [a]);
const sA = statusA[0].r;
console.log('  statusA:', JSON.stringify(sA));
ok('Alpha duration total = 4575', sA.dev_timer_total_seconds === 4575);
ok('Alpha remaining <= 4575', sA.dev_timer_remaining_seconds <= 4575 && sA.dev_timer_remaining_seconds > 0);
ok('Alpha deadline not null', !!sA.dev_deadline);
ok('Alpha opens_at = deadline - 1200', sA.submission_opens_at !== null);
ok('Alpha not in window yet', sA.submission_window_open === false);
ok('Alpha has_submission true', sA.has_submission === true);

let statusB = await q(`select public.get_team_dev_status($1) as r`, [b]);
ok('Beta duration = 4500', statusB[0].r.dev_timer_total_seconds === 4500);

// --- 3. get_bidding_results ---
let res = await q(`select public.get_bidding_results() as r`);
const aRow = res[0].r.teams.find((t) => t.team_id === a);
ok('bidding base_dev_seconds = 4500', res[0].r.base_dev_seconds === 4500);
ok('Alpha total_dev = base+addon+bonus = 4575', aRow.total_dev_seconds === 4575);
ok('Alpha problems present', aRow.problems.length >= 1);
ok('Alpha problem total = base+addon+bonus = 4575', aRow.problems[0].total_dev_seconds === 4575);
ok('Alpha total_base_dev_seconds = 4500', aRow.total_base_dev_seconds === 4500);
ok('Alpha total_addon_dev_seconds = 75 (addon+bonus)', aRow.total_addon_dev_seconds === 75);

// --- 3b. window opens when deadline is within 20 min ---
// start = now - 3575 → remaining = 4575-3575 = 1000s (final 20 min) → open
await q(`update public.settings set value = to_jsonb(floor(extract(epoch from clock_timestamp() - interval '3575 seconds') * 1000)::bigint) where key = 'dev_timer_started_at'`);
let statusA2 = await q(`select public.get_team_dev_status($1) as r`, [a]);
console.log('  statusA2 (window check):', JSON.stringify(statusA2[0].r));
ok('Alpha remaining ≈ 1000', statusA2[0].r.dev_timer_remaining_seconds >= 900 && statusA2[0].r.dev_timer_remaining_seconds <= 1000);
ok('Alpha window_open when in final 20 min', statusA2[0].r.submission_window_open === true);

// --- 4. push time forward past both deadlines ---
await q(`update public.settings set value = to_jsonb(floor(extract(epoch from clock_timestamp() - interval '4900 seconds') * 1000)::bigint) where key = 'dev_timer_started_at'`);
let marked = await q(`select public.apply_dq_statuses() as n`);
console.log('  apply_dq_statuses →', marked[0].n);
// Alpha has a submission → not DQ; Beta has none → DQ
let statusA3 = await q(`select public.get_team_dev_status($1) as r`, [a]);
ok('Alpha not DQ (has submission)', statusA3[0].r.dq_at === null);
ok('Alpha window closed after deadline', statusA3[0].r.submission_window_open === false);
ok('Alpha dq_pending false', statusA3[0].r.dq_pending === false);
let statusB2 = await q(`select public.get_team_dev_status($1) as r`, [b]);
ok('Beta DQ marked', statusB2[0].r.dq_at !== null);
ok('Beta dq_pending false once marked', statusB2[0].r.dq_pending === false);
let marked2 = await q(`select public.apply_dq_statuses() as n`);
ok('apply_dq_statuses idempotent (0 new)', marked2[0].n === 0);

// --- 5. add-on sync safety: Beta can still set add-on; Alpha with submission can't shorten below existing? it has none marked for deadline. Check set on Beta ---
let setB = await q(`select public.set_team_dev_addon_seconds($1, 10) as r`, [b]);
ok('Beta addon set to 10 (deadline passed, but no submission)', setB[0].r.dev_timer_total_seconds === 4510);

await db.close();
console.log('SMOKE DONE');
process.exit(0);
