import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Bid2Build — Auction Contest Platform",
    template: "%s | Bid2Build",
  },
  description:
    "Web-based App Development Auction Contest platform for team registration, live bidding, submissions, and AI evaluation.",
  icons: {
    icon: "/new_bid2build_logo.png",
    apple: "/new_bid2build_logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased dark" suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
