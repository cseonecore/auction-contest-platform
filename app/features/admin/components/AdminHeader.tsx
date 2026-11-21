"use client";

import Link from "next/link";
import { B2BLogo } from "@/components/shared/B2BLogo";

interface AdminHeaderProps {
  userEmail?: string | null;
  role?: string | null;
  onSignOut?: () => void;
  currentPage?: string;
}

export function AdminHeader({ userEmail, role, onSignOut, currentPage = "Settings" }: AdminHeaderProps) {
  return (
    <header className="border-b border-white/10 bg-[#141518] px-6 py-4 select-none">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <B2BLogo variant="dark" height={26} href="/admin" />
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#fe5102]/20 text-[#fe5102] border border-[#fe5102]/30">
              Admin Portal
            </span>
          </div>
          <nav className="flex items-center gap-1.5 text-xs text-slate-400 mt-2 font-medium">
            <Link href="/admin" className="hover:text-white transition-colors">
              Admin
            </Link>
            <span>/</span>
            <span className="text-white font-semibold">{currentPage}</span>
          </nav>
        </div>

        {userEmail && (
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <div className="font-medium text-slate-200">{userEmail}</div>
              <div className="text-slate-400">
                Role: <span className="font-semibold text-emerald-400">{role || "none"}</span>
              </div>
            </div>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="px-3 py-1.5 text-xs font-semibold rounded-full border border-white/10 text-slate-300 hover:text-white hover:border-white/20 hover:bg-white/5 transition-all cursor-pointer"
              >
                Sign Out
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
