import { supabase } from '@/lib/supabase';
import type { AdminDevTimeConfig, ContestFlowState, ServiceResult } from '../types/auctionAdmin';
import type { TeamDevStatus } from '../../../types/teamDev';
import type { Json } from '../../../types/database';

/**
 * Admin Development Timer & Submission-Control services
 * Bid2Build (Auction Contest Platform)
 *
 * Primary path: the authoritative PostgreSQL RPCs that back the centrally
 * stored development timer (public.dev_timer_started_at) and the
 * submissions-enabled flag (public.submissions_enabled). All state lives in
 * Supabase, so it survives page refreshes and is consistent across clients.
 *
 * Resilience path: when those RPCs have not been deployed yet (migration 027
 * missing from the target project), the same state is read/written directly
 * through the `settings` table. The settings RLS policy already restricts
 * writes to admins, so this fallback keeps the admin controls functional
 * without weakening authorization. The RPCs remain the preferred path because
 * they also provide server-side clock math and audit logging.
 */

const DEFAULT_BASE_DEV_SECONDS = 4500;
const DEFAULT_ADDON_DEV_SECONDS = 0;
const AUTO_ENABLE_WINDOW_SECONDS = 20 * 60;
const MAX_ADDON_SECONDS = 3600;

const FLOW_SETTING_KEYS = [
  'solving_timer_seconds',
  'admin_dev_addon_seconds',
  'dev_timer_started_at',
  'dev_timer_paused_at',
  'dev_timer_paused_total_ms',
  'submissions_enabled',
  'submissions_manually_enabled',
  'submissions_suppressed',
];

const FALLBACK_WARNING =
  'Contest-flow RPCs are not deployed on this Supabase project; using the direct settings fallback. Apply supabase/migrations/026_admin_dev_addon_and_top25_locks.sql, 027_contest_flow.sql, 028_team_dev_timers.sql, and 030_dev_timer_pause_and_submission_toggle.sql to restore the 75-minute base, pause/resume, server-side timer math, team deadlines, and audit logging.';

type SettingsMap = Map<string, Json>;

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

interface TeamFallbackRow {
  id: string;
  dev_addon_seconds?: number | null;
  dq_at?: string | null;
}

function isMissingRpcError(error: unknown): boolean {
  const e = (error ?? {}) as PostgrestLikeError;
  const code = e.code ?? '';
  const text = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase();

  if (code === 'PGRST202' || code === '42883' || code === '404') return true;
  if (text.includes('could not find the function')) return true;
  if (text.includes('function') && text.includes('does not exist')) return true;
  return false;
}

function toFiniteNumber(value: Json | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, Json | undefined>;
    for (const key of ['value', 'seconds', 'ms', 'milliseconds']) {
      const nested = obj[key];
      if (typeof nested === 'number' && Number.isFinite(nested)) return nested;
      if (typeof nested === 'string' && nested.trim() !== '') {
        const parsed = Number(nested);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return fallback;
}

function toBoolean(value: Json | undefined, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 't', 'yes', 'y', '1'].includes(normalized)) return true;
    if (['false', 'f', 'no', 'n', '0'].includes(normalized)) return false;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, Json | undefined>;
    return toBoolean(obj.enabled ?? obj.value, fallback);
  }
  return fallback;
}

async function readSettings(keys: string[]): Promise<{ settings: SettingsMap; error: string | null }> {
  try {
    const { data, error } = await supabase.from('settings').select('key,value').in('key', keys);
    if (error) {
      return { settings: new Map(), error: error.message || 'Failed to read contest settings.' };
    }
    const settings: SettingsMap = new Map();
    for (const row of data ?? []) settings.set(row.key, row.value);
    return { settings, error: null };
  } catch (err) {
    return {
      settings: new Map(),
      error: err instanceof Error ? err.message : 'Failed to read contest settings.',
    };
  }
}

