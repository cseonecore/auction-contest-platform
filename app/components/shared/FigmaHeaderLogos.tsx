import React from "react";

export const FigmaHeaderLogos: React.FC<{ className?: string }> = ({
  className = "",
}) => {
  return (
    <div className={`flex items-center justify-center gap-3.5 mb-5 ${className}`}>
      {/* Red Brackets in White Rounded Squircle */}
      <div className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-slate-200/80 flex items-center justify-center">
        <span className="text-red-500 font-black text-2xl font-mono leading-none tracking-tighter">
          [ ]
        </span>
      </div>

      {/* Cross delimiter */}
      <span className="text-slate-400 font-light text-base select-none">×</span>

      {/* CORE Glowing Emblem */}
      <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-black via-zinc-900 to-amber-950 border border-amber-600/40 shadow-md shadow-amber-950/20 flex flex-col items-center justify-center relative overflow-hidden">
        {/* Swirl glow effect */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-amber-500/20 via-transparent to-transparent"></div>
        <div className="flex items-center justify-center text-amber-400 text-sm font-black leading-none tracking-tighter scale-110">
          ∞
        </div>
        <span className="text-[9px] font-black uppercase tracking-wider text-amber-400 font-sans -mt-0.5">
          CORE
        </span>
      </div>
    </div>
  );
};
