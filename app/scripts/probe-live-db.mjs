/**
 * Read-only probe of the live Supabase project (anon key only).
 * Reports: session, live slot, event types present, RLS reachability.
 */
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (name) => {
  const line = env.split(/\r?\n/).find((l) => l.startsWith(name + "="));
  return line ? line.slice(name.length + 1).trim() : null;
};
const URL_BASE = get("NEXT_PUBLIC_SUPABASE_URL");
const KEY = get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rpc(name, body = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function table(name, query) {
  const res = await fetch(`${URL_BASE}/rest/v1/${name}?${query}`, { headers: H });
  const text = await res.text();
  return { status: res.status, text };
}

const live = await rpc("get_live_auction_state");
console.log("== get_live_auction_state:", live.status);
if (live.status === 200) {
  const s = JSON.parse(live.text);
  console.log("  session:", JSON.stringify(s.session));
  console.log("  active_slot:", s.active_slot ? JSON.stringify({ id: s.active_slot.id, status: s.active_slot.status, current_bid: s.active_slot.current_bid, end_time: s.active_slot.end_time, timer_status: s.active_slot.timer_status }) : null);
  console.log("  total_items:", s.total_items, "items_sold:", s.items_sold, "teams:", s.teams?.length, "events:", s.events?.length);
} else {
  console.log("  ", live.text.slice(0, 400));
}

const active = await rpc("get_active_session");
console.log("== get_active_session:", active.status, active.text.slice(0, 300));

const evts = await table("auction_events", "select=event_type,server_timestamp&order=server_timestamp.desc&limit=200");
console.log("== auction_events (readable):", evts.status);
if (evts.status === 200) {
  const rows = JSON.parse(evts.text);
  const counts = {};
  for (const r of rows) counts[r.event_type] = (counts[r.event_type] ?? 0) + 1;
  console.log("  event type counts (latest 200):", JSON.stringify(counts));
  const lifecycle = rows.filter((r) => r.event_type.startsWith("session_"));
  console.log("  lifecycle events present:", lifecycle.length ? lifecycle.map((e) => e.event_type).join(", ") : "NONE — migration 019 NOT applied or no lifecycle transitions yet");
} else {
  console.log("  ", evts.text.slice(0, 200));
}

const slots = await table("slots", "select=id,status,round&limit=5");
console.log("== slots (anon readable):", slots.status, slots.status === 200 ? JSON.parse(slots.text).length + " rows" : slots.text.slice(0, 120));
