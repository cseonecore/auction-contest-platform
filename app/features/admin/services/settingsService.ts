import { supabase } from '@/lib/supabase';
import {
  SettingRecord,
  ServiceResult,
  KnownSettingKey,
  SettingMetadata,
} from '../types/settings';

/**
 * Metadata definitions for the 6 core contest settings.
 */
export const SETTINGS_METADATA: Record<KnownSettingKey, SettingMetadata> = {
  min_bid: {
    key: 'min_bid',
    label: 'Minimum Opening Bid',
    description: 'The minimum amount required for the initial bid on an auction slot.',
    unit: 'coins',
    min: 1,
    step: 1,
    category: 'auction',
    isInteger: true,
  },
  min_raise: {
    key: 'min_raise',
    label: 'Minimum Raise Increment',
    description: 'The minimum amount by which any subsequent bid must exceed the current highest bid.',
    unit: 'coins',
    min: 1,
    step: 1,
    category: 'auction',
    isInteger: true,
  },
  opening_window_seconds: {
    key: 'opening_window_seconds',
    label: 'Opening Window Duration',
    description: 'The initial countdown timer length when an auction slot is first opened for bidding.',
    unit: 'seconds',
    min: 5,
    max: 600,
    step: 1,
    category: 'timer',
    isInteger: true,
  },
  timer_extension_seconds: {
    key: 'timer_extension_seconds',
    label: 'Timer Extension Duration',
    description: 'Additional seconds added to the active auction timer when extended by admin or late bid.',
    unit: 'seconds',
    min: 1,
    max: 300,
    step: 1,
    category: 'timer',
    isInteger: true,
  },
  starting_wallet_balance: {
    key: 'starting_wallet_balance',
    label: 'Starting Wallet Balance',
    description: 'The initial virtual bidding budget allocated to each participating team per round.',
    unit: 'coins',
    min: 0,
    step: 10,
    category: 'wallet',
    isInteger: true,
  },
  bonus_points_rate: {
    key: 'bonus_points_rate',
    label: 'Bonus Points Conversion Rate',
    description: 'Multiplier used to convert leftover wallet balance into leaderboard contest points.',
    unit: 'points/coin',
    min: 0,
    step: 0.01,
    category: 'wallet',
    isInteger: false,
  },
};

/**
 * Extracts a numeric value from a jsonb setting value.
 * Correctly handles:
 * - Direct numbers: 50 -> 50
 * - String numbers: "50" -> 50
 * - Objects with numeric attributes: { rate: 0.1 }, { value: 50 }, { multiplier: 0.1 }, etc.
 */
export function extractNumericValue(val: unknown, fallback: number = 0): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : fallback;
  }
  if (typeof val === 'string') {
    const parsed = parseFloat(val);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    const candidateKeys = ['rate', 'value', 'amount', 'multiplier', 'seconds', 'balance', 'points'];
    for (const k of candidateKeys) {
      if (k in obj && typeof obj[k] === 'number') {
        return obj[k] as number;
      }
      if (k in obj && typeof obj[k] === 'string') {
        const parsed = parseFloat(obj[k] as string);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    // Fallback: look for the first numeric property
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'number') {
        return obj[key] as number;
      }
      if (typeof obj[key] === 'string') {
        const parsed = parseFloat(obj[key] as string);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return fallback;
}

/**
 * Inspects a setting value to detect its underlying JSON structure.
 */
export function detectValueStructure(val: unknown): {
  type: 'number' | 'object' | 'string' | 'unknown';
  keys?: string[];
  rawJson: string;
} {
  const rawJson = JSON.stringify(val, null, 2);
  if (typeof val === 'number') {
    return { type: 'number', rawJson };
  }
  if (typeof val === 'string') {
    return { type: 'string', rawJson };
  }
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    return {
      type: 'object',
      keys: Object.keys(val),
      rawJson,
    };
  }
  return { type: 'unknown', rawJson };
}

/**
 * Preserves existing JSONB structure when saving an updated numeric value.
 * If original was { rate: 0.1, label: "x" }, returns { rate: newNumber, label: "x" }.
 * If original was a raw number, returns newNumber directly.
 */
export function preserveJsonStructure(originalValue: unknown, newNumber: number): unknown {
  if (typeof originalValue === 'object' && originalValue !== null && !Array.isArray(originalValue)) {
    const obj = { ...(originalValue as Record<string, unknown>) };
    const candidateKeys = ['rate', 'value', 'amount', 'multiplier', 'seconds', 'balance', 'points'];

    let targetKey: string | null = null;
    for (const k of candidateKeys) {
      if (k in obj && (typeof obj[k] === 'number' || typeof obj[k] === 'string')) {
        targetKey = k;
        break;
      }
    }

    if (!targetKey) {
      for (const k of Object.keys(obj)) {
        if (typeof obj[k] === 'number') {
          targetKey = k;
          break;
        }
      }
    }

    if (targetKey) {
      obj[targetKey] = newNumber;
      return obj;
    }

    // Default object field if none existed
    obj['value'] = newNumber;
    return obj;
  }

  // Primitive number
  return newNumber;
}

/**
 * Fetch all settings from Supabase.
 * Respects RLS (requires authenticated Admin user).
 */
export async function fetchAllSettings(): Promise<ServiceResult<SettingRecord[]>> {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .order('key');

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to fetch settings from database',
      };
    }

    return {
      success: true,
      data: (data as SettingRecord[]) || [],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error while fetching settings';
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Fetch a single setting by key.
 */
export async function fetchSettingByKey(key: string): Promise<ServiceResult<SettingRecord>> {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .eq('key', key)
      .maybeSingle();

    if (error) {
      return {
        success: false,
        error: error.message || `Failed to fetch setting "${key}"`,
      };
    }

    if (!data) {
      return {
        success: false,
        error: `Setting "${key}" was not found in the database`,
      };
    }

    return {
      success: true,
      data: data as SettingRecord,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : `Unknown error while fetching setting "${key}"`;
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Update an existing setting in public.settings.
 * Fails if user is unauthorized by RLS.
 */
export async function updateSetting(key: string, value: unknown): Promise<ServiceResult<SettingRecord>> {
  try {
    const { data, error } = await supabase
      .from('settings')
      .update({ value })
      .eq('key', key)
      .select('key, value')
      .single();

    if (error) {
      return {
        success: false,
        error: error.message || `Failed to update setting "${key}"`,
      };
    }

    return {
      success: true,
      data: data as SettingRecord,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : `Unknown error while updating setting "${key}"`;
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Insert a new setting only when explicitly required.
 */
export async function insertSetting(key: string, value: unknown): Promise<ServiceResult<SettingRecord>> {
  try {
    const { data, error } = await supabase
      .from('settings')
      .insert({ key, value })
      .select('key, value')
      .single();

    if (error) {
      return {
        success: false,
        error: error.message || `Failed to insert setting "${key}"`,
      };
    }

    return {
      success: true,
      data: data as SettingRecord,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : `Unknown error while inserting setting "${key}"`;
    return {
      success: false,
      error: msg,
    };
  }
}
