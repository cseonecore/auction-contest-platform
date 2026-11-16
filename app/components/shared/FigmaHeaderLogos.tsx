import React from "react";
import Image from "next/image";

export interface FigmaHeaderLogosProps {
  className?: string;
}

/**
 * Header logo lockup used on Login and Registration pages matching Figma references:
 * [Bid2Build Squircle Icon] × [CSEONECORE Emblem]
 */
export const FigmaHeaderLogos: React.FC<FigmaHeaderLogosProps> = ({
  className = "",
}) => {
  return (
    <div className={`flex items-center justify-center gap-3.5 mb-5 ${className}`}>
      {/* Bid2Build Squircle Icon Asset */}
      <div className="w-12 h-12 relative flex items-center justify-center rounded-2xl overflow-hidden shadow-xs border border-slate-200/60 bg-white">
        <Image
          src="/bid2build_icon-01.png"
          alt="Bid2Build Icon"
          width={48}
          height={48}
          className="object-contain"
          priority
        />
      </div>

      {/* Cross delimiter */}
      <span className="text-slate-400 font-light text-lg select-none">×</span>

      {/* CSEONECORE Circular Emblem */}
      <div className="w-12 h-12 rounded-full bg-linear-to-tr from-black via-zinc-900 to-amber-950 border border-amber-600/50 shadow-xs flex flex-col items-center justify-center relative select-none">
        <span className="text-amber-400 text-sm font-black leading-none tracking-tight">
          ∞
        </span>
        <span className="text-[9px] font-black uppercase tracking-wider text-amber-400 font-sans -mt-0.5">
          CORE
        </span>
      </div>
    </div>
  );
};
