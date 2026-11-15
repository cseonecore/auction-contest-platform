'use client';

import { useState } from 'react';
import { KnownSettingKey, SettingMetadata } from '../types/settings';
import { detectValueStructure } from '../services/settingsService';

interface SettingFieldProps {
  metadata: SettingMetadata;
  value: number;
  originalRawValue: unknown;
  onChange: (key: KnownSettingKey, val: number) => void;
  error?: string;
  isSaving: boolean;
}

export function SettingField({
  metadata,
  value,
  originalRawValue,
  onChange,
  error,
  isSaving,
}: SettingFieldProps) {
  const [showJsonInspector, setShowJsonInspector] = useState(false);
  const structure = detectValueStructure(originalRawValue);

  return (
    <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <label
              htmlFor={`setting-${metadata.key}`}
              className="text-sm font-bold text-zinc-900 dark:text-zinc-100"
            >
              {metadata.label}
            </label>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
              {metadata.key}
            </span>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-lg">
            {metadata.description}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="relative flex items-center">
            <input
              id={`setting-${metadata.key}`}
              type="number"
              min={metadata.min}
              max={metadata.max}
              step={metadata.step}
              value={Number.isNaN(value) ? '' : value}
              disabled={isSaving}
              onChange={(e) => {
                const num = parseFloat(e.target.value);
                onChange(metadata.key, num);
              }}
              className={`w-32 px-3 py-1.5 text-right font-mono text-sm font-semibold rounded-lg border bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 ${
                error
                  ? 'border-red-500 focus:ring-red-500/20'
                  : 'border-zinc-300 dark:border-zinc-700 focus:ring-blue-500'
              }`}
            />
            <span className="ml-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 min-w-16">
              {metadata.unit}
            </span>
          </div>
          {error && <span className="text-[11px] text-red-500 font-medium">{error}</span>}
        </div>
      </div>

      {/* Special Inspector for JSON structures (e.g. bonus_points_rate or complex JSONB) */}
      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-zinc-500">
          <span>Type:</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium">
            JSONB {structure.type}
          </span>
          {structure.type === 'object' && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              (Structure preserved on save)
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowJsonInspector(!showJsonInspector)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          <span>{showJsonInspector ? 'Hide DB JSON' : 'Inspect DB JSON'}</span>
        </button>
      </div>

      {showJsonInspector && (
        <div className="mt-2 p-3 bg-zinc-950 text-emerald-400 font-mono text-xs rounded-lg overflow-x-auto border border-zinc-800">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-sans">
            Database Record (`public.settings`)
          </div>
          <pre>{structure.rawJson}</pre>
        </div>
      )}
    </div>
  );
}
