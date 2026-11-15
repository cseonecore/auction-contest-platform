"use client";

import React, { useEffect, useState, useId } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  X,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  BookOpen,
  Award,
  Send,
  Loader2,
} from "lucide-react";

interface Member {
  id?: string;
  name: string;
  email: string;
  usn: string;
  branch: string;
  semester: string;
  phone: string;
  isCaptain: boolean;
}

interface AssignedProblem {
  id: string;
  number: number;
  title: string;
  statement: string;
  description: string;
}

interface TeamData {
  id: string;
  name: string;
  locked?: boolean;
  balance: number;
  members: Member[];
  assignedProblems: AssignedProblem[];
  isAuctionLive: boolean;
}

export default function ProfilePage() {
  const router = useRouter();

  // Team state
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);

  // Status & Contest State
  const [isLive, setIsLive] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [timeBonus, setTimeBonus] = useState(0);
  const [questionsAnswered, setQuestionsAnswered] = useState(0);

  // Countdown timer state
  const [timeLeft, setTimeLeft] = useState({
    hours: 1,
    minutes: 42,
    seconds: 24,
  });

  // Modal dialog states
  const [showAuctionNotStartedModal, setShowAuctionNotStartedModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showEarnTimeModal, setShowEarnTimeModal] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  // Submit modal inputs
  const [repoUrl, setRepoUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Quiz / Earn time inputs
  const [quizAnswer, setQuizAnswer] = useState("");
  const [quizMessage, setQuizMessage] = useState<string | null>(null);

  // IDs for accessibility
  const repoInputId = useId();
  const liveInputId = useId();

  // Load Team Profile
  useEffect(() => {
    async function loadProfile() {
      try {
        let storedTeamName = "";
        let storedTeamId = "";

        if (typeof window !== "undefined") {
          const raw = localStorage.getItem("b2b_logged_in_team");
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              storedTeamName = parsed.name || "";
              storedTeamId = parsed.id || "";
            } catch {
              // ignore
            }
          }
        }

        // If no team in localStorage, fallback to demo team for preview or redirect
        if (!storedTeamName && !storedTeamId) {
          storedTeamName = "CodeNinjas"; // Default demo team so page is always previewable
        }

        const res = await fetch(
          `/api/team/profile?${storedTeamId ? `id=${storedTeamId}` : `name=${encodeURIComponent(storedTeamName)}`}`
        );
        const data = await res.json();

        if (res.ok && data.team) {
          setTeam(data.team);
          setIsLive(data.team.isAuctionLive || false);
        } else {
          // Fallback mock team matching Figma Image 1 & 2
          setTeam({
            id: storedTeamId || "32254098-4572-472d-b75e-1dc51ebcb273",
            name: storedTeamName || "Team Name",
            balance: 100,
            isAuctionLive: false,
            members: [
              {
                name: "Abhiram Gowda",
                email: "4mt24cs001@mite.ac.in",
                usn: "4MT24CS001",
                branch: "CSE",
                semester: "5",
                phone: "+91 98765 43210",
                isCaptain: true,
              },
              {
                name: "Tarun Kumar",
                email: "4mt24cs002@mite.ac.in",
                usn: "4MT24CS002",
                branch: "CSE",
                semester: "5",
                phone: "+91 98765 43210",
                isCaptain: false,
              },
              {
                name: "Rakshith Rao",
                email: "4mt24cs003@mite.ac.in",
                usn: "4MT24CS003",
                branch: "CSE",
                semester: "5",
                phone: "+91 98765 43210",
                isCaptain: false,
              },
            ],
            assignedProblems: [],
          });
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, []);

  // Countdown timer effect
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev.seconds > 0) {
          return { ...prev, seconds: prev.seconds - 1 };
        } else if (prev.minutes > 0) {
          return { ...prev, minutes: prev.minutes - 1, seconds: 59 };
        } else if (prev.hours > 0) {
          return { hours: prev.hours - 1, minutes: 59, seconds: 59 };
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("b2b_logged_in_team");
    }
    router.push("/login");
  };

  const handleEnterAuction = () => {
    if (!isLive) {
      // Trigger Figma Image 3 Modal: Auction not yet started!
      setShowAuctionNotStartedModal(true);
    } else {
      router.push("/auction");
    }
  };

  const handleEarnTimeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quizAnswer.trim()) return;

    if (quizAnswer.trim().toLowerCase().includes("next") || quizAnswer.trim().toLowerCase().includes("react") || quizAnswer.trim().length > 2) {
      setTimeBonus((prev) => prev + 10);
      setQuestionsAnswered((prev) => prev + 1);
      setQuizMessage("Awesome! You earned +10 minutes bonus time for your team!");
      setTimeout(() => {
        setShowEarnTimeModal(false);
        setQuizMessage(null);
        setQuizAnswer("");
      }, 1500);
    } else {
      setQuizMessage("Try again! Answer must be a valid tech stack or concept.");
    }
  };

  const handleSubmitSolution = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;

    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setIsSubmitted(true);
      setSubmitSuccess(true);
      setTimeout(() => {
        setShowSubmitModal(false);
        setSubmitSuccess(false);
      }, 1500);
    }, 800);
  };

  // Toggle demo states so user can test Image 1 vs Image 2
  const toggleProblemsDemo = () => {
    if (!team) return;
    if (team.assignedProblems.length > 0) {
      setTeam({ ...team, assignedProblems: [] });
    } else {
      setTeam({
        ...team,
        assignedProblems: [
          {
            id: "p1",
            number: 1,
            title: "Problem 1",
            statement: "Campus Life Tech — Lost-and-found portal",
            description: "Build a real-time portal with verification, instant updates, and notification reliability.",
          },
          {
            id: "p2",
            number: 2,
            title: "Problem 2",
            statement: "Canteen Queue & Pre-order System",
            description: "Develop a live order tracking board with inventory management and token status updates.",
          },
        ],
      });
      setTimeBonus(10);
      setQuestionsAnswered(2);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#141518] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#ff5500]" />
          <p className="text-xs text-slate-400">Loading your profile...</p>
        </div>
      </div>
    );
  }

  const currentTeam = team || {
    id: "32254098-4572-472d-b75e-1dc51ebcb273",
    name: "Team Name",
    balance: 100,
    members: [],
    assignedProblems: [],
    isAuctionLive: false,
  };

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="min-h-screen bg-[#141518] text-white selection:bg-orange-500 selection:text-white flex flex-col justify-between p-4 sm:p-8 md:p-12 font-sans select-none">
      <div className="max-w-6xl w-full mx-auto space-y-8">
        {/* ========================================================= */}
        {/* TOP NAVBAR: [ ] Bid2Build | Contest Rules | Log out       */}
        {/* ========================================================= */}
        <header className="flex items-center justify-between pt-2 pb-4">
          {/* Left: Brand Logo */}
          <Link href="/" className="inline-flex items-center gap-2 select-none group">
            <span className="text-red-500 font-extrabold text-2xl font-mono leading-none group-hover:scale-105 transition-transform">
              [ ]
            </span>
            <span className="text-white font-bold text-xl tracking-tight">Bid2Build</span>
          </Link>

          {/* Right: Actions */}
          <div className="flex items-center gap-6 text-sm">
            <button
              type="button"
              onClick={() => setShowRulesModal(true)}
              className="text-white/90 hover:text-white transition-colors cursor-pointer font-medium"
            >
              Contest Rules
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="text-white/90 hover:text-red-400 transition-colors cursor-pointer font-medium"
            >
              Log out
            </button>
          </div>
        </header>

        {/* ========================================================= */}
        {/* SECTION 1: TEAM OVERVIEW & AUCTION STATUS BAR             */}
        {/* ========================================================= */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pt-2">
          {/* LEFT: Team Avatar, Name & 4 Badges */}
          <div className="flex items-center gap-4 sm:gap-5">
            {/* Mascot Avatar in White Circular Frame */}
            <div className="w-18 h-18 sm:w-22 sm:h-22 rounded-full bg-white flex items-center justify-center p-2 shrink-0 border-2 border-slate-700/60 shadow-xl relative overflow-hidden">
              <Image
                src="/characters/Character-01.png"
                alt="Team Character Mascot"
                fill
                sizes="(max-width: 640px) 72px, 88px"
                className="object-contain p-1"
                priority
              />
            </div>

            {/* Team Info & Badges */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {currentTeam.name}
                </h1>
                {/* Blue Verified Checkmark */}
                <span className="w-5 h-5 rounded-full bg-[#38bdf8] text-white flex items-center justify-center text-xs font-bold shadow-xs">
                  ✓
                </span>
              </div>

              {/* 4 Badges (Pills) */}
              <div className="flex flex-wrap items-center gap-2">
                {/* 1. Coin Balance */}
                <span className="bg-[#dcfce7] text-[#15803d] font-semibold text-xs px-3 py-1 rounded-full shadow-2xs">
                  Coin Balance : {currentTeam.balance}
                </span>

                {/* 2. Problem Assigned */}
                <span className="bg-[#ffedd5] text-[#9a3412] font-semibold text-xs px-3 py-1 rounded-full shadow-2xs">
                  Problem Assigned : {currentTeam.assignedProblems.length}
                </span>

                {/* 3. Time Bonus */}
                <span className="bg-[#ffedd5] text-[#9a3412] font-semibold text-xs px-3 py-1 rounded-full shadow-2xs">
                  Time Bonus : {timeBonus > 0 ? `+${timeBonus} min` : "0"}
                </span>

                {/* 4. Questions Answered */}
                <span className="bg-[#e0e7ff] text-[#3730a3] font-semibold text-xs px-3 py-1 rounded-full shadow-2xs">
                  Questions Answered : {questionsAnswered}
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT: Status & Timer Box (Dark card with golden timer) */}
          <div className="bg-[#22242a] rounded-2xl p-4 sm:p-5 border border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 shadow-lg lg:min-w-[420px]">
            {/* Status indicators */}
            <div className="space-y-2.5 text-xs text-white font-medium">
              <div className="flex items-center gap-2.5">
                <span className="text-slate-300">Auction Status</span>
                {isLive ? (
                  <span className="bg-[#dcfce7] text-[#15803d] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
                    <span className="w-2 h-2 rounded-full bg-[#15803d] animate-pulse" />
                    • Live
                  </span>
                ) : (
                  <span className="bg-[#fef9c3] text-[#854d0e] font-bold px-2.5 py-0.5 rounded-full shadow-2xs">
                    Upcoming
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <span className="text-slate-300">Submission Status</span>
                {isSubmitted ? (
                  <span className="bg-[#dcfce7] text-[#15803d] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
                    • Submitted
                  </span>
                ) : (
                  <span className="bg-[#ffe4e6] text-[#be123c] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
                    • Not Submitted
                  </span>
                )}
              </div>
            </div>

            {/* Golden Countdown Timer Card */}
            <div className="bg-[#fef3c7] text-[#78350f] rounded-xl px-5 py-3 text-center w-full sm:w-auto min-w-[160px] shadow-sm">
              <span className="text-[11px] font-medium text-[#92400e] block">
                {isLive ? "Time left to submit" : "Contest Starts in"}
              </span>
              <span className="text-sm sm:text-base font-extrabold tracking-tight text-[#78350f] mt-0.5 block font-mono">
                {isLive
                  ? `${timeLeft.hours}hr : ${pad(timeLeft.minutes)}min : ${pad(timeLeft.seconds)}sec`
                  : `7 : 16 : ${pad(timeLeft.minutes)} : ${pad(timeLeft.seconds)}`}
              </span>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* SECTION 2: TEAM MEMBERS                                   */}
        {/* ========================================================= */}
        <section className="space-y-3 pt-2">
          <h2 className="text-sm font-semibold text-slate-400 tracking-wide">
            Team Members
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentTeam.members.map((member, index) => (
              <div
                key={member.id || index}
                className="bg-[#22242a] rounded-2xl p-5 border border-white/5 space-y-2 shadow-md hover:border-white/10 transition-colors"
              >
                {/* Member Name and Captain Pill */}
                <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-2.5">
                  <h3 className="text-base font-bold text-white tracking-tight">
                    {member.name}
                  </h3>
                  {member.isCaptain && (
                    <span className="bg-[#bbf7d0] text-[#14532d] text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-2xs">
                      Captain
                    </span>
                  )}
                </div>

                {/* Details list */}
                <div className="text-xs space-y-1 text-slate-300 font-normal">
                  <p>
                    <span className="text-slate-400">USN : </span>
                    <span className="font-mono text-white">{member.usn}</span>
                  </p>
                  <p>
                    <span className="text-slate-400">Branch : </span>
                    <span>{member.branch || "CSE"}</span>
                  </p>
                  <p>
                    <span className="text-slate-400">Semester : </span>
                    <span>{member.semester || "5"}</span>
                  </p>
                  <p>
                    <span className="text-slate-400">Phone : </span>
                    <span className="font-mono">{member.phone || "+91 98765 43210"}</span>
                  </p>
                  <p className="truncate">
                    <span className="text-slate-400">Email : </span>
                    <span className="font-mono text-slate-300">{member.email}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ========================================================= */}
        {/* SECTION 3: ASSIGNED PROBLEMS                              */}
        {/* ========================================================= */}
        <section className="space-y-3 pt-2">
          <h2 className="text-sm font-semibold text-slate-400 tracking-wide">
            Assigned Problems
          </h2>

          {currentTeam.assignedProblems.length === 0 ? (
            /* STATE A: No Problems Selected (Image 2) */
            <div className="bg-[#22242a] rounded-2xl p-6 border border-white/5 max-w-md shadow-md space-y-1.5">
              <h3 className="text-base font-bold text-white tracking-tight">
                No Problems Selected
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Once you bid and win your problem statement they&apos;ll appear here
              </p>
            </div>
          ) : (
            /* STATE B: Problems Assigned (Image 1) */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
              {currentTeam.assignedProblems.map((prob) => (
                <div
                  key={prob.id}
                  className="bg-[#22242a] rounded-2xl p-5 border border-white/5 space-y-2 shadow-md"
                >
                  <h3 className="text-base font-bold text-white tracking-tight">
                    {prob.title || `Problem ${prob.number}`}
                  </h3>
                  <p className="text-xs font-semibold text-slate-300">
                    {prob.statement}
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {prob.description}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ========================================================= */}
        {/* SECTION 4: BOTTOM ACTION BUTTONS                          */}
        {/* ========================================================= */}
        <div className="flex flex-wrap items-center gap-4 pt-4 pb-6">
          {/* 1. Enter Auction Button */}
          <button
            type="button"
            onClick={handleEnterAuction}
            className="bg-[#ffedd5] hover:bg-[#fed7aa] active:scale-95 text-[#7c2d12] font-semibold text-xs sm:text-sm px-7 py-2.5 rounded-full transition-all shadow-sm cursor-pointer"
          >
            Enter Auction
          </button>

          {/* 2. Earn Time Button */}
          <button
            type="button"
            onClick={() => setShowEarnTimeModal(true)}
            className="bg-[#374151] hover:bg-[#4b5563] active:scale-95 text-white font-semibold text-xs sm:text-sm px-7 py-2.5 rounded-full transition-all shadow-sm cursor-pointer"
          >
            Earn Time
          </button>

          {/* 3. Submit Solution Button */}
          <button
            type="button"
            onClick={() => setShowSubmitModal(true)}
            className="bg-[#ff5500] hover:bg-[#e64d00] active:scale-95 text-white font-semibold text-xs sm:text-sm px-8 py-2.5 rounded-full transition-all shadow-md shadow-orange-500/25 cursor-pointer"
          >
            Submit Solution
          </button>

          {/* Quick Demo Controls */}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsLive((prev) => !prev)}
              className="text-[11px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded-md border border-white/10 transition-colors cursor-pointer"
              title="Toggle Live vs Upcoming status for testing"
            >
              Toggle Status: {isLive ? "Live" : "Upcoming"}
            </button>
            <button
              type="button"
              onClick={toggleProblemsDemo}
              className="text-[11px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded-md border border-white/10 transition-colors cursor-pointer"
              title="Toggle between Image 1 (Problems) and Image 2 (No Problems)"
            >
              Toggle Problems: {currentTeam.assignedProblems.length > 0 ? "Assigned" : "None"}
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODAL 1: "Auction not yet started!" (Figma Image 3)        */}
      {/* ========================================================= */}
      {showAuctionNotStartedModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-[#22242a] border border-white/10 rounded-2xl p-7 max-w-sm w-full mx-auto text-center shadow-2xl relative animate-in zoom-in-95 duration-150">
            {/* Close X in corner */}
            <button
              type="button"
              onClick={() => setShowAuctionNotStartedModal(false)}
              className="absolute right-3.5 top-3.5 text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>

            {/* White Circular Exclamation Icon */}
            <div className="w-13 h-13 rounded-full border-2 border-white flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold">
              !
            </div>

            {/* Modal Heading */}
            <h2 className="text-lg font-bold text-white mb-2">
              Auction not yet started!
            </h2>

            {/* Modal Description */}
            <p className="text-xs text-slate-300 leading-relaxed mb-6">
              Please wait for the admin or host of Bid2Build start live auctioning
            </p>

            {/* Dismiss Button */}
            <button
              type="button"
              onClick={() => setShowAuctionNotStartedModal(false)}
              className="bg-[#374151] hover:bg-[#4b5563] text-white text-xs font-semibold px-6 py-2 rounded-full cursor-pointer transition-all"
            >
              Okay, got it
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: Contest Rules Modal                              */}
      {/* ========================================================= */}
      {showRulesModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-[#22242a] border border-white/10 rounded-2xl p-6 sm:p-7 max-w-lg w-full mx-auto text-left shadow-2xl relative max-h-[85vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setShowRulesModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4 text-[#ff5500]">
              <BookOpen className="w-5 h-5" />
              <h2 className="text-lg font-bold text-white">Bid2Build Contest Rules</h2>
            </div>

            <div className="text-xs text-slate-300 space-y-3.5 leading-relaxed">
              <div>
                <h4 className="font-bold text-white text-sm mb-1">1. Auction Structure</h4>
                <p>
                  • Two consecutive bidding rounds. Each team starts with a unified <strong>100 Coins</strong> wallet.
                  <br />
                  • Bids are placed in real-time. Losing bids cost 0 coins; coins are only deducted upon winning a slot.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white text-sm mb-1">2. Problem Statement Assignment</h4>
                <p>
                  • Winning a slot awards your team that problem statement for development.
                  <br />
                  • You must build a functional prototype within the designated contest time limit.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white text-sm mb-1">3. Bonus Time & Unspent Coins</h4>
                <p>
                  • Earn time bonuses via mini-challenges (+10 min per verified challenge).
                  <br />
                  • Any coins left unspent after the auction convert to bonus evaluation points!
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white text-sm mb-1">4. Submission Criteria</h4>
                <p>
                  • Submit your public GitHub repository and live demo URL before the countdown reaches zero.
                  <br />
                  • Submissions are evaluated on implementation depth, UI fidelity, and code quality.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/10 text-right">
              <button
                type="button"
                onClick={() => setShowRulesModal(false)}
                className="bg-[#ff5500] hover:bg-[#e64d00] text-white text-xs font-semibold px-6 py-2 rounded-full cursor-pointer transition-all"
              >
                Close Rules
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3: Earn Time Challenge Modal                         */}
      {/* ========================================================= */}
      {showEarnTimeModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-[#22242a] border border-white/10 rounded-2xl p-6 sm:p-7 max-w-md w-full mx-auto text-left shadow-2xl relative">
            <button
              type="button"
              onClick={() => setShowEarnTimeModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-3 text-amber-400">
              <Award className="w-5 h-5" />
              <h2 className="text-base font-bold text-white">Earn Time Bonus (+10 min)</h2>
            </div>

            <p className="text-xs text-slate-300 mb-4">
              Answer this quick challenge question correctly to add <strong>+10 minutes</strong> to your team&apos;s submission timer:
            </p>

            <form onSubmit={handleEarnTimeSubmit} className="space-y-4">
              <div className="bg-[#1a1c20] p-3.5 rounded-xl border border-white/5">
                <span className="text-[11px] text-amber-400 font-semibold block mb-1">
                  Challenge Q{questionsAnswered + 1}:
                </span>
                <p className="text-xs text-white font-medium">
                  Which React-based framework is used for full-stack rendering in Bid2Build?
                </p>
              </div>

              <div>
                <input
                  type="text"
                  required
                  placeholder="Your answer (e.g., Next.js)"
                  value={quizAnswer}
                  onChange={(e) => setQuizAnswer(e.target.value)}
                  className="w-full bg-[#18191c] border border-white/15 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none focus:border-amber-400"
                />
              </div>

              {quizMessage && (
                <div className={`p-2.5 rounded-xl text-xs font-semibold ${quizMessage.includes("Awesome") ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/30" : "bg-red-950/80 text-red-300 border border-red-500/30"}`}>
                  {quizMessage}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEarnTimeModal(false)}
                  className="px-4 py-2 rounded-full text-xs text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-6 py-2 rounded-full transition-all cursor-pointer shadow-sm"
                >
                  Submit Answer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 4: Submit Solution Modal                             */}
      {/* ========================================================= */}
      {showSubmitModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-[#22242a] border border-white/10 rounded-2xl p-6 sm:p-7 max-w-md w-full mx-auto text-left shadow-2xl relative">
            <button
              type="button"
              onClick={() => setShowSubmitModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2 text-[#ff5500]">
              <Send className="w-5 h-5" />
              <h2 className="text-base font-bold text-white">Submit Team Solution</h2>
            </div>
            <p className="text-xs text-slate-300 mb-4">
              Enter your project links before the contest ends to submit your solution for evaluation:
            </p>

            <form onSubmit={handleSubmitSolution} className="space-y-3.5">
              <div>
                <label htmlFor={repoInputId} className="text-xs font-semibold text-slate-300 block mb-1">
                  GitHub Repository URL *
                </label>
                <input
                  id={repoInputId}
                  type="url"
                  required
                  placeholder="https://github.com/team/project"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full bg-[#18191c] border border-white/15 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none focus:border-[#ff5500]"
                />
              </div>

              <div>
                <label htmlFor={liveInputId} className="text-xs font-semibold text-slate-300 block mb-1">
                  Live Deployment URL (Optional)
                </label>
                <input
                  id={liveInputId}
                  type="url"
                  placeholder="https://project.vercel.app"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                  className="w-full bg-[#18191c] border border-white/15 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none focus:border-[#ff5500]"
                />
              </div>

              {submitSuccess && (
                <div className="p-2.5 rounded-xl bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Solution submitted successfully! Submission status updated.</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubmitModal(false)}
                  className="px-4 py-2 rounded-full text-xs text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-[#ff5500] hover:bg-[#e64d00] text-white font-bold text-xs px-6 py-2 rounded-full transition-all cursor-pointer shadow-md shadow-orange-500/25 flex items-center gap-1.5 disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>Confirm Submission</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="text-center text-[11px] text-slate-600 pt-8">
        © 2026 Bid2Build Contest Platform • CSEONECORE
      </footer>
    </div>
  );
}
