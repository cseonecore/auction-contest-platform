'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminHeader } from '@/features/admin/components/AdminHeader';
import { AdminAuthGuard } from '@/features/admin/components/AdminAuthGuard';
import { useAdminAuth } from '@/features/admin/hooks/useAdminAuth';
import {
  RegisteredTeamWithRelations,
  RegistrationLockFilter,
} from '@/features/admin/types/registration';
import {
  fetchRegisteredTeams,
  calculateRegistrationStats,
} from '@/features/admin/services/registrationService';
import { RegistrationStats } from '@/features/admin/components/registration/RegistrationStats';
import { TeamsTable } from '@/features/admin/components/registration/TeamsTable';
import { TeamDetailsModal } from '@/features/admin/components/registration/TeamDetailsModal';

function AdminRegistrationContent() {
  const [teams, setTeams] = useState<RegisteredTeamWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [lockFilter, setLockFilter] = useState<RegistrationLockFilter>('all');
  const [selectedTeam, setSelectedTeam] = useState<RegisteredTeamWithRelations | null>(null);

  const loadTeams = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const result = await fetchRegisteredTeams();
    if (!result.success) {
      setError(result.error || 'Failed to fetch registered teams.');
      setIsLoading(false);
      return;
    }

    setTeams(result.data || []);
    setIsLoading(false);
  }, []);

  // Effect to load teams on mount without synchronous setState
  useEffect(() => {
    let isMounted = true;

    async function init() {
      const result = await fetchRegisteredTeams();
      if (!isMounted) return;

      if (!result.success) {
        setError(result.error || 'Failed to fetch registered teams.');
        setIsLoading(false);
        return;
      }

      setTeams(result.data || []);
      setIsLoading(false);
    }

    void init();

    return () => {
      isMounted = false;
    };
  }, []);

  // Compute stats dynamically from the actual teams array
  const stats = useMemo(() => calculateRegistrationStats(teams), [teams]);

  return (
    <div className="space-y-6">
      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl text-xs text-red-800 dark:text-red-300 flex items-start justify-between">
          <div>
            <strong className="font-bold">Error Loading Teams: </strong>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadTeams}
            className="text-xs underline hover:text-red-900 ml-4 shrink-0 font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Stats Bar */}
      <RegistrationStats stats={stats} />

      {/* Teams Table with Search and Filtering */}
      <TeamsTable
        teams={teams}
        onSelectTeam={(team) => setSelectedTeam(team)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        lockFilter={lockFilter}
        onLockFilterChange={setLockFilter}
        onRefresh={loadTeams}
        isLoading={isLoading}
      />

      {/* Team Details Modal */}
      <TeamDetailsModal
        isOpen={selectedTeam !== null}
        onClose={() => setSelectedTeam(null)}
        team={selectedTeam}
      />
    </div>
  );
}

export default function AdminRegistrationPage() {
  const { user, role, signOut } = useAdminAuth();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
        currentPage="Registration"
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight">
                Registration Management
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                Monitor registered teams, inspect student rosters, and supervise contest capacity.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                Phase 1: Read-Only
              </span>
            </div>
          </div>
        </div>

        <AdminAuthGuard>
          <AdminRegistrationContent />
        </AdminAuthGuard>
      </main>
    </div>
  );
}
