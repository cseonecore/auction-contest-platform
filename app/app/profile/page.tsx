"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { B2BLogo } from "@/components/shared/B2BLogo";
import { FigmaHeaderLogos } from "@/components/shared/FigmaHeaderLogos";
import Image from "next/image";
import { LogOut, ArrowRight, Coins, Users } from "lucide-react";

interface LoggedTeam {
  id: string;
  name: string;
  locked?: boolean;
  members?: Array<{ name: string; email: string }>;
}

export default function ProfilePage() {
  const router = useRouter();
  const [team, setTeam] = useState<LoggedTeam | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("b2b_logged_in_team");
      if (stored) {
        try {
          setTeam(JSON.parse(stored));
        } catch {
          // ignore error
        }
      }
    }
  }, []);

  const handleSignOut = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("b2b_logged_in_team");
    }
    setTeam(null);
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-white via-white via-50% to-[#ffdcc7]/75 text-slate-900 flex flex-col justify-between py-6 px-4 sm:px-12 select-none">
      {/* Header */}
      <header className="w-full flex items-center justify-between">
        <B2BLogo />

        {team ? (
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full border border-slate-300 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        ) : (
          <Link
            href="/login"
            className="text-sm font-semibold text-slate-800 hover:text-black transition-colors"
          >
            Log in
          </Link>
        )}
      </header>

      {/* Main Content */}
      <main className="w-full max-w-xl mx-auto my-auto py-8 text-center">
        <FigmaHeaderLogos />

        {team ? (
          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-6 sm:p-8 space-y-6 text-left">
            <div className="flex items-center gap-4 border-b border-slate-100 pb-5">
              <div className="w-16 h-16 relative shrink-0">
                <Image
                  src="/characters/Character-01.png"
                  alt="Team Mascot"
                  fill
                  className="object-contain"
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                    {team.name}
                  </h2>
                  <span className="w-4 h-4 rounded-full bg-sky-500 text-white flex items-center justify-center text-[10px] font-bold">
                    ✓
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  ID: {team.id}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200/60 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-400 text-amber-950 flex items-center justify-center font-bold">
                  <Coins className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-amber-800 block">
                    Wallet Balance
                  </span>
                  <span className="text-base font-extrabold text-amber-950">
                    100 Coins
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200/60 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-400 text-blue-950 flex items-center justify-center font-bold">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-blue-800 block">
                    Contest Status
                  </span>
                  <span className="text-base font-extrabold text-blue-950">
                    Active
                  </span>
                </div>
              </div>
            </div>

            {/* Quick action to live auction */}
            <div className="pt-2">
              <Link
                href="/auction"
                className="w-full bg-[#ff5500] hover:bg-[#e64d00] text-white font-semibold text-sm py-3 px-6 rounded-full flex items-center justify-center gap-2 shadow-md shadow-orange-500/25 transition-all"
              >
                <span>Go to Live Auction</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-8 max-w-md mx-auto space-y-4">
            <h2 className="text-xl font-bold text-slate-900">
              No Team Logged In
            </h2>
            <p className="text-xs text-slate-500">
              Please enter your Team ID and Password to view your profile and participate in auctions.
            </p>
            <div className="flex gap-3 justify-center pt-2">
              <Link
                href="/login"
                className="bg-[#ff5500] hover:bg-[#e64d00] text-white font-semibold text-xs px-6 py-2.5 rounded-full shadow-sm transition-all"
              >
                Log In
              </Link>
              <Link
                href="/register"
                className="border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs px-6 py-2.5 rounded-full transition-all"
              >
                Register Team
              </Link>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full text-center py-2 text-[11px] text-slate-400">
        © 2026 Bid2Build • CSEONECORE
      </footer>
    </div>
  );
}
