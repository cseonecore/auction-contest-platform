import React from "react";
import Image from "next/image";

export interface FigmaHeaderLogosProps {
  className?: string;
}

/**
 * Header logo lockup used on Login and Registration pages:
 * [Bid2Build Wordmark Logo] × [Dev Studio Logo]
 */
export const FigmaHeaderLogos: React.FC<FigmaHeaderLogosProps> = ({
  className = "",
}) => {
  return (
    <div className={`flex items-center justify-center gap-4 mb-5 ${className}`}>
      {/* Bid2Build New Wordmark Logo */}
      <div className="relative flex items-center justify-center">
        <Image
          src="/new_bid2build_logo.png"
          alt="Bid2Build"
          width={144}
          height={48}
          className="object-contain h-10 w-auto"
          priority
        />
      </div>

      {/* Cross delimiter */}
      <span className="text-slate-400 font-light text-xl select-none leading-none">×</span>

      {/* Dev Studio Logo */}
      <div className="relative flex items-center justify-center">
        <Image
          src="/dev_studio.png"
          alt="Dev Studio"
          width={48}
          height={48}
          className="object-contain h-10 w-10 rounded-full"
          priority
        />
      </div>
    </div>
  );
};