async function writeSettings(entries: Array<{ key: string; value: Json }>): Promise<string | null> {
  try {
    const { error } = await supabase.from('settings').upsert(entries, { onConflict: 'key' });
    return error ? error.message || 'Failed to save contest settings.' : null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Failed to save contest settings.';
  }
}

function buildDevTimeConfig(settings: SettingsMap): AdminDevTimeConfig {
  const base = Math.max(
    0,
    Math.floor(toFiniteNumber(settings.get('solving_timer_seconds'), DEFAULT_BASE_DEV_SECONDS))
  );
  const addon = Math.max(
    0,
    Math.floor(toFiniteNumber(settings.get('admin_dev_addon_seconds'), DEFAULT_ADDON_DEV_SECONDS))
  );
  return {
    base_dev_seconds: base,
    addon_dev_seconds: addon,
    total_dev_seconds: base + addon,
  };
}

function computeFlowState(settings: SettingsMap, nowMs: number): ContestFlowState {
  const config = buildDevTimeConfig(settings);
  const startedMs = Math.floor(toFiniteNumber(settings.get('dev_timer_started_at'), 0));
  const pausedAtMs = Math.floor(toFiniteNumber(settings.get('dev_timer_paused_at'), 0));
  const pausedTotalMs = Math.max(
    0,
    Math.floor(toFiniteNumber(settings.get('dev_timer_paused_total_ms'), 0))
  );
  const paused = pausedAtMs > 0;
  const enabled = toBoolean(settings.get('submissions_enabled'), false);
  const manual = toBoolean(settings.get('submissions_manually_enabled'), false);
  const suppressed = toBoolean(settings.get('submissions_suppressed'), false);

  let remaining = config.total_dev_seconds;
  let status: ContestFlowState['dev_timer_status'] = 'not_started';

  if (startedMs > 0) {
    // While paused the clock is frozen at the pause timestamp.
    const effectiveNowMs = paused ? pausedAtMs : nowMs;
    const elapsedMs = Math.max(0, effectiveNowMs - startedMs - pausedTotalMs);
    remaining = Math.max(0, config.total_dev_seconds - Math.floor(elapsedMs / 1000));
    status = remaining <= 0 ? 'finished' : paused ? 'paused' : 'running';
  }

  return {
    dev_timer_started_at_ms: startedMs > 0 ? startedMs : null,
    dev_timer_paused_at_ms: paused ? pausedAtMs : null,
    dev_timer_paused_total_seconds: Math.floor(pausedTotalMs / 1000),
    dev_timer_total_seconds: config.total_dev_seconds,
    dev_timer_remaining_seconds: remaining,
    dev_timer_status: status,
    submissions_enabled: suppressed ? false : enabled,
    submissions_manually_enabled: manual,
    submissions_suppressed: suppressed,
    submissions_source: suppressed ? 'none' : manual ? 'manual' : enabled ? 'auto' : 'none',
    server_time: new Date(nowMs).toISOString(),
  };
}

/** Mirrors the RPC's once-only automatic enablement during the final 20 minutes. */
async function applyAutoEnableFallback(flow: ContestFlowState): Promise<ContestFlowState> {
  const shouldAutoEnable =
    flow.dev_timer_status === 'running' &&
    flow.dev_timer_remaining_seconds <= AUTO_ENABLE_WINDOW_SECONDS &&
    !flow.submissions_enabled &&
    !flow.submissions_manually_enabled &&
    !flow.submissions_suppressed;

  if (!shouldAutoEnable) return flow;

  const writeError = await writeSettings([{ key: 'submissions_enabled', value: true }]);
  if (writeError) return flow;

  return { ...flow, submissions_enabled: true, submissions_source: 'auto' };
}

async function readFlowFallback(): Promise<ServiceResult<ContestFlowState>> {
  const { settings, error } = await readSettings(FLOW_SETTING_KEYS);
  if (error) return { success: false, error };

  const flow = computeFlowState(settings, Date.now());
  const withAutoEnable = await applyAutoEnableFallback(flow);
  return { success: true, data: withAutoEnable, warning: FALLBACK_WARNING };
}

