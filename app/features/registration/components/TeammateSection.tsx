import React from "react";
import { Teammate } from "../types";
import { FormField } from "./FormField";

interface TeammateSectionProps {
  teammates: Teammate[];
  errors: Record<number, { name?: string; usn?: string }>;
  onUpdateTeammate: (id: number, field: "name" | "usn", value: string) => void;
}

export const TeammateSection: React.FC<TeammateSectionProps> = ({
  teammates,
  errors,
  onUpdateTeammate,
}) => {
  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex items-center gap-2 pb-1 border-b border-slate-100 dark:border-zinc-800">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-semibold text-xs">
          D
        </span>
        <h3 className="text-base font-semibold text-slate-800 dark:text-zinc-100">
          Teammate Information
        </h3>
        <span className="text-xs text-slate-400 dark:text-slate-500 font-normal ml-auto">
          {teammates.length} {teammates.length === 1 ? "Member" : "Members"} to specify
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {teammates.map((teammate) => {
          const teammateError = errors[teammate.id] || {};
          return (
            <div
              key={teammate.id}
              className="p-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/40 transition-all duration-200"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-zinc-200">
                    Teammate {teammate.id}
                  </h4>
                </div>
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-200/70 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                  Member #{teammate.id}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <FormField
                  id={`teammate-${teammate.id}-name`}
                  label="Full Name"
                  required
                  placeholder="e.g. John Doe"
                  value={teammate.name}
                  error={teammateError.name}
                  onChange={(e) =>
                    onUpdateTeammate(teammate.id, "name", e.target.value)
                  }
                />
                <FormField
                  id={`teammate-${teammate.id}-usn`}
                  label="USN"
                  required
                  placeholder="e.g. 1MS21CS045"
                  value={teammate.usn}
                  error={teammateError.usn}
                  onChange={(e) =>
                    onUpdateTeammate(
                      teammate.id,
                      "usn",
                      e.target.value.toUpperCase()
                    )
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
