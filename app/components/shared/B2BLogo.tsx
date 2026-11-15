import React from "react";
import Link from "next/link";

export const B2BLogo: React.FC<{ className?: string }> = ({ className = "" }) => {
  return (
    <Link href="/" className={`inline-flex items-center gap-1.5 font-bold text-xl tracking-tight select-none ${className}`}>
      <span className="text-red-500 font-extrabold text-2xl font-mono leading-none">[ ]</span>
      <span className="text-slate-900 font-bold text-xl">Bid2Build</span>
    </Link>
  );
};
