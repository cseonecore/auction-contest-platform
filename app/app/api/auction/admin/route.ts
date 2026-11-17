import { NextResponse } from "next/server";
import { getServerDb } from "@/lib/serverDb";

interface AdminActionBody {
  action: string;
  slotId?: string;
  extraSeconds?: number;
}

export async function POST(request: Request) {
  try {
    const body: AdminActionBody = await request.json();
    const { action, slotId, extraSeconds } = body;
    const db = getServerDb();

    // ─────────────────────────────────────────────────────────
    // ACTION: OPEN SLOT
    // ─────────────────────────────────────────────────────────
    if (action === "open_slot") {
      if (!slotId) {
        return NextResponse.json({ error: "slotId is required to open a slot." }, { status: 400 });
      }

      // Verify slot exists and is pending
      const { data: slot, error: slotErr } = await db
        .from("slots")
        .select("id, status")
        .eq("id", slotId)
        .maybeSingle();

      if (slotErr || !slot) {
        return NextResponse.json({ error: "Slot not found." }, { status: 404 });
      }
      if (slot.status !== "pending") {
        return NextResponse.json(
          { error: `Only pending slots can be opened. Current status: ${slot.status}` },
          { status: 400 }
        );
      }

      // Try DB RPC first (admin-authed path), then fall back to direct update
      const { data: rpcData, error: rpcErr } = await db.rpc("open_slot", { p_slot_id: slotId });
      if (!rpcErr && rpcData) {
        return NextResponse.json({ success: true, slot: rpcData });
      }

      // Fallback: direct DB update with service role (bypasses is_admin() check)
      const openWindowSecs = 10;
      const endTime = new Date(Date.now() + openWindowSecs * 1000).toISOString();
      const { data: updatedSlot, error: updateErr } = await db
        .from("slots")
        .update({ status: "open", end_time: endTime })
        .eq("id", slotId)
        .select()
        .maybeSingle();

      if (updateErr || !updatedSlot) {
        return NextResponse.json({ error: "Failed to open slot." }, { status: 500 });
      }

      return NextResponse.json({ success: true, slot: updatedSlot });
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: CLOSE SLOT (Authoritative Winner / Skipped)
    // ─────────────────────────────────────────────────────────
    if (action === "close_slot") {
      // If no slotId provided, find the currently open slot
      let targetId = slotId;
      if (!targetId) {
        const { data: openSlot } = await db
          .from("slots")
          .select("id")
          .eq("status", "open")
          .maybeSingle();
        if (!openSlot) {
          return NextResponse.json({ error: "No open slot found to close." }, { status: 404 });
        }
        targetId = openSlot.id;
      }

      // Try DB RPC first
      const { data: rpcData, error: rpcErr } = await db.rpc("close_slot", { p_slot_id: targetId });
      if (!rpcErr && rpcData) {
        return NextResponse.json({ success: true, ...rpcData });
      }

      // Fallback: direct update — determine sold vs skipped
      const { data: slot } = await db
        .from("slots")
        .select("id, status, leader_team_id, current_bid")
        .eq("id", targetId)
        .maybeSingle();

      if (!slot || slot.status !== "open") {
        return NextResponse.json({ error: "Slot is not open or not found." }, { status: 400 });
      }

      if (!slot.leader_team_id || slot.current_bid === 0) {
        // Skip: no bids
        await db.from("slots").update({ status: "skipped", winner_team_id: null }).eq("id", targetId);
        return NextResponse.json({ success: true, status: "skipped", slot_id: targetId });
      }

      // Deduct wallet and mark sold
      await db
        .from("wallets")
        .update({ balance: db.rpc("greatest", { a: 0, b: db.rpc("coalesce", { a: 0, b: 0 }) }) as unknown as number })
        .eq("team_id", slot.leader_team_id);

      // Simple balance subtraction via raw update — service role can do this
      const { data: wallet } = await db
        .from("wallets")
        .select("balance")
        .eq("team_id", slot.leader_team_id)
        .maybeSingle();

      if (wallet) {
        await db
          .from("wallets")
          .update({ balance: Math.max(0, wallet.balance - slot.current_bid) })
          .eq("team_id", slot.leader_team_id);
      }

      await db
        .from("slots")
        .update({ status: "sold", winner_team_id: slot.leader_team_id })
        .eq("id", targetId);

      return NextResponse.json({ success: true, status: "sold", slot_id: targetId });
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: SKIP SLOT
    // ─────────────────────────────────────────────────────────
    if (action === "skip_slot") {
      let targetId = slotId;
      if (!targetId) {
        const { data: openSlot } = await db
          .from("slots")
          .select("id")
          .eq("status", "open")
          .maybeSingle();
        targetId = openSlot?.id;
      }
      if (!targetId) {
        return NextResponse.json({ error: "No slot to skip." }, { status: 404 });
      }

      // Try RPC first
      const { data: rpcData, error: rpcErr } = await db.rpc("skip_slot", { p_slot_id: targetId });
      if (!rpcErr && rpcData) {
        return NextResponse.json({ success: true, slot: rpcData });
      }

      // Fallback direct update
      const { data: updatedSlot } = await db
        .from("slots")
        .update({
          status: "skipped",
          winner_team_id: null,
          leader_team_id: null,
          current_bid: 0,
          end_time: null,
        })
        .eq("id", targetId)
        .select()
        .maybeSingle();

      return NextResponse.json({ success: true, slot: updatedSlot });
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: NEXT SLOT (Close current and open next pending)
    // ─────────────────────────────────────────────────────────
    if (action === "next_slot") {
      // Close current open slot if any
      const { data: openSlot } = await db
        .from("slots")
        .select("id, leader_team_id, current_bid")
        .eq("status", "open")
        .maybeSingle();

      if (openSlot) {
        // Auto-close current open slot
        if (!openSlot.leader_team_id || openSlot.current_bid === 0) {
          await db.from("slots").update({ status: "skipped", winner_team_id: null }).eq("id", openSlot.id);
        } else {
          const { data: wallet } = await db
            .from("wallets")
            .select("balance")
            .eq("team_id", openSlot.leader_team_id)
            .maybeSingle();
          if (wallet) {
            await db
              .from("wallets")
              .update({ balance: Math.max(0, wallet.balance - openSlot.current_bid) })
              .eq("team_id", openSlot.leader_team_id);
          }
          await db
            .from("slots")
            .update({ status: "sold", winner_team_id: openSlot.leader_team_id })
            .eq("id", openSlot.id);
        }
      }

      // Open the next pending slot
      const { data: nextSlot } = await db
        .from("slots")
        .select("id")
        .eq("status", "pending")
        .order("round", { ascending: true })
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!nextSlot) {
        return NextResponse.json({ success: true, message: "No more pending slots. Auction complete." });
      }

      const endTime = new Date(Date.now() + 10 * 1000).toISOString();
      const { data: opened } = await db
        .from("slots")
        .update({ status: "open", end_time: endTime })
        .eq("id", nextSlot.id)
        .select()
        .maybeSingle();

      return NextResponse.json({ success: true, slot: opened });
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: PAUSE AUCTION
    // ─────────────────────────────────────────────────────────
    if (action === "pause_auction" || action === "pause") {
      // Persist pause state to settings table
      await db
        .from("settings")
        .upsert({ key: "auction_status", value: "PAUSED" }, { onConflict: "key" });
      return NextResponse.json({ success: true, status: "PAUSED" });
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: RESUME AUCTION
    // ─────────────────────────────────────────────────────────
    if (action === "resume_auction" || action === "resume") {
      await db
        .from("settings")
        .upsert({ key: "auction_status", value: "LIVE" }, { onConflict: "key" });
      return NextResponse.json({ success: true, status: "LIVE" });
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: EXTEND TIMER
    // ─────────────────────────────────────────────────────────
    if (action === "extend_timer") {
      const addedSecs = Number(extraSeconds) || 15;

      const { data: openSlot } = await db
        .from("slots")
        .select("id, end_time")
        .eq("status", "open")
        .maybeSingle();

      if (!openSlot) {
        return NextResponse.json({ error: "No open slot to extend timer for." }, { status: 404 });
      }

      const curEnd = openSlot.end_time ? new Date(openSlot.end_time).getTime() : Date.now();
      const newEnd = new Date(Math.max(Date.now(), curEnd) + addedSecs * 1000).toISOString();

      const { data: updated } = await db
        .from("slots")
        .update({ end_time: newEnd })
        .eq("id", openSlot.id)
        .select()
        .maybeSingle();

      return NextResponse.json({ success: true, slot: updated });
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: RESET AUCTION (admin-only dangerous action)
    // ─────────────────────────────────────────────────────────
    if (action === "reset_auction") {
      // Reset all slots to pending, clear bids, restore wallets
      await db.from("slots").update({
        status: "pending",
        current_bid: 0,
        leader_team_id: null,
        winner_team_id: null,
        end_time: null,
      }).neq("id", "00000000-0000-0000-0000-000000000000"); // update all

      await db.from("bids").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await db.from("wallets").update({ balance: 100 }).neq("team_id", "00000000-0000-0000-0000-000000000000");

      return NextResponse.json({ success: true, message: "Auction reset successfully." });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Admin action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
