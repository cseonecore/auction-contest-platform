import React from "react";
import { Metadata } from "next";
import { RegistrationForm } from "@/features/registration/components/RegistrationForm";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Team Registration | Bid2Build Auction Contest",
  description:
    "Register your team for the Bid2Build College App Development Auction Contest.",
};

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-100 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 text-slate-900 dark:text-zinc-100 py-10 px-4 sm:px-6 lg:px-8">
      {/* Top Navigation / Brand header */}
      <header className="max-w-3xl mx-auto mb-8 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-bold text-lg text-slate-900 dark:text-white tracking-tight"
        >
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-extrabold text-sm shadow-xs shadow-indigo-500/30">
            B2B
          </div>
          <span>
            Bid<span className="text-indigo-600 dark:text-indigo-400">2</span>Build
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-xs font-semibold px-3 py-1.5 rounded-full border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:border-slate-300 dark:hover:border-zinc-600 transition-colors"
          >
            Sign In
          </Link>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-200/60 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hidden sm:inline-block">
            Tech Fest 2026
          </span>
        </div>
      </header>

      {/* Main Registration Container */}
      <main className="max-w-3xl mx-auto">
        <RegistrationForm />
      </main>

      {/* Footer */}
      <footer className="max-w-3xl mx-auto mt-12 text-center text-xs text-slate-400 dark:text-zinc-500 space-y-1 pb-8">
        <p>© 2026 Bid2Build Contest Platform • CSEONECORE. All rights reserved.</p>
        <p>
          Already registered?{" "}
          <Link
            href="/login"
            className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Sign In here
          </Link>
        </p>
      </footer>
    </div>
  );
}
