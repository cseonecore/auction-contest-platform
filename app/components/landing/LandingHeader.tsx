"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "About", href: "#about" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Rules", href: "#rules" },
  { label: "FAQ", href: "#faq" },
];

export const LandingHeader = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile menu on route change
  const closeMenu = () => setIsMenuOpen(false);

  return (
    <>
      <header
        className={`sticky top-0 z-50 transition-all duration-300 ${
          scrolled
            ? "border-b border-white/10 bg-[#0d0d0d]/95 backdrop-blur-md shadow-xl shadow-black/20"
            : "border-b border-white/5 bg-[#0d0d0d]/90 backdrop-blur-sm"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo — B2BLogo owns its own Link; we do NOT wrap it again */}
          <Link href="/" className="flex items-center gap-2 shrink-0 group" aria-label="Bid2Build Home">
            <Image
              src="/new_bid2build_logo.png"
              alt="Bid2Build"
              width={130}
              height={36}
              className="object-contain h-9 w-auto"
              priority
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 lg:gap-8" aria-label="Main navigation">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-[#b3b3b3] hover:text-white transition-colors relative group"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-[#fe5102] transition-all group-hover:w-full" />
              </Link>
            ))}
          </nav>

          {/* Desktop CTA buttons */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
            <Link
              href="/login"
              className="px-4 py-2 text-sm text-white border border-white/20 rounded-full hover:border-white/50 hover:bg-white/5 transition-all"
            >
              Login
            </Link>
            <Link
              href="/register"
              className="px-5 py-2 text-sm font-semibold rounded-full bg-[#fe5102] text-white hover:bg-[#e54700] transition-colors shadow-lg shadow-[#fe5102]/20"
            >
              Register
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            aria-label="Toggle menu"
            aria-controls="mobile-menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-white/5 transition-colors text-white"
          >
            {isMenuOpen ? (
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Mobile menu — rendered outside sticky header to avoid height issues */}
      {isMenuOpen && (
        <div
          id="mobile-menu"
          className="fixed inset-0 z-40 bg-[#0d0d0d]/98 backdrop-blur-md flex flex-col pt-16"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeMenu();
          }}
        >
          {/* Close button row */}
          <div className="flex justify-end px-4 py-3 border-b border-white/5">
            <button
              onClick={closeMenu}
              className="p-2 rounded-lg text-[#b3b3b3] hover:text-white hover:bg-white/5"
              aria-label="Close menu"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav className="flex flex-col px-6 py-6 gap-1" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="text-lg font-medium text-white px-4 py-3 rounded-xl hover:bg-white/5 hover:text-[#fe5102] transition-all"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-3 px-6 pb-10">
            <Link
              href="/register"
              onClick={closeMenu}
              className="flex items-center justify-center px-6 py-4 rounded-full bg-[#fe5102] text-white font-bold text-base hover:bg-[#e54700] transition-colors shadow-lg shadow-[#fe5102]/25"
            >
              Register Your Team
            </Link>
            <Link
              href="/login"
              onClick={closeMenu}
              className="flex items-center justify-center px-6 py-4 rounded-full border border-white/20 text-white font-medium text-base hover:bg-white/5 transition-all"
            >
              Team Login
            </Link>
          </div>
        </div>
      )}
    </>
  );
};
