'use client';

import { AdminHeader } from '@/features/admin/components/AdminHeader';
import { AdminAuthGuard } from '@/features/admin/components/AdminAuthGuard';
import { SettingsForm } from '@/features/admin/components/SettingsForm';
import { useAdminAuth } from '@/features/admin/hooks/useAdminAuth';

export default function AdminSettingsPage() {
  const { user, role, signOut } = useAdminAuth();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight">
            Admin Settings Management
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Configure live bidding parameters, timers, wallet budgets, and scoring rules.
          </p>
        </div>

        <AdminAuthGuard>
          <SettingsForm />
        </AdminAuthGuard>
      </main>
    </div>
  );
}