/** Fetch the admin-managed development time config (base 75 min + add-on). */
export async function fetchAdminDevTimeConfig(): Promise<ServiceResult<AdminDevTimeConfig>> {
  try {
    const { data, error } = await supabase.rpc('get_admin_dev_time_config');
    if (!error && data) {
      return { success: true, data: data as AdminDevTimeConfig };
    }
    if (error && !isMissingRpcError(error)) {
      return { success: false, error: error.message || 'Failed to load development time config.' };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error loading development time config.',
      };
    }
  }

  const { settings, error } = await readSettings(['solving_timer_seconds', 'admin_dev_addon_seconds']);
  if (error) return { success: false, error };
  return { success: true, data: buildDevTimeConfig(settings), warning: FALLBACK_WARNING };
}

/** Save the admin add-on development time in minutes (validated server-side). */
export async function saveAdminDevAddonMinutes(minutes: number): Promise<ServiceResult<AdminDevTimeConfig>> {
  try {
    const { data, error } = await supabase.rpc('set_admin_dev_addon_seconds', {
      p_seconds: Math.round(minutes * 60),
    });
    if (!error && data) {
      return { success: true, data: data as AdminDevTimeConfig };
    }
    if (error && !isMissingRpcError(error)) {
      return {
        success: false,
        error: error.message || 'Failed to save development time add-on.',
      };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error saving development time add-on.',
      };
    }
  }

  const seconds = Math.min(MAX_ADDON_SECONDS, Math.max(0, Math.round(minutes * 60)));
  const writeError = await writeSettings([{ key: 'admin_dev_addon_seconds', value: seconds }]);
  if (writeError) return { success: false, error: writeError };

  const { settings, error } = await readSettings(['solving_timer_seconds', 'admin_dev_addon_seconds']);
  if (error) return { success: false, error };
  return { success: true, data: buildDevTimeConfig(settings), warning: FALLBACK_WARNING };
}

/**
 * Set (or clear) one team's development add-on.
 *
 * `minutes === null` removes the override so the team inherits the global
 * admin add-on again. The SQL RPC also refuses to shorten a deadline when the
 * team already submitted; that message is surfaced unchanged.
 */
export async function saveTeamDevAddonMinutes(
  teamId: string,
  minutes: number | null
): Promise<ServiceResult<TeamDevStatus>> {
  const seconds =
    minutes === null
      ? null
      : Math.min(600, Math.max(0, Math.round(minutes))) * 60;

  try {
    const { data, error } = await supabase.rpc('set_team_dev_addon_seconds', {
      p_team_id: teamId,
      p_seconds: seconds,
    });
    if (!error && data) {
      return { success: true, data: data as TeamDevStatus };
    }
    if (error && !isMissingRpcError(error)) {
      return { success: false, error: error.message || 'Failed to save the team add-on.' };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error saving the team add-on.',
      };
    }
  }

  // Fallback for projects without migration 028: the column and the settings
  // RLS policy still let an authenticated admin write the override directly.
  const { error: updateError } = await supabase
    .from('teams')
    .update({ dev_addon_seconds: seconds })
    .eq('id', teamId);
  if (updateError) return { success: false, error: updateError.message };

  return getTeamDevStatus(teamId);
}

/** Authoritative contest flow state: dev timer + submissions flags. */
export async function fetchContestFlowState(): Promise<ServiceResult<ContestFlowState>> {
  try {
    const { data, error } = await supabase.rpc('get_contest_flow_state');
    if (!error && data) {
      return { success: true, data: data as ContestFlowState };
    }
    if (error && !isMissingRpcError(error)) {
      return { success: false, error: error.message || 'Failed to load contest flow state.' };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error loading contest flow state.',
      };
    }
  }

  return readFlowFallback();
}

