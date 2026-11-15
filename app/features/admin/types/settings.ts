/**
 * Types for Admin Settings Management Module
 * Bid2Build (Auction Contest Platform)
 */

export interface SettingRecord {
  key: string;
  value: unknown;
}

export type KnownSettingKey =
  | 'min_bid'
  | 'min_raise'
  | 'opening_window_seconds'
  | 'starting_wallet_balance'
  | 'timer_extension_seconds'
  | 'bonus_points_rate';

export interface SettingsFormValues {
  min_bid: number;
  min_raise: number;
  opening_window_seconds: number;
  starting_wallet_balance: number;
  timer_extension_seconds: number;
  bonus_points_rate: number;
}

export interface SettingMetadata {
  key: KnownSettingKey;
  label: string;
  description: string;
  unit: string;
  min: number;
  max?: number;
  step: number;
  category: 'auction' | 'timer' | 'wallet';
  isInteger: boolean;
}

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SettingChangeDiff {
  key: string;
  label: string;
  oldValue: number;
  newValue: number;
  unit: string;
}
