"use client";

import Image from "next/image";
import Link from "next/link";

export const HeroSection = () => {
  return (
    <section className="relative hero-section flex min-h-[92vh] flex-col justify-center overflow-hidden bg-[#0d0d0d]">
      {/* Background visual elements */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {/* Large orange glow — top left */}
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] bg-[#fe5102] rounded-full opacity-[0.07] blur-[120px]" />
        {/* Smaller peach glow — bottom right */}
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-[#fbcfb5] rounded-full opacity-[0.05] blur-[100px]" />

        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Decorative auction-inspired elements */}
        <div className="absolute top-20 right-10 md:right-20 opacity-10">
          <svg width="300" height="300" viewBox="0 0 300 300" fill="none" aria-hidden="true">
            <circle cx="150" cy="150" r="140" stroke="#fe5102" strokeWidth="1" strokeDasharray="8 6" />
            <circle cx="150" cy="150" r="100" stroke="#fe5102" strokeWidth="0.5" strokeDasharray="4 8" />
            <circle cx="150" cy="150" r="60" stroke="#fe5102" strokeWidth="1" />
            <text x="150" y="155" textAnchor="middle" fill="#fe5102" fontSize="11" fontFamily="monospace">BID • BUILD • WIN</text>
          </svg>
        </div>

        <div className="absolute bottom-20 left-10 md:left-20 opacity-[0.07]">
          <svg width="200" height="200" viewBox="0 0 200 200" fill="none" aria-hidden="true">
            <rect x="10" y="10" width="180" height="180" rx="4" stroke="#fe5102" strokeWidth="1" />
            <rect x="30" y="80" width="20" height="90" fill="#fe5102" />
            <rect x="60" y="50" width="20" height="120" fill="#fe5102" />
            <rect x="90" y="100" width="20" height="70" fill="#fe5102" />
            <rect x="120" y="30" width="20" height="140" fill="#fe5102" />
            <rect x="150" y="70" width="20" height="100" fill="#fe5102" />
          </svg>
        </div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
        {/* Presenter label */}
        <div className="inline-flex items-center gap-2 mb-8">
          <div className="h-px w-8 bg-[#fe5102]" />
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[#fe5102]">
            MITE 5CSE1 × DEV STUDIO PRESENTS
          </span>
          <div className="h-px w-8 bg-[#fe5102]" />
        </div>

        {/* Official Bid2Build logo — the actual asset, not text */}
        <div className="flex justify-center mb-8">
          <Image
            src="/new_bid2build_logo.png"
            alt="Bid2Build"
            width={480}
            height={160}
            className="object-contain w-auto"
            style={{ maxHeight: "160px", maxWidth: "min(480px, 85vw)" }}
            priority
          />
        </div>

        {/* Tagline */}
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white mb-5 leading-tight">
          Bid Smart.{" "}
          <span className="text-[#fe5102]">Build Fast.</span>{" "}
          Prove Your Skills.
        </h1>

        {/* Description */}
        <p className="text-base sm:text-lg text-[#9a9a9a] max-w-2xl mx-auto mb-10 leading-relaxed">
          A web development auction contest where teams compete for problem statements,
          build working applications, and showcase their technical creativity.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-14">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-[#fe5102] text-white font-bold text-sm tracking-wide hover:bg-[#e54700] transition-all shadow-lg shadow-[#fe5102]/30 hover:shadow-[#fe5102]/50 hover:-translate-y-0.5"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Register Your Team
          </Link>
          <Link
            href="#how-it-works"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full border border-white/20 text-white font-medium text-sm hover:border-white/50 hover:bg-white/5 transition-all"
          >
            Explore the Competition
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </Link>
        </div>

        {/* Event details bar */}
        <div className="inline-flex flex-col sm:flex-row gap-5 sm:gap-8 items-center justify-center px-6 py-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm text-[#9a9a9a]">
            <svg className="w-4 h-4 text-[#fe5102] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="font-medium text-white">27 November 2026</span>
          </div>
          <div className="hidden sm:block h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 text-sm text-[#9a9a9a]">
            <svg className="w-4 h-4 text-[#fe5102] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>MITE, Mangalore</span>
          </div>
          <div className="hidden sm:block h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 text-sm text-[#9a9a9a]">
            <svg className="w-4 h-4 text-[#fe5102] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Teams of 2–3</span>
          </div>
          <div className="hidden sm:block h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 text-sm text-[#9a9a9a]">
            <svg className="w-4 h-4 text-[#fe5102] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Max 20 Teams</span>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-40 animate-bounce">
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </section>
  );
};