async function startDevTimerFallback(): Promise<ServiceResult<ContestFlowState>> {
  const initial = await readFlowFallback();
  if (!initial.success || !initial.data) return initial;

  const startedAt = initial.data.dev_timer_started_at_ms;
  const pausedAt = initial.data.dev_timer_paused_at_ms ?? null;

  // Resume a paused timer: bank the elapsed pause and clear the pause marker.
  if (startedAt !== null && pausedAt !== null) {
    const nowMs = Date.now();
    const banked =
      (initial.data.dev_timer_paused_total_seconds ?? 0) * 1000 + Math.max(0, nowMs - pausedAt);
    const writeError = await writeSettings([
      { key: 'dev_timer_paused_total_ms', value: banked },
      { key: 'dev_timer_paused_at', value: 0 },
    ]);
    if (writeError) return { success: false, error: writeError };
    return readFlowFallback();
  }

  // Idempotent: never restart a timer that has already been started.
  if (startedAt !== null) return initial;

  const startedMs = Date.now();

  // Conditional update keeps concurrent admin clicks from starting twice.
  const { error: updateError, count } = await supabase
    .from('settings')
    .update({ value: startedMs }, { count: 'exact' })
    .eq('key', 'dev_timer_started_at')
    .eq('value', 0);

  if (updateError) return { success: false, error: updateError.message };

  if (!count) {
    const { error: insertError } = await supabase
      .from('settings')
      .insert({ key: 'dev_timer_started_at', value: startedMs });

    // 23505 = another admin inserted the row first; the state read below wins.
    if (insertError && insertError.code !== '23505') {
      return { success: false, error: insertError.message };
    }
  }

  // A fresh run must not inherit a stale pause from a previous session.
  const resetPauseError = await writeSettings([
    { key: 'dev_timer_paused_at', value: 0 },
    { key: 'dev_timer_paused_total_ms', value: 0 },
  ]);
  if (resetPauseError) return { success: false, error: resetPauseError };

  let next = await readFlowFallback();
  if (next.success && next.data && next.data.dev_timer_started_at_ms === null) {
    // Older projects may store the zero as a JSON string; force the start once.
    const writeError = await writeSettings([{ key: 'dev_timer_started_at', value: startedMs }]);
    if (writeError) return { success: false, error: writeError };
    next = await readFlowFallback();
  }
  return next;
}

/** Admin starts the central development timer. Idempotent while running. */
export async function startDevTimer(): Promise<ServiceResult<ContestFlowState>> {
  try {
    const { data, error } = await supabase.rpc('start_dev_timer');
    if (!error && data) {
      return { success: true, data: data as ContestFlowState };
    }
    if (error && !isMissingRpcError(error)) {
      return { success: false, error: error.message || 'Failed to start the development timer.' };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error starting development timer.',
      };
    }
  }

  return startDevTimerFallback();
}

/** Admin pauses the development timer without losing elapsed progress. */
export async function pauseDevTimer(): Promise<ServiceResult<ContestFlowState>> {
  try {
    const { data, error } = await supabase.rpc('pause_dev_timer');
    if (!error && data) {
      return { success: true, data: data as ContestFlowState };
    }
    if (error && !isMissingRpcError(error)) {
      return { success: false, error: error.message || 'Failed to pause the development timer.' };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error pausing development timer.',
      };
    }
  }

  const initial = await readFlowFallback();
  if (!initial.success || !initial.data) return initial;
  if (initial.data.dev_timer_status !== 'running') return initial;

  const writeError = await writeSettings([
    { key: 'dev_timer_paused_at', value: Date.now() },
  ]);
  if (writeError) return { success: false, error: writeError };
  return readFlowFallback();
}

