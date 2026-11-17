import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { RulesOverview } from "@/components/landing/RulesOverview";
import { EvaluationCriteria } from "@/components/landing/EvaluationCriteria";
import { AboutSection } from "@/components/landing/AboutSection";
import { StatsSection } from "@/components/landing/StatsSection";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { Footer } from "@/components/landing/Footer";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { HeroSection } from "@/components/landing/HeroSection";

export const metadata = {
  title: "Bid2Build — Web Development Auction Contest",
  description:
    "Web-based App Development Auction Contest platform for team registration, live bidding, submissions, and AI evaluation. Organized by MITE 5CSE1 × Dev Studio.",
  openGraph: {
    title: "Bid2Build — Web Development Auction Contest",
    description:
      "Web-based App Development Auction Contest platform for team registration, live bidding, submissions, and AI evaluation.",
    images: [
      {
        url: "/new_bid2build_logo.png",
        alt: "Bid2Build Logo",
      },
    ],
  },
  icons: {
    icon: "/bid2build_icon-01.png",
    apple: "/bid2build_icon-01.png",
  },
};

export default function Home() {
  return (
    <main className="flex flex-col min-h-screen">
      <LandingHeader />
      <HeroSection />
      <AboutSection />
      <StatsSection />
      <HowItWorks />
      <RulesOverview />
      <EvaluationCriteria />
      <FaqAccordion />
      <FinalCTA />
      <Footer />
    </main>
  );
}
