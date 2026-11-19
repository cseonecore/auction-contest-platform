import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface BidRequest {
  slotId: string;
  amount: number;
}

/**
 * Place a bid.
 *
 * The caller's team is resolved from their authenticated session by
 * the database (`place_bid()` looks up `teams.captain_id` from
 * `auth.uid()`), so a client cannot bid on behalf of another team.
 * The RPC locks the auction item row, so concurrent bids are
 * serialised and the highest bid can never regress.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BidRequest;
    const { slotId, amount } = body;

    if (!slotId) {
      return NextResponse.json({ error: "Slot ID is required." }, { status: 400 });
    }

    const bidAmount = Math.floor(Number(amount));
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
      return NextResponse.json(
        { error: "Bid amount must be a positive integer." },
        { status: 400 }
      );
    }

    // Session-bound client: the JWT identifies the captain, and the
    // database resolves the team from it.
    const db = await createClient();

    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json(
        { error: "You must be signed in to place a bid." },
        { status: 401 }
      );
    }

    const { data, error } = await db.rpc("place_bid", {
      p_slot_id: slotId,
      p_amount: bidAmount,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to place bid";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
