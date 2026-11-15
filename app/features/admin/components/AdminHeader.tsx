'use client';

import Link from 'next/link';

interface AdminHeaderProps {
  userEmail?: string | null;
  role?: string | null;
  onSignOut?: () => void;
  currentPage?: string;
}

export function AdminHeader({ userEmail, role, onSignOut, currentPage = 'Settings' }: AdminHeaderProps) {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/admin" className="font-bold text-lg text-zinc-900 dark:text-zinc-50 tracking-tight hover:opacity-85 transition-opacity">
              Bid2Build
            </Link>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 font-semibold">
              Admin Portal
            </span>
          </div>
          <nav className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            <Link href="/admin" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
              Admin
            </Link>
            <span>/</span>
            <span className="text-zinc-900 dark:text-zinc-100 font-medium">{currentPage}</span>
          </nav>
        </div>

        {userEmail && (
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <div className="font-medium text-zinc-800 dark:text-zinc-200">{userEmail}</div>
              <div className="text-zinc-500">
                Role: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{role || 'none'}</span>
              </div>
            </div>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Sign Out
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
