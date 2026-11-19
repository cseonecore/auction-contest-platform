'use client';

/**
 * AdminSubnav Component
 * Bid2Build (Auction Contest Platform)
 *
 * Consolidated navigation bar for Admin sections:
 *  1. Dashboard (/admin)
 *  2. Registration (/admin/registration)
 *  3. Auctioning (/admin/auction)
 *  4. Bidding Results (/admin/results)
 *  5. Submissions & Eval (/admin/submissions)
 *  6. Settings (/admin/settings)
 */

import React from 'react';
import Link from 'next/link';
import type { AdminNavSection } from '../types/auctionAdmin';

interface AdminSubnavProps {
  currentSection: AdminNavSection;
  activeAuctionCount?: number;
}

interface NavItem {
  id: AdminNavSection;
  aliases?: AdminNavSection[];
  label: string;
  href: string;
  icon: (active: boolean) => React.ReactNode;
  badge?: string | number;
}

export function AdminSubnav({ currentSection, activeAuctionCount }: AdminSubnavProps) {
  const items: NavItem[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      href: '/admin',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-[#fe5102]' : 'text-zinc-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
      ),
    },
    {
      id: 'registration',
      label: 'Registration',
      href: '/admin/registration',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-[#fe5102]' : 'text-zinc-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      ),
    },
    {
      id: 'auction',
      aliases: ['overview', 'queue', 'controller', 'feed'],
      label: 'Auctioning',
      href: '/admin/auction',
      badge: activeAuctionCount && activeAuctionCount > 0 ? 'LIVE' : undefined,
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-[#fe5102]' : 'text-zinc-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      ),
    },
    {
      id: 'results',
      aliases: ['allocations'],
      label: 'Bidding Results',
      href: '/admin/results',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-[#fe5102]' : 'text-zinc-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      ),
    },
    {
      id: 'submissions',
      label: 'Submissions & Eval',
      href: '/admin/submissions',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-[#fe5102]' : 'text-zinc-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      href: '/admin/settings',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-[#fe5102]' : 'text-zinc-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
    },
  ];

  return (
    <nav
      aria-label="Admin Navigation"
      className="bg-[#141518] border border-white/10 rounded-xl p-1.5 shadow-2xs mb-6 overflow-x-auto select-none"
    >
      <div className="flex items-center gap-1.5 min-w-max">
        {items.map((item) => {
          const isActive =
            currentSection === item.id ||
            Boolean(item.aliases && item.aliases.includes(currentSection));
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-[#fe5102] text-white shadow-md shadow-orange-500/20'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {item.icon(isActive)}
              <span>{item.label}</span>

              {item.badge && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-400 text-amber-950 uppercase tracking-wider animate-pulse">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
