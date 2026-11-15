/**
 * Types for Admin Registration Management
 * Bid2Build (Auction Contest Platform)
 */

import { Database } from '@/types/database';

export type TeamRow = Database['public']['Tables']['teams']['Row'];
export type MemberRow = Database['public']['Tables']['members']['Row'];
export type WalletRow = Database['public']['Tables']['wallets']['Row'];

export interface RegisteredMember extends MemberRow {
  parsedUsn: string;
}

export interface RegisteredCaptainDetails {
  member: RegisteredMember;
  usn: string;
  semester: string | null;
  phone: string | null;
  collegeName: string;
}

export interface RegisteredTeamWithRelations extends TeamRow {
  members: RegisteredMember[];
  wallet?: { balance: number } | null;
  captain?: RegisteredCaptainDetails | null;
}

export interface RegistrationStatsData {
  totalTeams: number;
  totalParticipants: number;
  unlockedTeams: number;
  lockedTeams: number;
  maxCapacity: number;
  availableCapacity: number;
  capacityPercentage: number;
  isRegistrationOpen: boolean;
}

export interface RegistrationControlSettings {
  isRegistrationOpen: boolean;
  maxTeams: number;
}

export type RegistrationLockFilter = 'all' | 'unlocked' | 'locked';

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
