/**
 * Read-only live watcher for Bid2Build end-to-end verification.
 *
 * It does two things, and never writes anything:
 *   1. subscribes to INSERTs on public.auction_events (the Realtime path);
 *   2. polls get_live_auction_state() and prints the authoritative picture.
 *
 * Run it in a terminal next to the browser sessions:
 *
 *   node scripts/live-auction-watch.mjs
 *
 * Optional:
 *   WATCH_INTERVAL_MS=2000 node scripts/live-auction-watch.mjs
 *   WATCH_ONCE=1 node scripts/live-auction-watch.mjs   # 3s smoke test
 *
 * Uses the public anon key from .env.local. No login, no writes.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (name) => {
  const line = env.split(/\r?\n/).find((l) => l.startsWith(name + "="));
  return line ? line.slice(name.length + 1).trim() : null;
};

const url = get("NEXT_PUBLIC_SUPABASE_URL");
const key = get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const intervalMs = Number(process.env.WATCH_INTERVAL_MS ?? 5000);
const now = () => new Date().toISOString();
const short = (value) => (value ? String(value).slice(0, 8) : "-");

function summarize(state) {
  const session = state.session;
  const item = state.active_slot;
  return {
    server_time: state.server_time,
    session: session
      ? {
          id: short(session.id),
          status: session.status,
          round: session.round,
          paused: session.is_paused,
          timer: session.timer_status,
          active_slot: short(session.active_slot_id),
        }
      : null,
    item: item
      ? {
          id: short(item.id),
          status: item.status,
          current_bid: item.current_bid,
          leader: item.leader_team_name,
          min_next_bid: item.min_next_bid,
          end_time: item.end_time,
          timer: item.timer_status,
          paused_remaining: item.paused_remaining_seconds,
        }
      : null,
    sold: state.items_sold,
    teams: state.teams.map(
      (team) =>
        `${team.name}: balance=${team.balance} best=${team.current_bid}${
          team.eliminated ? " ELIMINATED" : ""
        }`
    ),
  };
}

async function snapshot(label) {
  const { data, error } = await supabase.rpc("get_live_auction_state");
  if (error) {
    console.log(now(), label, "STATE ERROR:", error.message);
    return;
  }
  console.log(now(), label, JSON.stringify(summarize(data)));
}

console.log(now(), "READ-ONLY watcher starting; writes nothing");
await snapshot("INITIAL");

const channel = supabase
  .channel("b2b-e2e-watch-" + Date.now())
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "auction_events" },
    (payload) => {
      const event = payload.new;
      const latency =
        event.server_timestamp != null
          ? Date.now() - new Date(event.server_timestamp).getTime()
          : null;
      console.log(
        now(),
        "EVENT",
        event.event_type,
        "slot=" + short(event.slot_id),
        "team=" + short(event.team_id),
        latency != null ? `latency=${latency}ms` : "",
        JSON.stringify(event.payload ?? {})
      );
    }
  )
  .subscribe((status) => console.log(now(), "REALTIME", status));

const poll = setInterval(() => snapshot("STATE"), intervalMs);

async function stop() {
  clearInterval(poll);
  await supabase.removeChannel(channel);
  console.log(now(), "stopped");
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

if (process.env.WATCH_ONCE === "1") {
  setTimeout(stop, 3000);
}
