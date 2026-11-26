import { supabase } from '@/lib/supabase';
import {
  MemberRow,
  RegisteredMember,
  RegisteredCaptainDetails,
  RegisteredTeamWithRelations,
  RegistrationStatsData,
  RegistrationControlSettings,
  ServiceResult,
  DeleteTeamsResult,
} from '../types/registration';

export const DEFAULT_MAX_TEAMS = 60;
export const DEFAULT_REGISTRATION_OPEN = true;
export const MAX_CONTEST_CAPACITY = DEFAULT_MAX_TEAMS;

/**
 * Shape of raw joined query result from Supabase PostgREST
 */
interface RawTeamQueryResult {
  id: string;
  name: string;
  captain_id: string | null;
  locked: boolean;
  created_at: string;
  dev_addon_seconds?: number | null;
  dq_at?: string | null;
  members: MemberRow[] | null;
  wallets: { balance: number }[] | { balance: number } | null;
}

/**
 * Safely extracts USN from a student's email address.
 * Convention in Bid2Build: "{usn}@mite.ac.in" -> "{USN}"
 * Falls back to the email local part or raw string if formatting differs.
 */
export function parseUsnFromEmail(email?: string | null): string {
  if (!email || typeof email !== 'string') return 'N/A';
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex > 0) {
    return trimmed.substring(0, atIndex).toUpperCase();
  }
  return trimmed.toUpperCase() || 'N/A';
}

/**
 * Defensively parses captain semester and phone number from the college column.
 * Format used by registration route: "MITE - Sem {sem} (Ph: {phone})"
 * If parsing fails, preserves original values without inventing mock data.
 */
export function parseCaptainMetadata(college?: string | null): {
  semester: string | null;
  phone: string | null;
  collegeName: string;
} {
  if (!college || typeof college !== 'string') {
    return { semester: null, phone: null, collegeName: 'MITE' };
  }

  const raw = college.trim();

  // Match "Sem {digit/text}"
  const semMatch = raw.match(/Sem\s*([0-9A-Za-z]+)/i);
  // Match "Ph: {numbers}", "Phone: ...", "Mob: ...", or fallback 10-digit Indian mobile number
  const prefixMatch = raw.match(/(?:Ph(?:one)?|Mob(?:ile)?|Contact):\s*([+0-9\s-]+)/i);
  const barePhoneMatch = !prefixMatch ? raw.match(/(?:(?:\+91|0)[\s-]?)?[6-9]\d{9}/) : null;

  const semester = semMatch ? semMatch[1].trim() : null;
  let phone: string | null = null;
  if (prefixMatch) {
    phone = prefixMatch[1].replace(/[()]/g, '').trim() || null;
  } else if (barePhoneMatch) {
    phone = barePhoneMatch[0].trim() || null;
  }

  // Extract base college name before the dash
  let collegeName = 'MITE';
  const dashIndex = raw.indexOf('-');
  if (dashIndex > 0) {
    collegeName = raw.substring(0, dashIndex).trim();
  } else if (!semMatch && !prefixMatch && !barePhoneMatch) {
    collegeName = raw;
  }

  return { semester, phone, collegeName };
}

/** True when PostgREST reports the 028 dev-timer teams columns as missing. */
function isMissingDevTimerColumnsError(message?: string): boolean {
  if (!message) return false;
  return message.includes('dev_addon_seconds') || message.includes('dq_at');
}

/**
 * Fetches all registered teams with their members and wallet information.
 * Uses the authenticated Supabase client respecting RLS.
 */
