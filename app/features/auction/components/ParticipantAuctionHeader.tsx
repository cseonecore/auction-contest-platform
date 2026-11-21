"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContestRulesModal } from "./ContestRulesModal";
import { B2BLogo } from "@/components/shared/B2BLogo";
import { supabase } from "@/lib/supabase";

interface ParticipantAuctionHeaderProps {
  connectionStatus?: "connected" | "reconnecting" | "offline";
}

export function ParticipantAuctionHeader({
  connectionStatus = "connected",
}: ParticipantAuctionHeaderProps) {
  const router = useRouter();
  const [isRulesOpen, setIsRulesOpen] = useState(false);

  const handleLogout = () => {
    // Best-effort server sign-out: invalidates the single-device
    // session and clears the httpOnly team cookie.
    void (async () => {
      try {
        await fetch("/api/logout", { method: "POST" });
      } catch {
        /* best effort */
      }
      try {
        await supabase.auth.signOut();
      } catch {
        /* best effort */
      }
    })();

    if (typeof window !== "undefined") {
      localStorage.removeItem("b2b_logged_in_team");
    }
    router.push("/login");
  };

  return (
    <>
      <header className="w-full bg-[#121316] border-b border-zinc-800/80 px-4 sm:px-8 py-3.5 select-none">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Left: Bid2Build Logo */}
          <B2BLogo variant="dark" height={30} />

          {/* Right Navigation matching screenshots */}
          <div className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm font-medium text-zinc-300">
            {/* Realtime Status Indicator */}
            <div className="hidden md:flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 mr-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionStatus === "connected"
                    ? "bg-emerald-500 animate-pulse"
                    : connectionStatus === "reconnecting"
                    ? "bg-amber-500 animate-spin"
                    : "bg-red-500"
                }`}
              />
              <span className="capitalize">
                {connectionStatus === "connected"
                  ? "Realtime Synced"
                  : connectionStatus}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsRulesOpen(true)}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Contest Rules
            </button>

            <Link
              href="/profile"
              className="hover:text-white transition-colors cursor-pointer"
            >
              Profile
            </Link>

            <button
              type="button"
              onClick={handleLogout}
              className="hover:text-red-400 transition-colors cursor-pointer"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {/* Rules Modal */}
      <ContestRulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
      />
    </>
  );
}
