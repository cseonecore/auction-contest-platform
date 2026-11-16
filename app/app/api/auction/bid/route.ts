import { NextResponse } from "next/server";
import { getServerDb } from "@/lib/serverDb";

interface BidRequest {
  slotId: string;
  amount: number;
  teamId: string;
}

export async function POST(request: Request) {
  try {
    const body: BidRequest = await request.json();
    const { slotId, amount, teamId } = body;

    if (!slotId) {
      return NextResponse.json({ error: "Slot ID is required." }, { status: 400 });
    }
    if (!teamId) {
      return NextResponse.json({ error: "Team ID is required to place a bid." }, { status: 400 });
    }

    const bidAmount = Math.floor(Number(amount));
    if (isNaN(bidAmount) || bidAmount <= 0) {
      return NextResponse.json({ error: "Bid amount must be a positive integer." }, { status: 400 });
    }

    const db = getServerDb();

    // 1. Verify the team exists and load current wallet balance
    const { data: team, error: teamErr } = await db
      .from("teams")
      .select("id, name")
      .eq("id", teamId)
      .maybeSingle();

    if (teamErr || !team) {
      return NextResponse.json({ error: "Team not found." }, { status: 404 });
    }

    // 2. Lock and verify the slot is open
    const { data: slot, error: slotErr } = await db
      .from("slots")
      .select("id, status, current_bid, leader_team_id, end_time, round")
      .eq("id", slotId)
      .maybeSingle();

    if (slotErr || !slot) {
      return NextResponse.json({ error: "Auction slot not found." }, { status: 404 });
    }
    if (slot.status !== "open") {
      return NextResponse.json({ error: "This auction slot is not open for bidding." }, { status: 400 });
    }

    // 3. Check slot hasn't expired
    if (slot.end_time && new Date(slot.end_time) <= new Date()) {
      return NextResponse.json({ error: "This auction slot has expired." }, { status: 400 });
    }

    // 4. Minimum bid / raise validation (Rule Book §5.3: min 10, raise min 10)
    const minBid = slot.current_bid === 0 ? 10 : slot.current_bid + 10;
    if (bidAmount < minBid) {
      return NextResponse.json(
        { error: `Bid too low. Current bid is ${slot.current_bid} pts — minimum next bid is ${minBid} pts.` },
        { status: 400 }
      );
    }

    // 5. Team cannot re-bid while already leading
    if (slot.leader_team_id === teamId) {
      return NextResponse.json(
        { error: "Your team is already the highest bidder on this slot." },
        { status: 400 }
      );
    }

    // 6. One slot won per round per team
    const { data: wonSlots } = await db
      .from("slots")
      .select("id")
      .eq("winner_team_id", teamId)
      .eq("round", slot.round)
      .eq("status", "sold");

    if (wonSlots && wonSlots.length > 0) {
      return NextResponse.json(
        { error: `Your team has already won a slot in Round ${slot.round}. Each team may win one slot per round.` },
        { status: 400 }
      );
    }

    // 7. Balance check — team must be able to afford the winning bid
    const { data: wallet, error: walletErr } = await db
      .from("wallets")
      .select("balance")
      .eq("team_id", teamId)
      .maybeSingle();

    if (walletErr || !wallet) {
      return NextResponse.json({ error: "Wallet not found for this team." }, { status: 400 });
    }
    if (wallet.balance < bidAmount) {
      return NextResponse.json(
        { error: `Insufficient balance. Your wallet has ${wallet.balance} pts; this bid requires ${bidAmount} pts.` },
        { status: 400 }
      );
    }

    // 8. Record the bid — NO wallet deduction; deduction happens only on close_slot
    const { error: bidInsertErr } = await db
      .from("bids")
      .insert({ slot_id: slotId, team_id: teamId, amount: bidAmount });

    if (bidInsertErr) {
      return NextResponse.json({ error: "Failed to record bid. Please try again." }, { status: 500 });
    }

    // 9. Update slot: new leader, new current bid, +5 seconds (Rule Book §5.2)
    const timerExtSecs = 5;
    const currentEnd = slot.end_time ? new Date(slot.end_time).getTime() : Date.now();
    const newEndTime = new Date(Math.max(Date.now(), currentEnd) + timerExtSecs * 1000).toISOString();

    const { data: updatedSlot, error: updateErr } = await db
      .from("slots")
      .update({
        current_bid: bidAmount,
        leader_team_id: teamId,
        end_time: newEndTime,
      })
      .eq("id", slotId)
      .select("id, status, current_bid, leader_team_id, end_time, round")
      .maybeSingle();

    if (updateErr || !updatedSlot) {
      return NextResponse.json({ error: "Failed to update slot. Please try again." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        slot_id: slotId,
        team_id: teamId,
        amount: bidAmount,
        wallet_balance: wallet.balance, // unchanged until win
        new_end_time: newEndTime,
        slot: updatedSlot,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to place bid";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
