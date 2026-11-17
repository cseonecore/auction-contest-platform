"use client";

import Image from "next/image";
import Link from "next/link";

export const Footer = () => {
  const navLinks = [
    { label: "Home", href: "/" },
    { label: "About", href: "#about" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "Rules", href: "#rules" },
    { label: "FAQ", href: "#faq" },
    { label: "Register", href: "/register" },
    { label: "Login", href: "/login" },
  ];

  const contacts = [
    {
      name: "Anush",
      phone: "+91 81520 76287",
      email: "4MT24CS032@mite.ac.in",
    },
    {
      name: "Ananya Shetty",
      phone: "+91 72040 33497",
      email: "4MT24CS025@mite.ac.in",
    },
  ];

  return (
    <footer className="bg-[#0a0a0a] border-t border-white/[0.07]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Main footer grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 py-14">
          {/* Left — Branding */}
          <div className="space-y-6">
            {/* Bid2Build logo — original colors preserved */}
            <div>
              <Image
                src="/new_bid2build_logo.png"
                alt="Bid2Build"
                width={160}
                height={48}
                className="object-contain w-auto"
                style={{ maxHeight: 48 }}
              />
            </div>

            {/* Institution logos row */}
            <div className="flex items-center gap-4 flex-wrap">
              {/* MITE logo */}
              <div className="bg-white rounded-lg p-1.5">
                <Image
                  src="/logos/mite-logo.png"
                  alt="MITE"
                  width={56}
                  height={40}
                  className="object-contain w-auto"
                  style={{ maxHeight: 40 }}
                />
              </div>
              {/* Dev Studio logo */}
              <div>
                <Image
                  src="/logos/dev-studio-logo.png"
                  alt="Dev Studio"
                  width={80}
                  height={36}
                  className="object-contain w-auto"
                  style={{ maxHeight: 36 }}
                />
              </div>
            </div>

            {/* Dept text */}
            <div className="space-y-1">
              <p className="text-xs text-[#6b6b6d] leading-relaxed">
                Department of Computer Science and Engineering
              </p>
              <p className="text-xs text-[#6b6b6d] leading-relaxed">
                Mangalore Institute of Technology and Engineering (MITE)
              </p>
              <p className="text-xs text-[#4a4a4a] mt-2">
                Organized by MITE 5CSE1 in collaboration with Dev Studio.
              </p>
            </div>
          </div>

          {/* Middle — Quick Links */}
          <div>
            <h4 className="text-xs font-bold tracking-[0.15em] uppercase text-white mb-5">
              Quick Links
            </h4>
            <ul className="space-y-3">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-[#6b6b6d] hover:text-[#fe5102] transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Right — Contact */}
          <div>
            <h4 className="text-xs font-bold tracking-[0.15em] uppercase text-white mb-5">
              Contact
            </h4>
            <div className="space-y-5">
              {contacts.map((c) => (
                <div key={c.name} className="space-y-1">
                  <p className="text-sm font-semibold text-[#fe5102]">{c.name}</p>
                  <p className="text-sm text-[#6b6b6d]">{c.phone}</p>
                  <a
                    href={`mailto:${c.email}`}
                    className="text-sm text-[#6b6b6d] hover:text-[#fe5102] transition-colors block"
                  >
                    {c.email}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/[0.07] py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#4a4a4a]">
          <div className="flex items-center gap-2">
            <Image
              src="/bid2build_icon-01.png"
              alt=""
              width={16}
              height={16}
              className="object-contain opacity-40"
              aria-hidden="true"
            />
            <span>© 2026 Bid2Build. All rights reserved.</span>
          </div>
          <span className="text-center">
            CORE · Department of Computer Science and Engineering, MITE
          </span>
          <span>Developed by Anush and Team</span>
        </div>
      </div>
    </footer>
  );
};
