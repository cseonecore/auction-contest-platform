import React from "react";
import Image from "next/image";

export const FigmaHeaderLogos: React.FC<{ className?: string }> = ({
  className = "",
}) => {
  return (
    <div className={`flex items-center justify-center gap-3.5 mb-5 ${className}`}>
      {/* Red Brackets in White Rounded Squircle (Bid2Build) */}
      <div className="w-14 h-14 bg-white rounded-2xl shadow-xs border border-slate-200/90 flex items-center justify-center">
        <span className="text-red-500 font-black text-2xl font-mono leading-none tracking-tighter">
          [ ]
        </span>
      </div>

      {/* Cross delimiter */}
      <span className="text-slate-400 font-light text-lg select-none">×</span>

      {/* Official Dev Studio Circular Emblem (Bid2Build X Dev Studio) */}
      <div className="w-14 h-14 rounded-full relative overflow-hidden shadow-md shadow-slate-900/10 border border-slate-200/60 bg-black">
        <Image
          src="/logos/dev-studio-logo.png"
          alt="Dev Studio Logo"
          fill
          sizes="56px"
          className="object-contain"
          priority
        />
      </div>
    </div>
  );
};
