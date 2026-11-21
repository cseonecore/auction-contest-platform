'use client';

import { useState } from 'react';
import { useAdminAuth } from '../hooks/useAdminAuth';

interface AdminAuthGuardProps {
  children: React.ReactNode;
}

export function AdminAuthGuard({ children }: AdminAuthGuardProps) {
  const { user, isAdmin, role, isLoading, error: authError, signIn, signOut } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setLoginError(null);

    const { error } = await signIn({ email, password });
    if (error) {
      setLoginError(error.message);
    }
    setIsSubmitting(false);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Verifying Admin authorization...</p>
      </div>
    );
  }

  // Case 1: User is not authenticated
  if (!user) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 mb-3">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            Admin Authentication Required
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Contest settings are protected by PostgreSQL Row Level Security (Migration 004).
          </p>
        </div>

        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg text-xs text-amber-800 dark:text-amber-300">
          <strong>Security Note:</strong> Sign-in is verified on the server and only accounts with
          the <code>admin</code> role are accepted. Authorization is additionally enforced at the
          database level through Row Level Security.
        </div>

        {loginError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
            {loginError}
          </div>
        )}

        {authError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
            {authError}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Admin Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Authenticating...' : 'Sign In as Admin'}
          </button>
        </form>
      </div>
    );
  }

  // Case 2: User is signed in, but NOT an admin
  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900/50 rounded-xl shadow-sm text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 mb-3">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          Access Denied
        </h2>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2">
          Signed in as: <strong className="text-zinc-900 dark:text-zinc-100">{user.email}</strong>
        </p>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
          Current Role: <span className="font-mono text-red-600 font-semibold">{role || 'none'}</span>
        </p>

        <div className="my-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 rounded-lg text-xs text-red-800 dark:text-red-300 text-left">
          <strong>Database Security Restriction:</strong> Migration 004 RLS policy <code>&quot;Admins manage settings&quot;</code> verifies <code>auth.jwt() -&gt; &apos;app_metadata&apos; -&gt;&gt; &apos;role&apos; = &apos;admin&apos;</code>. Your current account does not have the admin claim.
        </div>

        <button
          type="button"
          onClick={() => signOut()}
          className="mt-2 px-4 py-2 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold rounded-lg transition-colors"
        >
          Sign Out &amp; Use Admin Account
        </button>
      </div>
    );
  }

  // Case 3: Verified Admin!
  return <>{children}</>;
}
