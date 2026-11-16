import React from "react";
import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { B2BLogo } from "@/components/shared/B2BLogo";
import { FigmaRegistrationForm } from "@/features/registration/components/FigmaRegistrationForm";

export const metadata: Metadata = {
  title: "Join the Competition | Bid2Build",
  description: "Register your team and get ready to build something awesome.",
};

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-linear-to-b from-white via-white via-50% to-[#ffdcc7]/75 text-slate-900 flex flex-col justify-between py-5 px-4 sm:px-10 md:px-14 select-none">
      {/* Top Header with MITE College Logo & NAAC A+ Accreditation */}
      <header className="w-full flex items-center justify-between pb-3 border-b border-slate-100/90 gap-4">
        {/* Left: Brand Logo */}
        <B2BLogo />

        {/* Center: MITE Official College Logo & NAAC A+ Badge */}
        <div className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-1.5 sm:py-2 bg-white/80 backdrop-blur-xs rounded-2xl border border-slate-200/70 shadow-2xs">
          <div className="flex items-center">
            <Image
              src="/logos/mite-logo.png"
              alt="MITE - Mangalore Institute of Technology & Engineering"
              width={200}
              height={76}
              className="h-8 sm:h-11 md:h-12 w-auto object-contain hover:opacity-95 transition-opacity"
              priority
            />
          </div>
          <div className="h-6 sm:h-8 w-px bg-slate-200/90" />
          <div className="flex items-center">
            <Image
              src="/logos/naac-logo.png"
              alt="NAAC A+ CGPA: 3.44"
              width={120}
              height={48}
              className="h-6 sm:h-8 md:h-9 w-auto object-contain"
              priority
            />
          </div>
        </div>

        {/* Right: Log in CTA */}
        <Link
          href="/login"
          className="bg-slate-900 hover:bg-black active:scale-95 text-white font-semibold text-xs sm:text-sm px-5 py-2 sm:py-2.5 rounded-full shadow-xs transition-all cursor-pointer whitespace-nowrap shrink-0"
        >
          Log in
        </Link>
      </header>

      {/* Main Registration Content */}
      <main className="w-full my-auto py-8">
        <FigmaRegistrationForm />
      </main>

      {/* Institutional Footer */}
      <footer className="w-full flex flex-col sm:flex-row items-center justify-between py-4 text-[11px] text-slate-400 gap-2 border-t border-slate-100">
        <div className="flex items-center gap-2">
          <span>Organized by</span>
          <span className="font-bold text-slate-700">CORE • Department of Computer Science & Engineering</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Image
            src="/logos/naac-logo.png"
            alt="NAAC A+"
            width={60}
            height={22}
            className="h-4.5 w-auto object-contain sm:hidden"
          />
          <span>Mangalore Institute of Technology & Engineering (Autonomous)</span>
        </div>
        <div>© 2026 Bid2Build</div>
      </footer>
    </div>
  );
}
