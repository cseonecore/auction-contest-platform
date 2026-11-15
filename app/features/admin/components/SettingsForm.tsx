'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  fetchAllSettings,
  updateSetting,
  extractNumericValue,
  preserveJsonStructure,
  SETTINGS_METADATA,
} from '../services/settingsService';
import {
  KnownSettingKey,
  SettingRecord,
  SettingsFormValues,
  SettingChangeDiff,
} from '../types/settings';
import { SettingField } from './SettingsCard';
import { ConfirmModal } from './ConfirmModal';

const DEFAULT_FORM_VALUES: SettingsFormValues = {
  min_bid: 10,
  min_raise: 10,
  opening_window_seconds: 10,
  timer_extension_seconds: 5,
  starting_wallet_balance: 1000,
  bonus_points_rate: 0.1,
};

export function SettingsForm() {
  const [dbRecords, setDbRecords] = useState<Record<string, unknown>>({});
  const [formValues, setFormValues] = useState<SettingsFormValues>(DEFAULT_FORM_VALUES);
  const [errors, setErrors] = useState<Partial<Record<KnownSettingKey, string>>>({});

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const reloadSettings = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    setSaveSuccess(null);
    setSaveError(null);

    const result = await fetchAllSettings();
    if (!result.success) {
      setFetchError(result.error || 'Failed to fetch settings from Supabase');
      setIsLoading(false);
      return;
    }

    const records: Record<string, unknown> = {};
    const parsedValues = { ...DEFAULT_FORM_VALUES };

    result.data?.forEach((item: SettingRecord) => {
      records[item.key] = item.value;
      if (item.key in parsedValues) {
        const key = item.key as KnownSettingKey;
        parsedValues[key] = extractNumericValue(item.value, DEFAULT_FORM_VALUES[key]);
      }
    });

    setDbRecords(records);
    setFormValues(parsedValues);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function initSettings() {
      const result = await fetchAllSettings();
      if (!isMounted) return;

      if (!result.success) {
        setFetchError(result.error || 'Failed to fetch settings from Supabase');
        setIsLoading(false);
        return;
      }

      const records: Record<string, unknown> = {};
      const parsedValues = { ...DEFAULT_FORM_VALUES };

      result.data?.forEach((item: SettingRecord) => {
        records[item.key] = item.value;
        if (item.key in parsedValues) {
          const key = item.key as KnownSettingKey;
          parsedValues[key] = extractNumericValue(item.value, DEFAULT_FORM_VALUES[key]);
        }
      });

      setDbRecords(records);
      setFormValues(parsedValues);
      setIsLoading(false);
    }

    void initSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  const validateField = (key: KnownSettingKey, value: number): string | undefined => {
    const meta = SETTINGS_METADATA[key];
    if (Number.isNaN(value) || value === undefined) {
      return 'Value is required and must be a number';
    }
    if (meta.min !== undefined && value < meta.min) {
      return `Minimum allowed value is ${meta.min} ${meta.unit}`;
    }
    if (meta.max !== undefined && value > meta.max) {
      return `Maximum allowed value is ${meta.max} ${meta.unit}`;
    }
    if (meta.isInteger && !Number.isInteger(value)) {
      return 'Value must be a whole integer';
    }
    return undefined;
  };

  const handleFieldChange = (key: KnownSettingKey, val: number) => {
    setFormValues((prev) => ({ ...prev, [key]: val }));
    const err = validateField(key, val);
    setErrors((prev) => ({ ...prev, [key]: err }));
    setSaveSuccess(null);
    setSaveError(null);
  };

  // Compute which settings have been modified
  const changes = useMemo<SettingChangeDiff[]>(() => {
    const diffs: SettingChangeDiff[] = [];
    (Object.keys(SETTINGS_METADATA) as KnownSettingKey[]).forEach((key) => {
      const meta = SETTINGS_METADATA[key];
      const originalNum = extractNumericValue(dbRecords[key], DEFAULT_FORM_VALUES[key]);
      const currentVal = formValues[key];
      if (originalNum !== currentVal && !Number.isNaN(currentVal)) {
        diffs.push({
          key,
          label: meta.label,
          oldValue: originalNum,
          newValue: currentVal,
          unit: meta.unit,
        });
      }
    });
    return diffs;
  }, [dbRecords, formValues]);

  const hasValidationErrors = Object.values(errors).some((err) => !!err);

  const handleInitiateSave = () => {
    if (changes.length === 0 || hasValidationErrors) return;
    setShowConfirmModal(true);
  };

  const handleConfirmSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    const failedKeys: string[] = [];
    const updatedRecords: Record<string, unknown> = { ...dbRecords };

    for (const change of changes) {
      const key = change.key as KnownSettingKey;
      const originalRaw = dbRecords[key];
      const newNumeric = formValues[key];
      const valueToSave = preserveJsonStructure(originalRaw, newNumeric);

      const result = await updateSetting(key, valueToSave);
      if (!result.success) {
        failedKeys.push(`${change.label} (${result.error})`);
      } else {
        updatedRecords[key] = valueToSave;
      }
    }

    setIsSaving(false);
    setShowConfirmModal(false);

    if (failedKeys.length > 0) {
      setSaveError(`Failed to update some settings: ${failedKeys.join(', ')}`);
      // Reload from DB to keep UI synchronized
      await reloadSettings();
    } else {
      setDbRecords(updatedRecords);
      setSaveSuccess(`Successfully updated ${changes.length} setting(s) in Supabase.`);
    }
  };

  const handleReset = () => {
    const parsedValues = { ...DEFAULT_FORM_VALUES };
    (Object.keys(SETTINGS_METADATA) as KnownSettingKey[]).forEach((key) => {
      if (key in dbRecords) {
        parsedValues[key] = extractNumericValue(dbRecords[key], DEFAULT_FORM_VALUES[key]);
      }
    });
    setFormValues(parsedValues);
    setErrors({});
    setSaveSuccess(null);
    setSaveError(null);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-3">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading settings from Supabase...</p>
      </div>
    );
  }

  const auctionSettings: KnownSettingKey[] = ['min_bid', 'min_raise'];
  const timerSettings: KnownSettingKey[] = ['opening_window_seconds', 'timer_extension_seconds'];
  const walletSettings: KnownSettingKey[] = ['starting_wallet_balance', 'bonus_points_rate'];

  return (
    <div className="space-y-8">
      {/* Notifications */}
      {fetchError && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl text-xs text-red-800 dark:text-red-300 flex items-start justify-between">
          <div>
            <strong className="font-bold">Error Fetching Settings:</strong> {fetchError}
          </div>
          <button
            type="button"
            onClick={reloadSettings}
            className="text-xs underline hover:text-red-900 ml-4 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {saveSuccess && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span>{saveSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold"
          >
            &times;
          </button>
        </div>
      )}

      {saveError && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl text-xs text-red-800 dark:text-red-300 flex items-center justify-between">
          <div>
            <strong className="font-bold">Save Error:</strong> {saveError}
          </div>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-red-700 hover:text-red-900 font-bold"
          >
            &times;
          </button>
        </div>
      )}

      {/* Action Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            Contest Settings Dashboard
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Manage global parameters stored in <code className="font-mono text-zinc-700 dark:text-zinc-300">public.settings</code>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={changes.length === 0 || isSaving}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            Reset Form
          </button>
          <button
            type="button"
            onClick={handleInitiateSave}
            disabled={changes.length === 0 || hasValidationErrors || isSaving}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors disabled:opacity-40 flex items-center gap-1.5"
          >
            {isSaving ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Changes ({changes.length})</span>
            )}
          </button>
        </div>
      </div>

      {/* Section 1: Live Auction Bidding Rules */}
      <section className="space-y-3">
        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-2">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
            1. Live Auction Bidding Rules
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Governs minimum opening bids and incremental raises during slot bidding.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {auctionSettings.map((key) => (
            <SettingField
              key={key}
              metadata={SETTINGS_METADATA[key]}
              value={formValues[key]}
              originalRawValue={dbRecords[key]}
              onChange={handleFieldChange}
              error={errors[key]}
              isSaving={isSaving}
            />
          ))}
        </div>
      </section>

      {/* Section 2: Auction Timer Durations */}
      <section className="space-y-3">
        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-2">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
            2. Auction Timers &amp; Extensions
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Controls countdown clocks when slots open and extensions triggered by late bids.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {timerSettings.map((key) => (
            <SettingField
              key={key}
              metadata={SETTINGS_METADATA[key]}
              value={formValues[key]}
              originalRawValue={dbRecords[key]}
              onChange={handleFieldChange}
              error={errors[key]}
              isSaving={isSaving}
            />
          ))}
        </div>
      </section>

      {/* Section 3: Team Wallets & Contest Scoring */}
      <section className="space-y-3">
        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-2">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
            3. Wallets &amp; Contest Scoring
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Determines initial team coin allowances and the conversion rate for remaining coins.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {walletSettings.map((key) => (
            <SettingField
              key={key}
              metadata={SETTINGS_METADATA[key]}
              value={formValues[key]}
              originalRawValue={dbRecords[key]}
              onChange={handleFieldChange}
              error={errors[key]}
              isSaving={isSaving}
            />
          ))}
        </div>
      </section>

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={handleConfirmSave}
        isSaving={isSaving}
        changes={changes}
      />
    </div>
  );
}