/** Admin resets the development timer so it can be started again. */
export async function resetDevTimer(): Promise<ServiceResult<ContestFlowState>> {
  try {
    const { data, error } = await supabase.rpc('reset_dev_timer');
    if (!error && data) {
      return { success: true, data: data as ContestFlowState };
    }
    if (error && !isMissingRpcError(error)) {
      return { success: false, error: error.message || 'Failed to reset the development timer.' };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error resetting development timer.',
      };
    }
  }

  // Reset clears the development clock (including pause state) and the
  // submission portal so the next run starts from a clean slate.
  const writeError = await writeSettings([
    { key: 'dev_timer_started_at', value: 0 },
    { key: 'dev_timer_paused_at', value: 0 },
    { key: 'dev_timer_paused_total_ms', value: 0 },
    { key: 'submissions_enabled', value: false },
    { key: 'submissions_manually_enabled', value: false },
    { key: 'submissions_suppressed', value: false },
  ]);
  if (writeError) return { success: false, error: writeError };
  return readFlowFallback();
}

/** Admin enables the submission portal for participants. */
export async function enableSubmissions(): Promise<ServiceResult<ContestFlowState>> {
  try {
    const { data, error } = await supabase.rpc('enable_submissions');
    if (!error && data) {
      return { success: true, data: data as ContestFlowState };
    }
    if (error && !isMissingRpcError(error)) {
      return { success: false, error: error.message || 'Failed to enable submissions.' };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error enabling submissions.',
      };
    }
  }

  const writeError = await writeSettings([
    { key: 'submissions_enabled', value: true },
    { key: 'submissions_manually_enabled', value: true },
    { key: 'submissions_suppressed', value: false },
  ]);
  if (writeError) return { success: false, error: writeError };
  return readFlowFallback();
}

/** Admin disables the submission portal (overrides the automatic window). */
export async function disableSubmissions(): Promise<ServiceResult<ContestFlowState>> {
  try {
    const { data, error } = await supabase.rpc('disable_submissions');
    if (!error && data) {
      return { success: true, data: data as ContestFlowState };
    }
    if (error && !isMissingRpcError(error)) {
      return { success: false, error: error.message || 'Failed to disable submissions.' };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error disabling submissions.',
      };
    }
  }

  const writeError = await writeSettings([
    { key: 'submissions_enabled', value: false },
    { key: 'submissions_manually_enabled', value: false },
    { key: 'submissions_suppressed', value: true },
  ]);
  if (writeError) return { success: false, error: writeError };
  return readFlowFallback();
}

