import React from "react";
import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { B2BLogo } from "@/components/shared/B2BLogo";
import { FigmaLoginForm } from "@/features/auth/components/FigmaLoginForm";

export const metadata: Metadata = {
  title: "Log in To Your Profile",
  description: "Only the designated Team Captain can log in with the Team Name and Captain USN.",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-linear-to-b from-white via-white via-50% to-[#fbcfb5]/85 text-slate-900 flex flex-col justify-between py-6 px-4 sm:px-12 select-none">
      {/* Top Header */}
      <header className="w-full flex items-center justify-between">
        <B2BLogo variant="dark" height={32} />

        {/* Center: MITE Official College Logo, NAAC A+ Badge & CORE Emblem */}
        <div className="flex items-center gap-2.5 sm:gap-3.5 px-3 sm:px-4 py-1.5 sm:py-2 bg-white/80 backdrop-blur-xs rounded-2xl border border-slate-200/70 shadow-2xs">
          <div className="flex items-center">
            <Image
              src="/logos/mite-logo.png"
              alt="MITE - Mangalore Institute of Technology & Engineering"
              width={200}
              height={76}
              className="h-8 sm:h-10 md:h-11 w-auto object-contain hover:opacity-95 transition-opacity"
              priority
            />
          </div>
          <div className="h-6 sm:h-7 w-px bg-slate-200/90" />
          <div className="flex items-center">
            <Image
              src="/logos/naac-logo.png"
              alt="NAAC A+ CGPA: 3.44"
              width={120}
              height={48}
              className="h-6 sm:h-7 md:h-8 w-auto object-contain"
              priority
            />
          </div>
          <div className="h-6 sm:h-7 w-px bg-slate-200/90" />
          <div className="flex items-center">
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full relative overflow-hidden shadow-xs border border-amber-500/20 shrink-0">
              <Image
                src="/logos/core-logo.png"
                alt="CORE Logo"
                fill
                sizes="36px"
                className="object-contain"
                priority
              />
            </div>
          </div>
        </div>

        {/* Right: Register Team CTA */}
        <Link
          href="/register"
          className="bg-[#fe5102] hover:bg-[#e54700] active:scale-95 text-white font-semibold text-xs sm:text-sm px-5 py-2 sm:py-2.5 rounded-full shadow-xs transition-all cursor-pointer"
        >
          Register Team
        </Link>
      </header>

      {/* Main Login View with Dual Logo (Bid2Build [ ] x CORE 3D Emblem) */}
      <main className="w-full my-auto py-8">
        <FigmaLoginForm />
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
