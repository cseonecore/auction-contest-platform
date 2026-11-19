"use client";

import React from "react";

interface ProjectorTimerProps {
  secondsLeft: number;
  status: string;
  paused: boolean;
  bonusSeconds: number;
}

/**
 * The auditorium clock.
 *
 * The deadline lives in PostgreSQL; this component only renders the
 * remaining time that the backend reports.
 */
export function ProjectorTimer({
  secondsLeft,
  status,
  paused,
  bonusSeconds,
}: ProjectorTimerProps) {
  const minutes = Math.floor(Math.max(0, secondsLeft) / 60);
  const seconds = Math.max(0, secondsLeft) % 60;

  const label = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;

  const urgent = secondsLeft <= 5 && secondsLeft > 0;
  const expired = secondsLeft <= 0;

  return (
    <div
      className={`rounded-3xl border-4 px-10 py-6 text-center ${
        expired
          ? "bg-zinc-900/80 border-zinc-700"
          : urgent
            ? "bg-rose-950/70 border-rose-500/70"
            : "bg-[#fef08a] border-amber-400"
      }`}
    >
      <div className="text-2xl font-black uppercase tracking-[0.3em] text-white/70 mb-2">
        {paused ? "Paused" : expired ? "Bidding Closed" : "Time Remaining"}
      </div>

      <div
        className={`text-[7rem] leading-none font-black font-mono tracking-tight ${
          expired ? "text-zinc-500" : urgent ? "text-rose-200" : "text-[#78350f]"
        }`}
      >
        {label}
      </div>

      <div className="mt-3 text-xl font-bold uppercase tracking-widest text-white/60">
        {status}
        {bonusSeconds > 0 && (
          <span className="ml-4 text-emerald-300">+{bonusSeconds}s bonus awarded</span>
        )}
      </div>
    </div>
  );
}
