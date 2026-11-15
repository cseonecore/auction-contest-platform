import { supabase } from '@/lib/supabase';
import {
  MemberRow,
  RegisteredMember,
  RegisteredCaptainDetails,
  RegisteredTeamWithRelations,
  RegistrationStatsData,
  ServiceResult,
} from '../types/registration';

export const MAX_CONTEST_CAPACITY = 60;

/**
 * Shape of raw joined query result from Supabase PostgREST
 */
interface RawTeamQueryResult {
  id: string;
  name: string;
  captain_id: string | null;
  locked: boolean;
  created_at: string;
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
  // Match "Ph: {numbers and plus/dashes}"
  const phoneMatch = raw.match(/Ph:\s*([+0-9\s-]+)/i);

  const semester = semMatch ? semMatch[1].trim() : null;
  const phone = phoneMatch ? phoneMatch[1].replace(/[()]/g, '').trim() : null;

  // Extract base college name before the dash
  let collegeName = 'MITE';
  const dashIndex = raw.indexOf('-');
  if (dashIndex > 0) {
    collegeName = raw.substring(0, dashIndex).trim();
  } else if (!semMatch && !phoneMatch) {
    collegeName = raw;
  }

  return { semester, phone, collegeName };
}

/**
 * Fetches all registered teams with their members and wallet information.
 * Uses the authenticated Supabase client respecting RLS.
 */
export async function fetchRegisteredTeams(): Promise<ServiceResult<RegisteredTeamWithRelations[]>> {
  try {
    const { data, error } = await supabase
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
        parsedUsn: parseUsnFromEmail(m.email),
      }));

      // Find captain member
      let captainMember: RegisteredMember | undefined;
      if (rawTeam.captain_id) {
        captainMember = members.find((m) => m.id === rawTeam.captain_id);
      }
      if (!captainMember && members.length > 0) {
        captainMember = members[0];
      }

      let captain: RegisteredCaptainDetails | null = null;
      if (captainMember) {
        const parsedMeta = parseCaptainMetadata(captainMember.college);
        captain = {
          member: captainMember,
          usn: captainMember.parsedUsn,
          semester: parsedMeta.semester,
          phone: parsedMeta.phone,
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
 * Calculates registration statistics dynamically from real database records.
 */
export function calculateRegistrationStats(teams: RegisteredTeamWithRelations[]): RegistrationStatsData {
  const totalTeams = teams.length;
  const totalParticipants = teams.reduce((acc, t) => acc + (t.members?.length || 0), 0);
  const lockedTeams = teams.filter((t) => t.locked).length;
  const unlockedTeams = teams.filter((t) => !t.locked).length;
  const maxCapacity = MAX_CONTEST_CAPACITY;
  const capacityPercentage = Math.min(100, Math.round((totalTeams / maxCapacity) * 100));

  return {
    totalTeams,
    totalParticipants,
    unlockedTeams,
    lockedTeams,
    maxCapacity,
    capacityPercentage,
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
