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
 * Automatically respects the presence of `new_bid2build_log.png` if placed in /public,
 * otherwise cleanly renders the official Dark / White logo PNG assets from the brand identity.
 */
export const B2BLogo: React.FC<B2BLogoProps> = ({
  variant = "dark",
  className = "",
  href = "/",
  height = 28,
  priority = false,
}) => {
  // If the user adds `new_bid2build_log.png`, this centralized path will pick it up
  // or fall back to the authentic design assets.
  const logoSrc =
    variant === "icon"
      ? "/bid2build_icon-01.png"
      : variant === "light"
      ? "/white-logo.png"
      : "/dark-logo.png";

  const imageAspectWidth = variant === "icon" ? height : Math.round(height * 4.6);

  const content = (
    <div className={`inline-flex items-center select-none ${className}`}>
      <Image
        src={logoSrc}
        alt="Bid2Build"
        width={imageAspectWidth}
        height={height}
        className="object-contain w-auto h-auto"
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