export async function fetchRegisteredTeams(): Promise<ServiceResult<RegisteredTeamWithRelations[]>> {
  try {
    // 1. Primary query selecting members.phone from PostgreSQL + 028 dev-timer columns.
    //    - If Migration 011 has not yet been applied, gracefully falls back to the schema without the phone column.
    //    - If Migration 028 has not yet been applied, gracefully falls back to the schema without dev-timer columns.
    let queryResult: {
      data: unknown;
      error: { message?: string } | null;
    } = await supabase
      .from('teams')
      .select(`
        id,
        name,
        captain_id,
        locked,
        created_at,
        dev_addon_seconds,
        dq_at,
        members (
          id,
          team_id,
          name,
          email,
          college,
          phone,
          created_at
        ),
        wallets (
          balance
        )
      `)
      .order('created_at', { ascending: false });

    // 2. Retry without the 028 dev-timer columns when the DB predates 028.
    if (queryResult.error && isMissingDevTimerColumnsError(queryResult.error.message)) {
      queryResult = await supabase
        .from('teams')
        .select(`
          id,
          name,
          captain_id,
          locked,
          created_at,
          members (
            id,
            team_id,
            name,
            email,
            college,
            phone,
            created_at
          ),
          wallets (
            balance
          )
        `)
        .order('created_at', { ascending: false });
    }

    // 3. Legacy fallback: retry without the phone column when the DB predates 011.
    if (
      queryResult.error &&
      (queryResult.error.message?.includes('phone') ||
        queryResult.error.message?.includes('column'))
    ) {
      queryResult = await supabase
        .from('teams')
        .select(`
          id,
          name,
          captain_id,
          locked,
          created_at,
          members (
            id,
            team_id,
            name,
            email,
            college,
            created_at
          ),
          wallets (
            balance
          )
        `)
        .order('created_at', { ascending: false });
    }

    const { data, error } = queryResult;

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to fetch registered teams from Supabase',
      };
    }

    if (!data) {
      return {
        success: true,
        data: [],
      };
    }

    // Process and enrich team records
    const rawList = data as unknown as RawTeamQueryResult[];
    const enrichedTeams: RegisteredTeamWithRelations[] = rawList.map((rawTeam) => {
      const rawMembers: MemberRow[] = Array.isArray(rawTeam.members) ? rawTeam.members : [];

      const members: RegisteredMember[] = rawMembers.map((m) => ({
        ...m,
        phone: m.phone ? m.phone.trim() : null,
        parsedUsn: parseUsnFromEmail(m.email),
      }));

      // Find captain member strictly through team.captain_id
      let captainMember: RegisteredMember | undefined;
      if (rawTeam.captain_id) {
        captainMember = members.find((m) => m.id === rawTeam.captain_id);
      }
      if (!captainMember && members.length > 0) {
        captainMember = members[0];
      }

      let captain: RegisteredCaptainDetails | null = null;
      if (captainMember) {
        const directPhone = captainMember.phone?.trim();
        const parsedMeta = parseCaptainMetadata(captainMember.college);
        captain = {
          member: captainMember,
          usn: captainMember.parsedUsn,
          semester: parsedMeta.semester,
          phone: directPhone || parsedMeta.phone,
          collegeName: parsedMeta.collegeName,
        };
      }

      // Handle wallet shape (array vs single object)
      const walletObj = Array.isArray(rawTeam.wallets) ? rawTeam.wallets[0] : rawTeam.wallets;
      const wallet = walletObj ? { balance: walletObj.balance ?? 100 } : null;

      return {
        id: rawTeam.id,
        name: rawTeam.name,
        captain_id: rawTeam.captain_id,
        locked: !!rawTeam.locked,
        created_at: rawTeam.created_at,
        dev_addon_seconds: rawTeam.dev_addon_seconds ?? null,
        dq_at: rawTeam.dq_at ?? null,
        members,
        wallet,
        captain,
      };
    });

    return {
      success: true,
      data: enrichedTeams,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error while loading registered teams';
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Calculates registration statistics dynamically from real database records and settings.
 */
export function calculateRegistrationStats(
  teams: RegisteredTeamWithRelations[],
  controlSettings?: Partial<RegistrationControlSettings>,
  deletedTeamsCount = 0
): RegistrationStatsData {
  const totalTeams = teams.length;
  const totalParticipants = teams.reduce((acc, t) => acc + (t.members?.length || 0), 0);
  const lockedTeams = teams.filter((t) => t.locked).length;
  const unlockedTeams = teams.filter((t) => !t.locked).length;
  const maxCapacity = controlSettings?.maxTeams ?? MAX_CONTEST_CAPACITY;
  const availableCapacity = Math.max(0, maxCapacity - totalTeams);
  const capacityPercentage = maxCapacity > 0 ? Math.min(100, Math.round((totalTeams / maxCapacity) * 100)) : 100;
  const isRegistrationOpen = controlSettings?.isRegistrationOpen ?? DEFAULT_REGISTRATION_OPEN;

  return {
    totalTeams,
    totalParticipants,
    unlockedTeams,
    lockedTeams,
    maxCapacity,
    availableCapacity,
    capacityPercentage,
    isRegistrationOpen,
    deletedTeamsCount,
  };
}

/**
 * Updates the lock status of a single team.
 * Uses the authenticated Supabase client respecting Admin RLS policy ("Admins manage teams").
 */
export async function updateTeamLockStatus(
  teamId: string,
  locked: boolean
): Promise<ServiceResult<{ id: string; locked: boolean }>> {
  try {
    const { data, error } = await supabase
      .from('teams')
      .update({ locked })
      .eq('id', teamId)
      .select('id, locked')
      .single();

    if (error) {
      return {
        success: false,
        error: error.message || `Failed to update team lock status to ${locked ? 'locked' : 'unlocked'}.`,
      };
    }

    if (!data) {
      return {
        success: false,
        error: 'Team not found or update returned no data.',
      };
    }

    return {
      success: true,
      data: {
        id: data.id,
        locked: data.locked,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error updating team lock status.';
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Updates the lock status of all teams globally.
 * To optimize database writes and minimize impact, only updates teams whose
 * current locked status differs from the target status.
 * Uses the authenticated Supabase client respecting Admin RLS policy ("Admins manage teams").
 */
export async function updateAllTeamsLockStatus(
  locked: boolean
): Promise<ServiceResult<{ updatedCount: number; locked: boolean }>> {
  try {
    const { data, error } = await supabase
      .from('teams')
      .update({ locked })
      .neq('locked', locked)
      .select('id');

    if (error) {
      return {
        success: false,
        error: error.message || `Failed to ${locked ? 'lock' : 'unlock'} all teams.`,
      };
    }

    const updatedCount = Array.isArray(data) ? data.length : 0;

    return {
      success: true,
      data: {
        updatedCount,
        locked,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : `Unknown error attempting to ${locked ? 'lock' : 'unlock'} all teams.`;
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Fetches the global registration control settings (registration_open and max_teams)
 * from public.settings using the authenticated Supabase client respecting Admin RLS.
 * Safely falls back to default values if rows are not yet seeded.
 */
export async function fetchRegistrationControlSettings(): Promise<
  ServiceResult<RegistrationControlSettings>
> {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['registration_open', 'max_teams']);

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to fetch registration settings from database.',
      };
    }

    let isRegistrationOpen = DEFAULT_REGISTRATION_OPEN;
    let maxTeams = DEFAULT_MAX_TEAMS;

    if (data) {
      for (const row of data) {
        if (row.key === 'registration_open') {
          const val = row.value;
          if (typeof val === 'boolean') {
            isRegistrationOpen = val;
          } else if (typeof val === 'string') {
            isRegistrationOpen = val.toLowerCase() === 'true';
          } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            const obj = val as Record<string, unknown>;
            if ('open' in obj) {
              isRegistrationOpen = Boolean(obj.open);
            } else if ('value' in obj) {
              isRegistrationOpen = Boolean(obj.value);
            }
          }
        } else if (row.key === 'max_teams') {
          const val = row.value;
          if (typeof val === 'number' && Number.isFinite(val)) {
            maxTeams = Math.floor(val);
          } else if (typeof val === 'string') {
            const parsed = parseInt(val, 10);
            if (!isNaN(parsed) && parsed > 0) maxTeams = parsed;
          } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            const obj = val as Record<string, unknown>;
            const candidate = obj.max ?? obj.teams ?? obj.value ?? obj.count;
            if (typeof candidate === 'number' && Number.isFinite(candidate)) {
              maxTeams = Math.floor(candidate);
            }
          }
        }
      }
    }

    return {
      success: true,
      data: {
        isRegistrationOpen,
        maxTeams,
      },
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Unknown error fetching registration settings.';
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Updates the global registration open/closed status in public.settings.
 * Uses upsert with onConflict on 'key' to cleanly handle existing or missing rows.
 * Respects Admin RLS policy ("Admins manage settings").
 */
export async function updateRegistrationOpenStatus(
  open: boolean
): Promise<ServiceResult<{ isRegistrationOpen: boolean }>> {
  try {
    const { error } = await supabase
      .from('settings')
      .upsert(
        {
          key: 'registration_open',
          value: open,
        },
        { onConflict: 'key' }
      );

    if (error) {
      return {
        success: false,
        error: error.message || `Failed to set registration to ${open ? 'open' : 'closed'}.`,
      };
    }

    return {
      success: true,
      data: { isRegistrationOpen: open },
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Unknown error updating registration open status.';
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Updates the maximum team capacity (max_teams) in public.settings.
 * Validates that maxTeams is a positive integer and not lower than currently registered teams.
 * Uses upsert with onConflict on 'key'.
 * Respects Admin RLS policy ("Admins manage settings").
 */
export async function updateMaxTeamsCapacity(
  maxTeams: number,
  currentRegisteredCount: number
): Promise<ServiceResult<{ maxTeams: number }>> {
  try {
    if (!Number.isInteger(maxTeams) || maxTeams <= 0) {
      return {
        success: false,
        error: 'Maximum team capacity must be a positive whole number.',
      };
    }

    if (maxTeams < currentRegisteredCount) {
      return {
        success: false,
        error: `Maximum capacity (${maxTeams}) cannot be lower than the number of registered teams (${currentRegisteredCount}).`,
      };
    }

    const { error } = await supabase
      .from('settings')
      .upsert(
        {
          key: 'max_teams',
          value: maxTeams,
        },
        { onConflict: 'key' }
      );

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to update maximum team capacity.',
      };
    }

    return {
      success: true,
      data: { maxTeams },
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Unknown error updating maximum team capacity.';
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Updates the lock status of a specific subset of teams (bulk action).
 * Uses the authenticated Supabase client, respecting the Admin RLS policy
 * ("Admins update teams"). Locked teams are protected from deletion.
 */
export async function updateSelectedTeamsLockStatus(
  teamIds: string[],
  locked: boolean
): Promise<ServiceResult<{ updatedCount: number; locked: boolean }>> {
  try {
    if (!teamIds || teamIds.length === 0) {
      return {
        success: false,
        error: 'No teams selected to update lock status.',
      };
    }

    const { data, error } = await supabase
      .from('teams')
      .update({ locked })
      .in('id', teamIds)
      .select('id');

    if (error) {
      return {
        success: false,
        error: error.message || `Failed to ${locked ? 'lock' : 'unlock'} selected teams.`,
      };
    }

    const updatedCount = Array.isArray(data) ? data.length : 0;

    // PostgREST returns only rows the caller is allowed to update. A short
    // count means RLS silently filtered some rows — surface it instead of
    // pretending the unlock worked.
    if (updatedCount !== teamIds.length) {
      return {
        success: false,
        error: `Only ${updatedCount} of ${teamIds.length} selected team(s) were updated. Your admin session may not have permission to modify teams.`,
      };
    }

    return {
      success: true,
      data: {
        updatedCount,
        locked,
      },
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : `Unknown error updating lock status for selected teams.`;
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Fetches the count of deleted teams tracked via audit_log records.
 * Queries rows where action = 'team_deleted' using head: true for high efficiency.
 * Respects Admin RLS policy ("Admins view audit log").
 */
export async function fetchDeletedTeamsCount(): Promise<ServiceResult<number>> {
  try {
    const { count, error } = await supabase
      .from('audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'team_deleted');

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to fetch deleted teams count from audit log.',
      };
    }

    return {
      success: true,
      data: count ?? 0,
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Unknown error fetching deleted teams count.';
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Permanently deletes every selected team in one transactional RPC call.
 * Locked teams are refused (unlock first). Bids are deleted, slot leader/winner
 * links are cleared, and members, wallets, submissions and solves cascade-delete.
 */
export async function deleteTeams(
  teamIds: string[]
): Promise<ServiceResult<DeleteTeamsResult>> {
  try {
    if (!teamIds || teamIds.length === 0) {
      return {
        success: false,
        error: 'No teams selected for deletion.',
      };
    }

    const { data, error } = await supabase.rpc('delete_teams', {
      p_team_ids: teamIds,
    });

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to delete selected teams.',
      };
    }

    const result = data as unknown as DeleteTeamsResult;

    return {
      success: true,
      data: result,
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : 'Unknown error executing team deletion.';
    return {
      success: false,
      error: msg,
    };
  }
}
