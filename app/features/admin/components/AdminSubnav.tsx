'use client';

/**
 * AdminSubnav Component
 * Bid2Build (Auction Contest Platform)
 *
 * Universal navigation bar for Admin sections:
 *  1. Admin Dashboard (/admin)
 *  2. Team Registration (/admin/registration)
 *  3. Auction Overview (/admin/auction?tab=overview)
 *  4. Slot Queue (/admin/auction?tab=queue)
 *  5. Active Controller (/admin/auction?tab=controller)
 *  6. Live Bid Feed (/admin/auction?tab=feed)
 *  7. Team Allocations (/admin/auction?tab=allocations)
 *  8. Contest Settings (/admin/settings)
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
  label: string;
  href: string;
  group: 'main' | 'auction' | 'config';
  icon: (active: boolean) => React.ReactNode;
  badge?: string | number;
}

export function AdminSubnav({ currentSection, activeAuctionCount }: AdminSubnavProps) {
  const items: NavItem[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      href: '/admin',
      group: 'main',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`}
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
      group: 'main',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`}
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
      id: 'submissions',
      label: 'Submissions & Eval',
      href: '/admin/submissions',
      group: 'main',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`}
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
      id: 'overview',
      label: 'Auction Overview',
      href: '/admin/auction?tab=overview',
      group: 'auction',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`}
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
      id: 'queue',
      label: 'Slot Queue',
      href: '/admin/auction?tab=queue',
      group: 'auction',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 10h16M4 14h16M4 18h16"
          />
        </svg>
      ),
    },
    {
      id: 'controller',
      label: 'Active Controller',
      href: '/admin/auction?tab=controller',
      group: 'auction',
      badge: activeAuctionCount && activeAuctionCount > 0 ? 'LIVE' : undefined,
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400'}`}
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
      id: 'feed',
      label: 'Live Bid Feed',
      href: '/admin/auction?tab=feed',
      group: 'auction',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    {
      id: 'allocations',
      label: 'Team Allocations',
      href: '/admin/auction?tab=allocations',
      group: 'auction',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      href: '/admin/settings',
      group: 'config',
      icon: (active) => (
        <svg
          className={`w-4 h-4 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`}
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
      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-1.5 shadow-2xs mb-6 overflow-x-auto"
    >
      <div className="flex items-center gap-1 min-w-max">
        {items.map((item) => {
          const isActive = currentSection === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-2xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
              }`}
            >
              {item.icon(isActive)}
              <span>{item.label}</span>

              {item.badge && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white uppercase tracking-wider animate-pulse">
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
