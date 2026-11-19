"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { getMascotSrc } from "../utils/mascot";

export interface SoldResultData {
  slotNumber: number;
  status: "sold" | "skipped";
  topicTitle?: string;
  winnerTeamName?: string;
  winnerTeamId?: string;
  winningBid?: number;
  mascotIndex?: number;
  timestamp?: string;
}

interface AuctionSoldModalProps {
  result: SoldResultData | null;
  onClose: () => void;
  autoDismissMs?: number;
}

export function AuctionSoldModal({
  result,
  onClose,
  autoDismissMs = 8000,
}: AuctionSoldModalProps) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (!result) return;
    setProgress(100);

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingPct = Math.max(0, 100 - (elapsed / autoDismissMs) * 100);
      setProgress(remainingPct);

      if (elapsed >= autoDismissMs) {
        clearInterval(interval);
        onClose();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [result, autoDismissMs, onClose]);

  if (!result) return null;

  const isSold = result.status === "sold";
  const mascotSrc = getMascotSrc(result.winnerTeamId || result.winnerTeamName, result.mascotIndex);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-all animate-in fade-in duration-300 select-none">
      {/* Decorative Confetti Ribbons matching Figma Screenshot Image 2 & 4 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-center justify-center">
        {/* Top-Left Purple Curled Ribbon */}
        <div className="absolute -top-12 left-1/4 sm:left-1/3 w-32 h-44 animate-bounce duration-1000">
          <svg viewBox="0 0 100 140" className="w-full h-full fill-none">
            <path
              d="M30,10 C60,25 70,55 40,75 C10,95 30,125 55,135"
              stroke="#9333ea"
              strokeWidth="14"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M30,10 C60,25 70,55 40,75 C10,95 30,125 55,135"
              stroke="#c084fc"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Bottom-Left Cyan Curled Ribbon */}
        <div className="absolute bottom-10 left-12 sm:left-1/4 w-28 h-36">
          <svg viewBox="0 0 100 120" className="w-full h-full fill-none animate-pulse">
            <path
              d="M20,10 C50,20 60,50 30,70 C10,90 40,110 50,115"
              stroke="#06b6d4"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <path
              d="M20,10 C50,20 60,50 30,70 C10,90 40,110 50,115"
              stroke="#67e8f9"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Top-Right Golden Yellow Curled Ribbon */}
        <div className="absolute -top-10 right-1/4 sm:right-1/3 w-32 h-44">
          <svg viewBox="0 0 100 140" className="w-full h-full fill-none animate-bounce">
            <path
              d="M70,10 C40,25 30,55 60,75 C90,95 70,125 45,135"
              stroke="#eab308"
              strokeWidth="14"
              strokeLinecap="round"
            />
            <path
              d="M70,10 C40,25 30,55 60,75 C90,95 70,125 45,135"
              stroke="#fef08a"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Bottom-Right Magenta Pink Curled Ribbon */}
        <div className="absolute bottom-12 right-12 sm:right-1/4 w-28 h-36">
          <svg viewBox="0 0 100 120" className="w-full h-full fill-none">
            <path
              d="M80,10 C50,25 40,55 70,75 C90,95 60,115 50,120"
              stroke="#ec4899"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <path
              d="M80,10 C50,25 40,55 70,75 C90,95 60,115 50,120"
              stroke="#f472b6"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Sparkles and Confetti Bits */}
        <div className="absolute top-1/4 left-1/4 w-4 h-4 bg-yellow-400 rotate-45 rounded-xs animate-ping" />
        <div className="absolute top-1/3 right-1/4 w-3 h-3 bg-pink-500 rotate-12 rounded-xs" />
        <div className="absolute bottom-1/3 left-1/3 w-3 h-5 bg-cyan-400 -rotate-12 rounded-xs" />
        <div className="absolute bottom-1/4 right-1/3 w-4 h-4 bg-purple-400 rotate-45 rounded-xs" />
        <div className="absolute top-1/2 left-16 w-3 h-3 bg-orange-400 rounded-full" />
        <div className="absolute top-1/2 right-16 w-3 h-3 bg-emerald-400 rounded-full" />
      </div>

      {/* Main Announcement Card matching Figma Screenshot Image 2 & 4 */}
      <div className="relative w-full max-w-sm rounded-[32px] bg-[#1a1b1e] border border-zinc-700/70 p-8 text-center shadow-2xl z-10 transition-transform scale-100 animate-in zoom-in-95 duration-200">
        {/* Title */}
        <h2 className="text-2xl sm:text-3xl font-black text-white tracking-wider uppercase mb-6 drop-shadow-sm">
          {isSold ? "SOLD TO" : "UNSOLD"}
        </h2>

        {/* Medal / Emblem Graphic */}
        <div className="my-6 flex justify-center items-center">
          {isSold ? (
            <div className="relative flex flex-col items-center">
              {/* Gold Medal SVG with shiny bezel and red ribbon tails */}
              <svg
                width="140"
                height="150"
                viewBox="0 0 140 150"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="drop-shadow-xl"
              >
                {/* Red Ribbon Tails Hanging Down */}
                <path
                  d="M48 68 L24 135 L44 125 L58 135 L62 76 Z"
                  fill="#dc2626"
                />
                <path
                  d="M92 68 L116 135 L96 125 L82 135 L78 76 Z"
                  fill="#b91c1c"
                />
                <path
                  d="M44 125 L24 135 L38 90 Z"
                  fill="#ef4444"
                  opacity="0.6"
                />

                {/* Outer Medal Drop Shadow / Bezel */}
                <circle cx="70" cy="56" r="46" fill="#ca8a04" />
                <circle cx="70" cy="56" r="42" fill="#eab308" />

                {/* Inner Bevel */}
                <circle cx="70" cy="56" r="38" fill="#facc15" />
                <circle
                  cx="70"
                  cy="56"
                  r="34"
                  fill="#eab308"
                  stroke="#fef08a"
                  strokeWidth="2"
                />

                {/* Star / Crest Emblem inside Medal */}
                <path
                  d="M70 38 L74 48 L85 49 L76 56 L79 67 L70 61 L61 67 L64 56 L55 49 L66 48 Z"
                  fill="#fef08a"
                  opacity="0.95"
                />

                {/* Medal Highlights */}
                <path
                  d="M46 38 C53 30 63 26 74 26 C85 26 95 30 102 38"
                  stroke="#ffffff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity="0.6"
                />
              </svg>
            </div>
          ) : (
            <div className="w-28 h-28 rounded-full bg-zinc-800/80 border-2 border-zinc-600 flex items-center justify-center text-zinc-400">
              <svg className="w-14 h-14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          )}
        </div>

        {/* Winner Capsule (Exact Match to Figma Image 2 & 4) */}
        {isSold ? (
          <div className="mt-6 flex justify-center">
            <div className="bg-[#15803d] hover:bg-[#166534] transition-colors rounded-full py-2.5 px-6 flex items-center gap-3.5 shadow-lg border border-emerald-400/30 min-w-[210px] justify-start">
              {/* Mascot Avatar */}
              <div className="w-12 h-12 rounded-full bg-white/20 p-1 flex items-center justify-center shrink-0 overflow-hidden border border-white/40">
                <Image
                  src={mascotSrc}
                  alt={result.winnerTeamName || "Winning Team"}
                  width={44}
                  height={44}
                  className="object-contain"
                />
              </div>

              {/* Team Name and Winning Bid */}
              <div className="text-left leading-tight">
                <div className="text-xs font-semibold text-white/90 truncate max-w-[130px]">
                  {result.winnerTeamName || "Team Alpha"}
                </div>
                <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {result.winningBid ?? 60}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <div className="inline-block px-4 py-2 rounded-full bg-zinc-800 text-zinc-300 text-sm font-semibold border border-zinc-700">
              No Qualifying Bids
            </div>
            <p className="text-xs text-zinc-400 mt-2">
              This problem statement was skipped and will remain unassigned.
            </p>
          </div>
        )}

        {/* Problem Title Subtext */}
        {result.topicTitle && (
          <p className="text-xs text-zinc-400 font-medium mt-6 truncate">
            Problem: <span className="text-zinc-200 font-semibold">{result.topicTitle}</span>
          </p>
        )}

        {/* Auto Dismiss Progress Bar */}
        <div className="mt-6 w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-75 ${
              isSold ? "bg-emerald-500" : "bg-amber-500"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          type="button"
          className="mt-4 text-xs text-zinc-400 hover:text-zinc-200 underline cursor-pointer transition-colors"
        >
          Dismiss announcement
        </button>
      </div>
    </div>
  );
}
