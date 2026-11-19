'use client';

/**
 * AddTopicModal Component
 * Bid2Build (Auction Contest Platform) — Feature 3: Add Topic
 *
 * Modal form allowing administrators to add new auction topics without manual database edits:
 *  - Topic title (required, validated against duplicates)
 *  - Topic level: Easy – Round 1 or Hard – Round 2 (required)
 *  - Starting/minimum bid points (required, default: 10 pts)
 *  - Topic description (optional/recommended)
 *  - Evaluation criterion (optional)
 *  - Number of pending slots to generate (default: 1)
 */

import React, { useState } from 'react';
import type { CreateTopicFormValues, AdminSlotWithDetails } from '../../types/auctionAdmin';

interface AddTopicModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (values: CreateTopicFormValues) => Promise<boolean>;
  existingSlots: AdminSlotWithDetails[];
  isExecuting: boolean;
}

export function AddTopicModal({
  isOpen,
  onClose,
  onConfirm,
  existingSlots,
  isExecuting,
}: AddTopicModalProps) {
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState<'easy' | 'hard'>('easy');
  const [startingBid, setStartingBid] = useState('10');
  const [description, setDescription] = useState('');
  const [criterion, setCriterion] = useState('');
  const [slotsCount, setSlotsCount] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage('Topic title is required.');
      return;
    }

    // Check client-side for duplicate title
    const duplicate = existingSlots.some(
      (s) => s.topic?.title?.toLowerCase() === trimmedTitle.toLowerCase()
    );
    if (duplicate) {
      setErrorMessage(`A topic with the title "${trimmedTitle}" already exists.`);
      return;
    }

    const parsedStartingBid = parseInt(startingBid.trim(), 10);
    if (isNaN(parsedStartingBid) || parsedStartingBid <= 0) {
      setErrorMessage('Starting bid points must be a valid positive whole number.');
      return;
    }

    const success = await onConfirm({
      title: trimmedTitle,
      level,
      starting_bid: parsedStartingBid,
      description: description.trim(),
      criterion: criterion.trim() || undefined,
      slots_count: slotsCount,
    });

    if (success) {
      // Reset form
      setTitle('');
      setLevel('easy');
      setStartingBid('10');
      setDescription('');
      setCriterion('');
      setSlotsCount(1);
      setErrorMessage(null);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => {
        if (!isExecuting) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-5 max-h-[92vh] overflow-y-auto animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
              Admin Topic Creator
            </span>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mt-1">
              Add New Auction Topic
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Create a new challenge topic and immediately generate its pending auction slot.
            </p>
          </div>

          <button
            type="button"
            disabled={isExecuting}
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Topic Name */}
          <div className="space-y-1.5">
            <label htmlFor="topicTitleInput" className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">
              Topic Name / Title <span className="text-rose-500">*</span>
            </label>
            <input
              id="topicTitleInput"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setErrorMessage(null);
              }}
              disabled={isExecuting}
              placeholder="e.g. Autonomous Campus Delivery System"
              className="w-full px-3.5 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
          </div>

          {/* Level & Round Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">
              Difficulty Level &amp; Auction Round <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setLevel('easy')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  level === 'easy'
                    ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 ring-2 ring-emerald-500/20'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">Easy — Round 1</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                  Foundation projects for Round 1 bidding.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setLevel('hard')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  level === 'hard'
                    ? 'border-purple-500 bg-purple-50/60 dark:bg-purple-950/30 text-purple-900 dark:text-purple-100 ring-2 ring-purple-500/20'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">Hard — Round 2</span>
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                  Advanced architecture for Round 2 bidding.
                </p>
              </button>
            </div>
          </div>

          {/* Starting Points & Slots Note Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Starting Points */}
            <div className="space-y-1.5">
              <label htmlFor="startingPointsInput" className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">
                Starting / Minimum Bid (pts) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="startingPointsInput"
                  type="number"
                  min={1}
                  step={1}
                  value={startingBid}
                  onChange={(e) => {
                    setStartingBid(e.target.value);
                    setErrorMessage(null);
                  }}
                  disabled={isExecuting}
                  placeholder="10"
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-zinc-400">
                  PTS
                </span>
              </div>
              <p className="text-[10px] text-zinc-500">
                Rule Book base opening bid is 10 points.
              </p>
            </div>

            {/* 1 Slot per Problem Note */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">
                Queue Item Allocation
              </label>
              <div className="px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                <span className="font-semibold">1 Auction Item</span>
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Standard</span>
              </div>
              <p className="text-[10px] text-zinc-500">
                One auction item per problem statement.
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="topicDescInput" className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">
              Topic Description
            </label>
            <textarea
              id="topicDescInput"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isExecuting}
              placeholder="High-level project scope and user problem statement..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
            />
          </div>

          {/* Criterion */}
          <div className="space-y-1.5">
            <label htmlFor="topicCriterionInput" className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">
              Evaluation Criterion &amp; Deliverables
            </label>
            <textarea
              id="topicCriterionInput"
              rows={2}
              value={criterion}
              onChange={(e) => setCriterion(e.target.value)}
              disabled={isExecuting}
              placeholder="Key focus areas, anti-plagiarism checks, evaluation weights..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-[11px]"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              disabled={isExecuting}
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isExecuting}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExecuting && (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              <span>{isExecuting ? 'Creating Topic...' : 'Add Topic to Queue'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