async function readTeamDevStatusFallback(teamId: string): Promise<ServiceResult<TeamDevStatus>> {
  const { settings, error } = await readSettings([
    'solving_timer_seconds',
    'admin_dev_addon_seconds',
    'dev_timer_started_at',
    'dev_timer_paused_at',
    'dev_timer_paused_total_ms',
  ]);
  if (error) return { success: false, error };

  const config = buildDevTimeConfig(settings);
  const startedMs = Math.floor(toFiniteNumber(settings.get('dev_timer_started_at'), 0));
  const pausedAtMs = Math.floor(toFiniteNumber(settings.get('dev_timer_paused_at'), 0));
  const pausedTotalMs = Math.max(
    0,
    Math.floor(toFiniteNumber(settings.get('dev_timer_paused_total_ms'), 0))
  );
  const paused = pausedAtMs > 0;
  const nowMs = Date.now();

  // `dev_addon_seconds` / `dq_at` only exist after migration 028; retry with
  // the base columns so the fallback still works on older projects.
  let team: TeamFallbackRow | null = null;
  const { data: teamData, error: teamError } = await supabase
    .from('teams')
    .select('id, dev_addon_seconds, dq_at')
    .eq('id', teamId)
    .maybeSingle();

  if (!teamError) {
    team = teamData;
  } else {
    const { data: basicTeam, error: basicError } = await supabase
      .from('teams')
      .select('id')
      .eq('id', teamId)
      .maybeSingle();
    if (basicError) return { success: false, error: basicError.message };
    team = basicTeam;
  }

  if (!team) return { success: false, error: 'Team not found.' };

  const [{ data: bonuses, error: bonusError }, { data: submissions, error: submissionError }] =
    await Promise.all([
      supabase.from('bonus_transactions').select('bonus_seconds').eq('team_id', teamId),
      supabase.from('submissions').select('id').eq('team_id', teamId).limit(1),
    ]);

  if (bonusError) return { success: false, error: bonusError.message };
  if (submissionError) return { success: false, error: submissionError.message };

  const bonusSeconds = (bonuses ?? []).reduce(
    (sum, row) => sum + (typeof row.bonus_seconds === 'number' ? row.bonus_seconds : 0),
    0
  );
  const effectiveAddon = team.dev_addon_seconds ?? config.addon_dev_seconds;
  const totalSeconds = Math.max(0, config.base_dev_seconds + effectiveAddon + bonusSeconds);
  // While paused the deadline keeps sliding, so the remaining time is frozen.
  const activePauseMs = paused ? Math.max(0, nowMs - pausedAtMs) : 0;
  const deadlineMs =
    startedMs > 0
      ? startedMs + totalSeconds * 1000 + pausedTotalMs + activePauseMs
      : null;
  const remainingSeconds =
    deadlineMs === null ? 0 : Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
  const status: TeamDevStatus['dev_timer_status'] =
    deadlineMs === null
      ? 'not_started'
      : remainingSeconds <= 0
      ? 'finished'
      : paused
      ? 'paused'
      : 'running';
  const opensMs = deadlineMs === null ? null : deadlineMs - AUTO_ENABLE_WINDOW_SECONDS * 1000;
  const hasSubmission = (submissions?.length ?? 0) > 0;
  const dqAt = team.dq_at ?? null;
  const windowOpen =
    deadlineMs !== null &&
    opensMs !== null &&
    !paused &&
    dqAt === null &&
    nowMs <= deadlineMs &&
    nowMs >= opensMs;
  const dqPending =
    dqAt === null && !paused && deadlineMs !== null && deadlineMs < nowMs && !hasSubmission;

  return {
    success: true,
    data: {
      team_id: teamId,
      dev_timer_started_at_ms: startedMs > 0 ? startedMs : null,
      dev_timer_paused_at_ms: paused ? pausedAtMs : null,
      dev_addon_seconds: effectiveAddon,
      dev_timer_total_seconds: totalSeconds,
      dev_timer_remaining_seconds: remainingSeconds,
      dev_timer_status: status,
      dev_deadline: deadlineMs === null ? null : new Date(deadlineMs).toISOString(),
      submission_opens_at: opensMs === null ? null : new Date(opensMs).toISOString(),
      dq_at: dqAt,
      dq_pending: dqPending,
      has_submission: hasSubmission,
      submission_window_open: windowOpen,
      server_time: new Date(nowMs).toISOString(),
    },
    warning: FALLBACK_WARNING,
  };
}

/**
 * Fetch the live per-team development timer + submission window state
 * (public.get_team_dev_status, migration 028). Applies DQ idempotently
 * on the server before returning, so every reader sees current state.
 */
export async function getTeamDevStatus(teamId: string): Promise<ServiceResult<TeamDevStatus>> {
  try {
    const { data, error } = await supabase.rpc('get_team_dev_status', { p_team_id: teamId });
    if (!error && data) {
      return { success: true, data: data as TeamDevStatus };
    }
    if (error && !isMissingRpcError(error)) {
      return { success: false, error: error.message || 'Failed to load team dev status.' };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error loading team dev status.',
      };
    }
  }

  return readTeamDevStatusFallback(teamId);
}

/** Batch per-team dev statuses: concurrent calls, skips failures. */
export async function getTeamDevStatuses(teamIds: string[]): Promise<TeamDevStatus[]> {
  const results = await Promise.allSettled(teamIds.map((id) => getTeamDevStatus(id)));
  const statuses: TeamDevStatus[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.success && r.value.data) {
      statuses.push(r.value.data);
    }
  }
  return statuses;
}
