'use client';

/**
 * UnifiedBiddingResultsTable Component
 * Bid2Build (Auction Contest Platform)
 *
 * Consolidated per-team auction and financial results table:
 *  - Team Name
 *  - Captain Name & Captain USN
 *  - Members & Number of Members
 *  - Registration Date
 *  - Valid Balance
 *  - All Acquired Problems (with difficulty & round)
 *  - Winning Amount per Problem
 *  - Total Amount Spent
 *  - Base Development Time
 *  - Add-on Time Earned
 *  - Total Development Time
 *
 * Fully supports multiple wins per team (including in the same round).
 * Reads authoritative persisted data from get_bidding_results().
 */

import React, { useState, useMemo } from 'react';
import { Search, RefreshCw, Download, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { BiddingResultTeam, BiddingResultProblem } from '../../types/auctionAdmin';

interface UnifiedBiddingResultsTableProps {
  teams: BiddingResultTeam[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  /** Global default add-on (seconds) applied to teams without an override. */
  defaultAddonSeconds?: number;
  /** Persist one team's add-on in minutes; null clears the override. */
  onSaveTeamAddon?: (
    teamId: string,
    minutes: number | null
  ) => Promise<{ success: boolean; error?: string }>;
}

function formatDevTime(seconds: number): string {
  if (seconds == null || isNaN(seconds) || seconds <= 0) return '0 min';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins} min`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function UnifiedBiddingResultsTable({
  teams,
  isLoading,
  onRefresh,
  defaultAddonSeconds = 0,
  onSaveTeamAddon,
}: UnifiedBiddingResultsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterWon, setFilterWon] = useState<'all' | 'won' | 'nowins'>('all');
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [addonDrafts, setAddonDrafts] = useState<Record<string, string>>({});
  const [savingAddonTeam, setSavingAddonTeam] = useState<string | null>(null);
  const [addonError, setAddonError] = useState<string | null>(null);

  // Safely extract teams array even if an object was passed
  const safeTeams = useMemo<BiddingResultTeam[]>(() => {
    if (Array.isArray(teams)) return teams;
    if (teams && Array.isArray((teams as unknown as { teams?: BiddingResultTeam[] }).teams)) {
      return (teams as unknown as { teams: BiddingResultTeam[] }).teams;
    }
    return [];
  }, [teams]);

  // Filtered teams list
  const filteredTeams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return safeTeams.filter((t) => {
      // Won filter
      if (filterWon === 'won' && t.won_count === 0) return false;
      if (filterWon === 'nowins' && t.won_count > 0) return false;

      // Search filter
      if (q) {
        const matchName = t.team_name.toLowerCase().includes(q);
        const matchCaptain = t.captain_name?.toLowerCase().includes(q) ?? false;
        const matchUsn = t.captain_usn?.toLowerCase().includes(q) ?? false;
        const matchProblem = t.problems?.some((p) => p.topic_title.toLowerCase().includes(q)) ?? false;
        const matchMember = t.members?.some((m) => m.name.toLowerCase().includes(q) || m.usn.toLowerCase().includes(q)) ?? false;
        if (!matchName && !matchCaptain && !matchUsn && !matchProblem && !matchMember) {
          return false;
        }
      }

      return true;
    });
  }, [safeTeams, searchQuery, filterWon]);

  // Overall contest stats summary
  const summary = useMemo(() => {
    let totalWins = 0;
    let totalCoinsSpent = 0;
    let teamsWithWins = 0;

    for (const t of safeTeams) {
      totalWins += t.won_count;
      totalCoinsSpent += t.total_spent;
      if (t.won_count > 0) teamsWithWins += 1;
    }

    return {
      totalTeams: safeTeams.length,
      teamsWithWins,
      totalWins,
      totalCoinsSpent,
    };
  }, [safeTeams]);

  // Export CSV handler
  const handleExportCSV = () => {
    if (safeTeams.length === 0) return;

    const headers = [
      'Team Name',
      'Captain Name',
      'Captain USN',
      'Member Count',
      'Members',
      'Registration Date',
      'Valid Balance',
      'Total Amount Spent',
      'Problems Acquired Count',
      'Acquired Problems Details',
      'Total Base Dev Seconds',
      'Total Admin Add-on Dev Seconds',
      'Total Bonus Dev Seconds',
      'Total Dev Seconds',
    ];

    const rows = safeTeams.map((t) => {
      const memberList = (t.members || [])
        .map((m) => `${m.name} (${m.usn})`)
        .join('; ');

      const problemList = (t.problems || [])
        .map(
          (p) =>
            `[Q#${p.question_number ?? '?'}: ${p.topic_title} - Bid: ${p.winning_bid} pts - Diff: ${p.difficulty} - Base: ${p.base_dev_seconds}s - Bonus: ${p.bonus_dev_seconds}s]`
        )
        .join('; ');

      return [
        `"${t.team_name.replace(/"/g, '""')}"`,
        `"${(t.captain_name || '').replace(/"/g, '""')}"`,
        `"${t.captain_usn || ''}"`,
        t.member_count,
        `"${memberList.replace(/"/g, '""')}"`,
        `"${t.registered_at || ''}"`,
        t.balance,
        t.total_spent,
        t.won_count,
        `"${problemList.replace(/"/g, '""')}"`,
        t.total_base_dev_seconds,
        t.total_addon_dev_seconds ?? 0,
        t.total_bonus_dev_seconds,
        t.total_dev_seconds,
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `bid2build_bidding_results_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const addonDraftFor = (team: BiddingResultTeam): string =>
    addonDrafts[team.team_id] ??
    (team.dev_addon_seconds == null ? '' : String(Math.round(team.dev_addon_seconds / 60)));

  const commitTeamAddon = async (team: BiddingResultTeam, raw: string) => {
    if (!onSaveTeamAddon || savingAddonTeam === team.team_id) return;

    const trimmed = raw.trim();
    let minutes: number | null = null;
    if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 600) {
        setAddonError(`${team.team_name}: enter between 0 and 600 minutes, or leave blank to use the default.`);
        return;
      }
      minutes = Math.round(parsed);
    }

    const current =
      team.dev_addon_seconds == null ? null : Math.round(team.dev_addon_seconds / 60);
    if (minutes === current) {
      setAddonDrafts((prev) => {
        const next = { ...prev };
        delete next[team.team_id];
        return next;
      });
      return;
    }

    setSavingAddonTeam(team.team_id);
    setAddonError(null);
    const res = await onSaveTeamAddon(team.team_id, minutes);
    if (res.success) {
      setAddonDrafts((prev) => {
        const next = { ...prev };
        delete next[team.team_id];
        return next;
      });
      await onRefresh();
    } else {
      setAddonError(`${team.team_name}: ${res.error || 'Failed to save the add-on.'}`);
    }
    setSavingAddonTeam(null);
  };

  return (
    <div className="space-y-6">
      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[#141518] border border-white/10 rounded-2xl p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Registered Teams
          </span>
          <span className="text-2xl font-black text-white font-mono mt-1 block">
            {summary.totalTeams}
          </span>
        </div>

        <div className="bg-[#141518] border border-white/10 rounded-2xl p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Teams With Won Problems
          </span>
          <span className="text-2xl font-black text-emerald-400 font-mono mt-1 block">
            {summary.teamsWithWins}
          </span>
        </div>

        <div className="bg-[#141518] border border-white/10 rounded-2xl p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Total Problems Acquired
          </span>
          <span className="text-2xl font-black text-[#fe5102] font-mono mt-1 block">
            {summary.totalWins}
          </span>
        </div>

        <div className="bg-[#141518] border border-white/10 rounded-2xl p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Total Coins Spent
          </span>
          <span className="text-2xl font-black text-amber-400 font-mono mt-1 block">
            {summary.totalCoinsSpent}
          </span>
        </div>
      </div>

      {/* Control Bar: Search, Filters, Refresh, Export */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#141518] border border-white/10 rounded-2xl p-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search team, captain, USN, problem..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#fe5102]"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Filter Pills */}
          <div className="inline-flex rounded-xl bg-zinc-900 border border-zinc-800 p-1 text-xs">
            <button
              type="button"
              onClick={() => setFilterWon('all')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                filterWon === 'all'
                  ? 'bg-[#fe5102] text-white shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              All ({safeTeams.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterWon('won')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                filterWon === 'won'
                  ? 'bg-[#fe5102] text-white shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Acquired ({summary.teamsWithWins})
            </button>
            <button
              type="button"
              onClick={() => setFilterWon('nowins')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                filterWon === 'nowins'
                  ? 'bg-[#fe5102] text-white shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              No Wins ({safeTeams.length - summary.teamsWithWins})
            </button>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer disabled:opacity-50"
            title="Refresh from database"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#fe5102]' : ''}`} />
          </button>

          {/* Export CSV Button */}
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={safeTeams.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {addonError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300">
          {addonError}
        </div>
      )}

      {/* Main Table */}
      <div className="bg-[#141518] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1a1b20] border-b border-white/10 text-zinc-400 uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4">Team &amp; Captain</th>
                <th className="py-3 px-3">Members</th>
                <th className="py-3 px-3 text-center">Registered</th>
                <th className="py-3 px-3 text-right">Balance</th>
                <th className="py-3 px-3 text-right">Total Spent</th>
                <th className="py-3 px-4">Acquired Problems &amp; Amounts</th>
                <th className="py-3 px-3 text-right">Base Dev</th>
                <th className="py-3 px-3 text-right" title="Type minutes per team; blank uses the default">Team Add-on (min)</th>
                <th className="py-3 px-3 text-right">Bonus Time</th>
                <th className="py-3 px-4 text-right">Total Dev Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-medium">
              {filteredTeams.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-zinc-500">
                    {isLoading ? 'Loading authoritative bidding results...' : 'No team results match your filter.'}
                  </td>
                </tr>
              ) : (
                filteredTeams.map((team) => {
                  const isExpanded = expandedTeamId === team.team_id;
                  const hasProblems = team.problems && team.problems.length > 0;
                  const addonDraft = addonDraftFor(team);
                  const isSavingAddon = savingAddonTeam === team.team_id;

                  return (
                    <React.Fragment key={team.team_id}>
                      <tr className="hover:bg-white/[0.02] transition-colors">
                        {/* Team & Captain */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white text-sm">
                            {team.team_name}
                          </div>
                          <div className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-1.5">
                            <span>Capt:</span>
                            <span className="text-zinc-200 font-semibold">{team.captain_name || '—'}</span>
                            {team.captain_usn && (
                              <span className="font-mono text-[10px] bg-zinc-800 px-1.5 py-0.2 rounded text-zinc-300">
                                {team.captain_usn}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Members */}
                        <td className="py-3.5 px-3">
                          <button
                            type="button"
                            onClick={() => setExpandedTeamId(isExpanded ? null : team.team_id)}
                            className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                          >
                            <span className="font-bold font-mono bg-zinc-800/80 px-2 py-0.5 rounded-md border border-white/5">
                              {team.member_count} members
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                            )}
                          </button>
                        </td>

                        {/* Registration Date */}
                        <td className="py-3.5 px-3 text-center text-zinc-400 font-mono text-[11px]">
                          {formatDate(team.registered_at)}
                        </td>

                        {/* Valid Balance */}
                        <td className="py-3.5 px-3 text-right">
                          <span
                            className={`font-black font-mono text-sm ${
                              team.balance < 20 ? 'text-amber-400' : 'text-emerald-400'
                            }`}
                          >
                            {team.balance}
                          </span>
                          <span className="text-[10px] text-zinc-500 block">coins</span>
                        </td>

                        {/* Total Spent */}
                        <td className="py-3.5 px-3 text-right">
                          <span className="font-black font-mono text-sm text-[#fe5102]">
                            {team.total_spent}
                          </span>
                          <span className="text-[10px] text-zinc-500 block">pts deducted</span>
                        </td>

                        {/* Acquired Problems & Winning Amounts */}
                        <td className="py-3.5 px-4">
                          {!hasProblems ? (
                            <span className="text-zinc-500 italic text-[11px]">None acquired</span>
                          ) : (
                            <div className="space-y-1.5 max-w-md">
                              {team.problems.map((p: BiddingResultProblem) => (
                                <div
                                  key={p.slot_id}
                                  className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-zinc-900/80 border border-white/5"
                                >
                                  <div className="truncate">
                                    <span className="text-[10px] font-bold font-mono text-zinc-400 mr-1.5">
                                      #{String(p.question_number ?? 0).padStart(2, '0')}
                                    </span>
                                    <span className="font-semibold text-zinc-200">
                                      {p.topic_title}
                                    </span>
                                    <span
                                      className={`ml-1.5 text-[9px] uppercase font-bold px-1.5 py-0.2 rounded ${
                                        p.difficulty === 'hard'
                                          ? 'bg-purple-500/20 text-purple-300'
                                          : 'bg-emerald-500/20 text-emerald-300'
                                      }`}
                                    >
                                      {p.difficulty}
                                    </span>
                                  </div>
                                  <div className="shrink-0 font-mono font-bold text-amber-400 text-xs">
                                    {p.winning_bid} pts
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Base Dev Time */}
                        <td className="py-3.5 px-3 text-right font-mono text-zinc-300">
                          {formatDevTime(team.total_base_dev_seconds)}
                        </td>

                        {/* Per-team add-on: type minutes directly in the row */}
                        <td className="py-3.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              min={0}
                              max={600}
                              step={1}
                              value={addonDraft}
                              placeholder={
                                (team.admin_addon_dev_seconds ?? defaultAddonSeconds) > 0
                                  ? String(
                                      Math.round(
                                        (team.admin_addon_dev_seconds ?? defaultAddonSeconds) / 60
                                      )
                                    )
                                  : '0'
                              }
                              onChange={(e) =>
                                setAddonDrafts((prev) => ({
                                  ...prev,
                                  [team.team_id]: e.target.value,
                                }))
                              }
                              onBlur={(e) => void commitTeamAddon(team, e.currentTarget.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                              }}
                              disabled={!onSaveTeamAddon || isSavingAddon}
                              aria-label={`Development add-on minutes for ${team.team_name}`}
                              title="Type this team's add-on in minutes. Leave blank to use the global default."
                              className={`w-16 rounded-md border bg-zinc-900 px-2 py-1 text-right font-mono text-xs text-emerald-300 focus:outline-none focus:ring-2 focus:ring-[#fe5102] disabled:opacity-60 ${
                                team.dev_addon_seconds != null
                                  ? 'border-emerald-500/40'
                                  : 'border-zinc-700'
                              }`}
                            />
                            <span className="text-[10px] text-zinc-500">min</span>
                            {isSavingAddon && <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />}
                          </div>
                          <span className="mt-0.5 block text-[9px] text-zinc-500">
                            {team.dev_addon_seconds != null
                              ? 'team override'
                              : `default ${formatDevTime(team.total_addon_dev_seconds ?? 0)}`}
                          </span>
                        </td>

                        {/* Earned bonus time from evaluations */}
                        <td className="py-3.5 px-3 text-right font-mono">
                          {team.total_bonus_dev_seconds > 0 ? (
                            <span className="text-emerald-400 font-bold">
                              +{formatDevTime(team.total_bonus_dev_seconds)}
                            </span>
                          ) : (
                            <span className="text-zinc-500">0 min</span>
                          )}
                        </td>

                        {/* Total Dev Time */}
                        <td className="py-3.5 px-4 text-right">
                          <span className="font-black font-mono text-emerald-400 text-sm">
                            {formatDevTime(team.total_dev_seconds)}
                          </span>
                        </td>
                      </tr>

                      {/* Expanded Members Drawer */}
                      {isExpanded && (
                        <tr className="bg-zinc-900/50">
                          <td colSpan={10} className="py-3 px-6">
                            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                              Team Roster ({team.members?.length || 0} members)
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {(team.members || []).map((m, mIdx) => (
                                <div
                                  key={mIdx}
                                  className="p-2 rounded-lg bg-zinc-900 border border-white/5 flex items-center justify-between"
                                >
                                  <div>
                                    <span className="font-semibold text-white block">
                                      {m.name}
                                    </span>
                                    <span className="font-mono text-[10px] text-zinc-400">
                                      {m.usn}
                                    </span>
                                  </div>
                                  {m.is_captain && (
                                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#fe5102]/20 text-[#fe5102]">
                                      Captain
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-zinc-500">
        <span className="font-semibold text-zinc-400">Per-team add-on:</span> type minutes in a
        team&apos;s row and press Enter (or click away) to save. Leave the box blank to inherit the
        global default of {formatDevTime(defaultAddonSeconds)}. Only teams with a value get the extra
        time; the total updates immediately.
      </p>
    </div>
  );
}
