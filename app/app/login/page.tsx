import React from "react";
import { Metadata } from "next";
import Link from "next/link";
import { B2BLogo } from "@/components/shared/B2BLogo";
import { FigmaLoginForm } from "@/features/auth/components/FigmaLoginForm";

export const metadata: Metadata = {
  title: "Log in To Your Profile | Bid2Build",
  description: "Enter your Team ID and Password and view your profile.",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-linear-to-b from-white via-white via-50% to-[#ffdcc7]/75 text-slate-900 flex flex-col justify-between py-6 px-4 sm:px-12 select-none">
      {/* Top Header */}
      <header className="w-full flex items-center justify-between">
        <B2BLogo />

        <Link
          href="/register"
          className="bg-[#ff5500] hover:bg-[#e64d00] active:scale-95 text-white font-semibold text-xs sm:text-sm px-5 py-2 sm:py-2.5 rounded-full shadow-sm shadow-orange-500/20 transition-all cursor-pointer"
        >
          Register Team
        </Link>
      </header>

      {/* Main Login View */}
      <main className="w-full my-auto py-8">
        <FigmaLoginForm />
      </main>

      {/* Subtle bottom footer space */}
      <footer className="w-full text-center py-2 text-[11px] text-slate-400">
        © 2026 Bid2Build • CSEONECORE
      </footer>
    </div>
  );
}
