import React from "react";
import { Metadata } from "next";
import Link from "next/link";
import { B2BLogo } from "@/components/shared/B2BLogo";
import { FigmaRegistrationForm } from "@/features/registration/components/FigmaRegistrationForm";

export const metadata: Metadata = {
  title: "Join the Competition | Bid2Build",
  description: "Register your team and get ready to build something awesome.",
};

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-linear-to-b from-white via-white via-50% to-[#ffdcc7]/75 text-slate-900 flex flex-col justify-between py-6 px-4 sm:px-12 select-none">
      {/* Header */}
      <header className="w-full flex items-center justify-between">
        <B2BLogo />

        <Link
          href="/login"
          className="text-sm font-semibold text-slate-800 hover:text-black transition-colors"
        >
          Log in
        </Link>
      </header>

      {/* Main Registration Content */}
      <main className="w-full my-auto py-8">
        <FigmaRegistrationForm />
      </main>

      {/* Footer */}
      <footer className="w-full text-center py-2 text-[11px] text-slate-400">
        © 2026 Bid2Build • CSEONECORE
      </footer>
    </div>
  );
}
