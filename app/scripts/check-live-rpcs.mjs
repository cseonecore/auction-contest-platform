/**
 * Live RPC health check.
 *
 * Confirms the linked Supabase project exposes the auction/submission RPCs
 * the admin UI depends on, and that get_live_auction_state() can actually
 * execute (it fails when public.settle_expired_slots() is missing).
 *
 * Run after applying docs/production-deploy-029-031.sql:
 *   node scripts/check-live-rpcs.mjs
 *
 * Exit code 0 = healthy, 1 = problems found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, '..', '.env.local');

if (!fs.existsSync(envPath)) {
  console.error(`Missing ${envPath}`);
  process.exit(1);
}

const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !publicKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and a publishable/anon key are required in .env.local');
  process.exit(1);
}

const required = [
  'settle_slot',
  'settle_expired_slots',
  'finalize_round_3_eliminations',
  'reject_submission',
  'reopen_submission',
  'get_live_auction_state',
  'start_auction',
  'place_bid',
  'close_slot',
  'get_contest_flow_state',
  'start_dev_timer',
  'pause_dev_timer',
  'reset_dev_timer',
  'enable_submissions',
  'disable_submissions',
  'get_team_dev_status',
  'set_team_dev_addon_seconds',
  'get_bidding_results',
];

let failures = 0;

function pass(msg) {
  console.log(`  PASS  ${msg}`);
}

function fail(msg) {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
}

// 1. Function inventory from the PostgREST OpenAPI document.
{
  const key = serviceKey || publicKey;
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/openapi+json',
    },
  });

  if (!res.ok) {
    fail(`could not read the PostgREST schema (HTTP ${res.status})`);
  } else {
    const spec = await res.json();
    const live = new Set(
      Object.keys(spec.paths ?? {})
        .filter((p) => p.startsWith('/rpc/'))
        .map((p) => p.replace('/rpc/', ''))
    );

    console.log('Required RPCs present in the schema:');
    for (const name of required) {
      if (live.has(name)) pass(name);
      else fail(`${name} is missing — apply docs/production-deploy-029-031.sql`);
    }
  }
}

// 2. Execute the state read the whole admin UI depends on.
console.log('\nRuntime check:');
{
  const res = await fetch(`${url}/rest/v1/rpc/get_live_auction_state`, {
    method: 'POST',
    headers: {
      apikey: publicKey,
      Authorization: `Bearer ${publicKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const text = await res.text();

  if (res.ok) {
    pass(`get_live_auction_state() returned ${text.length} bytes`);
  } else {
    fail(`get_live_auction_state() failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
}

// 3. Execute the contest-flow read that powers the timer/portal controls.
{
  const res = await fetch(`${url}/rest/v1/rpc/get_contest_flow_state`, {
    method: 'POST',
    headers: {
      apikey: publicKey,
      Authorization: `Bearer ${publicKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const text = await res.text();

  if (!res.ok) {
    fail(`get_contest_flow_state() failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  } else {
    let flow = null;
    try {
      flow = JSON.parse(text);
    } catch {
      // handled below
    }
    if (!flow || typeof flow !== 'object') {
      fail('get_contest_flow_state() did not return a JSON object');
    } else if (!('dev_timer_status' in flow) || !('dev_timer_paused_at_ms' in flow)) {
      fail('get_contest_flow_state() is the pre-030 build (missing pause-aware status)');
    } else if (!('submissions_suppressed' in flow)) {
      fail('get_contest_flow_state() is the pre-030 build (missing submissions_suppressed)');
    } else {
      pass(
        `get_contest_flow_state() status=${flow.dev_timer_status}, submissions_enabled=${flow.submissions_enabled}`
      );
    }
  }
}

console.log(
  failures === 0
    ? '\nAll checks passed. The auction console can load live state.'
    : `\n${failures} check(s) failed. Fix the database, then re-run this script.`
);

process.exit(failures === 0 ? 0 : 1);
