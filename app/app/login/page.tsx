import React from "react";
import { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/features/auth/components/LoginForm";

export const metadata: Metadata = {
  title: "Login | Bid2Build Auction Contest",
  description: "Sign in to access your Bid2Build team dashboard, live auctions, and project submissions.",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-100 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 text-slate-900 dark:text-zinc-100 py-10 px-4 sm:px-6 lg:px-8 flex flex-col justify-between">
      {/* Top Header */}
      <header className="max-w-md w-full mx-auto flex items-center justify-between mb-8">
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

        <Link
          href="/register"
          className="text-xs font-semibold px-3 py-1.5 rounded-full border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:border-slate-300 dark:hover:border-zinc-600 transition-colors"
        >
          Register Team
        </Link>
      </header>

      {/* Main Login Card */}
      <main className="w-full max-w-md mx-auto my-auto">
        <LoginForm />
      </main>

      {/* Footer */}
      <footer className="max-w-md w-full mx-auto mt-12 text-center text-xs text-slate-400 dark:text-zinc-500 space-y-1 pb-4">
        <p>© 2026 Bid2Build Contest Platform • CSEONECORE</p>
        <p>Protected by Supabase Auth with secure session encryption.</p>
      </footer>
    </div>
  );
}
