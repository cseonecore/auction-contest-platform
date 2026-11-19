"use client";

import React from "react";
import type { AuctionItem } from "@/features/auction/types/auction.types";

interface CurrentQuestionDisplayProps {
  item: AuctionItem | null;
}

/** The problem statement currently on the block. */
export function CurrentQuestionDisplay({ item }: CurrentQuestionDisplayProps) {
  if (!item || !item.topic) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-[#1a1b1f] p-10 text-center">
        <p className="text-3xl font-black text-zinc-500">
          Waiting for the next problem statement
        </p>
        <p className="mt-3 text-lg text-zinc-600">
          The organiser has not published a question yet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-zinc-800 bg-[#1a1b1f] p-10">
      <div className="flex items-start justify-between gap-8">
        <div>
          <span className="text-2xl font-black uppercase tracking-[0.25em] text-[#fe5102]">
            Problem Statement {item.question_number != null ? String(item.question_number).padStart(2, "0") : ""}
          </span>
          <h1 className="mt-3 text-6xl font-black text-white leading-tight tracking-tight">
            {item.topic.title}
          </h1>
        </div>

        <span className="shrink-0 rounded-full bg-[#bfdbfe] text-[#1e40af] text-3xl font-black px-8 py-3">
          Round {item.round}
        </span>
      </div>

      {item.topic.description && (
        <p className="mt-6 text-2xl leading-relaxed text-zinc-300 max-w-5xl">
          {item.topic.description}
        </p>
      )}

      {item.topic.criterion != null && (
        <div className="mt-6 border-t border-zinc-800 pt-4 text-lg text-zinc-400">
          <span className="font-bold text-zinc-200">Evaluation Criteria: </span>
          {typeof item.topic.criterion === "object"
            ? JSON.stringify(item.topic.criterion)
            : String(item.topic.criterion)}
        </div>
      )}
    </div>
  );
}
