"use client";

/**
 * Auction service layer.
 *
 * Every call goes through a PostgreSQL function that performs its own
 * authorisation and validation. No component ever writes to a table
 * directly and no component ever computes a balance.
 */

import { supabase } from "@/lib/supabase";
import type {
  LiveAuctionState,
  TeamAuctionState,
  AuctionBid,
} from "../types/auction.types";

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function toMessage(error: { message?: string } | null): string {
  if (!error) return "Unknown error";
  const message = error.message || "Unknown error";
  // Supabase prefixes RPC failures with the SQL error text.
  return message.replace(/^.*?:\s*/, (m) => (m.includes(":") ? m : "")).trim();
}

/**
 * The authoritative live auction state.
 *
 * This is the only place the participant, admin and projector read
 * the auction from. It always reflects the database, never a cache.
 */
export async function fetchLiveAuctionState(): Promise<ServiceResult<LiveAuctionState>> {
  try {
    const { data, error } = await supabase.rpc("get_live_auction_state");

    if (error) {
      return { success: false, error: toMessage(error) };
    }

    const state = (data ?? {}) as Partial<LiveAuctionState>;

    return {
      success: true,
      data: {
        server_time: state.server_time ?? null,
        total_items: state.total_items ?? 0,
        items_sold: state.items_sold ?? 0,
        items_open: state.items_open ?? 0,
        session: state.session ?? null,
        active_slot: state.active_slot ?? null,
        bids: (state.bids ?? []) as AuctionBid[],
        teams: state.teams ?? [],
        settings: state.settings ?? {
          min_bid: 10,
          min_raise: 10,
          opening_window_seconds: 10,
          timer_extension_seconds: 5,
          bonus_time_seconds: 60,
          solving_timer_seconds: 4500,
          starting_wallet_balance: 100,
          bonus_points_rate: { points: 1, per_unspent: 10 },
        },
        events: state.events ?? [],
        eliminations: state.eliminations ?? [],
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load the auction state",
    };
  }
}

/**
 * Place a bid.
 *
 * The team is resolved by the database from the caller's session, so
 * there is deliberately no team parameter here.
 */
export async function placeBid(
  slotId: string,
  amount: number
): Promise<ServiceResult<{ amount: number; min_next_bid: number; end_time: string }>> {
  try {
    const { data, error } = await supabase.rpc("place_bid", {
      p_slot_id: slotId,
      p_amount: Math.floor(amount),
    });

    if (error) {
      return { success: false, error: toMessage(error) };
    }

    return {
      success: true,
      data: data as { amount: number; min_next_bid: number; end_time: string },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to place the bid",
    };
  }
}

/** The participant's own auction state (balance, wins, bid history). */
export async function fetchTeamAuctionState(
  teamId: string
): Promise<ServiceResult<TeamAuctionState>> {
  try {
    const { data, error } = await supabase.rpc("get_team_auction_state", {
      p_team_id: teamId,
    });

    if (error) {
      return { success: false, error: toMessage(error) };
    }

    return { success: true, data: data as TeamAuctionState };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load your auction state",
    };
  }
}

/** The identity of the signed-in participant. */
export async function fetchCurrentIdentity(): Promise<
  ServiceResult<{ userId: string; teamId: string | null; teamName: string | null; isCaptain: boolean }>
> {
  try {
    const { data: authData, error } = await supabase.auth.getUser();

    if (error || !authData?.user) {
      return { success: false, error: "You must be signed in to participate." };
    }

    const userId = authData.user.id;
    const userEmail = (authData.user.email ?? "").toLowerCase();

    // 1. Primary lookup by auth user id
    const { data: memberByAuthId, error: memberError } = await supabase
      .from("members")
      .select("id, team_id, email, college, team:teams(id, name, captain_id)")
      .eq("id", userId)
      .maybeSingle();
    let member = memberByAuthId;

    // 2. Secondary fallback by registered email
    if (!member && userEmail) {
      const { data: memberByEmail } = await supabase
        .from("members")
        .select("id, team_id, email, college, team:teams(id, name, captain_id)")
        .ilike("email", userEmail)
        .maybeSingle();
      if (memberByEmail) {
        member = memberByEmail;
      }
    }

    if (memberError && !member) {
      return { success: false, error: toMessage(memberError) };
    }

    let team = Array.isArray(member?.team) ? member.team[0] : member?.team;

    // 3. Tertiary fallback: team captain_id directly points to auth user id
    if (!team) {
      const { data: teamByCaptain } = await supabase
        .from("teams")
        .select("id, name, captain_id")
        .eq("captain_id", userId)
        .maybeSingle();
      if (teamByCaptain) {
        team = teamByCaptain;
      }
    }

    const isCaptain = Boolean(
      (team && team.captain_id === userId) ||
      (team && member && team.captain_id === member.id) ||
      (member?.college && member.college.toLowerCase().includes("captain")) ||
      authData.user.user_metadata?.role === "captain" ||
      authData.user.app_metadata?.role === "captain"
    );

    return {
      success: true,
      data: {
        userId,
        teamId: member?.team_id ?? team?.id ?? null,
        teamName: team?.name ?? null,
        isCaptain,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to resolve your team",
    };
  }
}
