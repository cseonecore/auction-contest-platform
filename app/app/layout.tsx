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
    icon: "/bid2build_icon-01.png",
    apple: "/bid2build_icon-01.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
