"use client";

import Link from "next/link";

export const FinalCTA = () => {
  return (
    <section className="py-20 md:py-28 relative overflow-hidden bg-[#0d0d0d]">
      {/* Background elements */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#fe5102] rounded-full opacity-[0.07] blur-[100px]" />
      </div>

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="h-px w-8 bg-[#fe5102]" />
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[#fe5102]">
            JOIN THE COMPETITION
          </span>
          <div className="h-px w-8 bg-[#fe5102]" />
        </div>

        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white mb-5 leading-tight">
          Ready to Bid.{" "}
          <span className="text-[#fe5102]">Ready to Build?</span>
        </h2>

        <p className="text-base sm:text-lg text-[#6b6b6d] max-w-xl mx-auto mb-10 leading-relaxed">
          Bring your team, sharpen your strategy, and turn your ideas into working
          applications. Register now and compete for real-world problem statements.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-[#fe5102] text-white font-bold text-sm tracking-wide hover:bg-[#e54700] transition-all shadow-lg shadow-[#fe5102]/30 hover:-translate-y-0.5"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Register Your Team
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full border border-white/20 text-white font-medium text-sm hover:border-white/50 hover:bg-white/5 transition-all"
          >
            Team Login
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
};
