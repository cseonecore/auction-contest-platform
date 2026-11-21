import React from "react";
import Link from "next/link";
import Image from "next/image";

export interface B2BLogoProps {
  /**
   * "dark"  = Actual Bid2Build logo (new_bid2build_logo.png)
   * "light" = Actual Bid2Build logo (new_bid2build_logo.png)
   * "icon"  = Icon-only mark (bid2build_icon-01.png)
   */
  variant?: "dark" | "light" | "icon";
  className?: string;
  /**
   * href: provide a URL to wrap in a Link.
   * Pass null or undefined to render without a link wrapper.
   * Default: undefined (no link).
   */
  href?: string | null;
  height?: number;
  priority?: boolean;
  /**
   * presentational: if true, never renders a Link wrapper — even if href is provided.
   * Use when B2BLogo is already inside an anchor or Next.js Link to avoid nested anchors.
   */
  presentational?: boolean;
}

/**
 * Centralized Bid2Build Brand Logo component.
 * - Avoid wrapping in an external Link when href is set — it handles its own navigation.
 * - Use presentational={true} when this component is nested inside an anchor/Link element.
 */
export const B2BLogo: React.FC<B2BLogoProps> = ({
  variant = "dark",
  className = "",
  href,
  height = 28,
  priority = false,
  presentational = false,
}) => {
  const logoSrc =
    variant === "icon"
      ? "/bid2build_icon-01.png"
      : "/new_bid2build_logo.png";

  // Aspect ratios: wordmark 2169×725 ≈ 2.99 | icon 1:1
  const aspectRatio = variant === "icon" ? 1 : 2169 / 725;
  const imageWidth = Math.round(height * aspectRatio);
  // Slightly enlarge the rendered mark without changing header layout.
  const LOGO_SCALE = 1.03;

  const content = (
    <div className={`inline-flex items-center select-none ${className}`}>
      <Image
        src={logoSrc}
        alt="Bid2Build"
        width={imageWidth}
        height={height}
        className="object-contain w-auto h-auto"
        priority={priority}
        style={{ maxHeight: `${height}px`, transform: `scale(${LOGO_SCALE})` }}
      />
    </div>
  );

  if (presentational || !href) {
    return content;
  }

  return (
    <Link href={href} className="inline-flex items-center focus:outline-hidden">
      {content}
    </Link>
  );
};
