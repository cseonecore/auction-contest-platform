import React from "react";
import Link from "next/link";
import Image from "next/image";

export interface B2BLogoProps {
  /**
   * "dark" = Dark text for light backgrounds (default)
   * "light" = White text for dark backgrounds
   * "icon" = Squircle logo mark icon only
   */
  variant?: "dark" | "light" | "icon";
  className?: string;
  href?: string | null;
  height?: number;
  priority?: boolean;
}

/**
 * Centralized Bid2Build Brand Logo component.
 * Uses new_bid2build_logo.png (wordmark, 2169×725) for all variants.
 * - "dark"  → used on light backgrounds — rendered as-is
 * - "light" → used on dark backgrounds — CSS brightness invert so it appears white
 * - "icon"  → same as dark, smaller square-ish crop
 */
export const B2BLogo: React.FC<B2BLogoProps> = ({
  variant = "dark",
  className = "",
  href = "/",
  height = 28,
  priority = false,
}) => {
  const logoSrc = "/new_bid2build_logo.png";

  // The logo wordmark is 2169 × 725 → aspect ≈ 2.99
  const imageAspectWidth = Math.round(height * (2169 / 725));

  // On dark backgrounds invert colors so dark logo becomes white
  const filterClass = variant === "light" ? "brightness-0 invert" : "";

  const content = (
    <div className={`inline-flex items-center select-none ${className}`}>
      <Image
        src={logoSrc}
        alt="Bid2Build"
        width={imageAspectWidth}
        height={height}
        className={`object-contain w-auto h-auto ${filterClass}`}
        priority={priority}
      />
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex items-center focus:outline-hidden">
        {content}
      </Link>
    );
  }

  return content;
};
