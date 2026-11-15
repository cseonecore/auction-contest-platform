"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FigmaHeaderLogos } from "@/components/shared/FigmaHeaderLogos";
import { Loader2 } from "lucide-react";

export const FigmaRegistrationForm: React.FC = () => {
  const [teamName, setTeamName] = useState("");
  const [teamSize, setTeamSize] = useState<2 | 3 | 4>(3);

  // Captain details (with Semester & Phone confirmation)
  const [captainName, setCaptainName] = useState("");
  const [captainUsn, setCaptainUsn] = useState("");
  const [captainSemester, setCaptainSemester] = useState("");
  const [captainPhone, setCaptainPhone] = useState("");

  // Member 2
  const [m2Name, setM2Name] = useState("");
  const [m2Usn, setM2Usn] = useState("");

  // Member 3
  const [m3Name, setM3Name] = useState("");
  const [m3Usn, setM3Usn] = useState("");

  // Member 4
  const [m4Name, setM4Name] = useState("");
  const [m4Usn, setM4Usn] = useState("");

  // Form State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 1. Team Name validation
    if (!teamName.trim()) {
      setError("Please enter a Team Name.");
      return;
    }

    // 2. Captain validation (Name, USN, Semester, Phone)
    if (!captainName.trim()) {
      setError("Please enter Captain Name.");
      return;
    }

    if (!captainUsn.trim()) {
      setError("Please enter Captain USN.");
      return;
    }

    if (!captainSemester) {
      setError("Please select Captain's Semester.");
      return;
    }

    const cleanPhone = captainPhone.replace(/[\s-]/g, "");
    if (!cleanPhone || cleanPhone.length < 10) {
      setError("Please enter a valid 10-digit Phone Number for the Captain.");
      return;
    }

    // 3. Member 2 validation
    if (!m2Name.trim() || !m2Usn.trim()) {
      setError("Please fill in Member 2 Name and USN.");
      return;
    }

    // 4. Member 3 validation (if team size >= 3)
    if (teamSize >= 3 && (!m3Name.trim() || !m3Usn.trim())) {
      setError("Please fill in Member 3 Name and USN.");
      return;
    }

    // 5. Member 4 validation (if team size == 4)
    if (teamSize >= 4 && (!m4Name.trim() || !m4Usn.trim())) {
      setError("Please fill in Member 4 Name and USN.");
      return;
    }

    // 6. Check for duplicate USNs
    const usnList = [captainUsn.trim().toUpperCase(), m2Usn.trim().toUpperCase()];
    if (teamSize >= 3) usnList.push(m3Usn.trim().toUpperCase());
    if (teamSize >= 4) usnList.push(m4Usn.trim().toUpperCase());

    const uniqueUsns = new Set(usnList);
    if (uniqueUsns.size !== usnList.length) {
      setError("Duplicate USN detected! Each team member must have a unique USN.");
      return;
    }

    setLoading(true);

    try {
      const members = [
        { name: m2Name.trim(), usn: m2Usn.trim().toUpperCase() },
      ];
      if (teamSize >= 3) {
        members.push({ name: m3Name.trim(), usn: m3Usn.trim().toUpperCase() });
      }
      if (teamSize >= 4) {
        members.push({ name: m4Name.trim(), usn: m4Usn.trim().toUpperCase() });
      }

      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: teamName.trim(),
          teamSize,
          captain: {
            name: captainName.trim(),
            usn: captainUsn.trim().toUpperCase(),
            semester: captainSemester,
            phone: cleanPhone,
          },
          members,
        }),
      });

      const data = await res.json();

      if (res.status === 403 || data.status === "limit_reached") {
        setLimitReached(true);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Registration failed. Please try again.");
      }

      setSuccessEmail(
        data.captainEmail ||
          data.captionEmail ||
          `${captainUsn.trim().toLowerCase()}@mite.ac.in`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to register team.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------
  // VIEW 1: Success Screen (Image 2 - Thank You For Registering)
  // -------------------------------------------------------------
  if (successEmail) {
    return (
      <div className="w-full max-w-xl mx-auto text-center py-12 animate-in fade-in duration-200">
        <FigmaHeaderLogos />
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Thank You For Registering
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 font-normal mt-2.5 max-w-md mx-auto">
          Your Team ID and Password will be sent shortly to your captain&apos;s{" "}
          <span className="font-semibold text-slate-800">{successEmail}</span>
        </p>

        <div className="mt-8">
          <Link
            href="/login"
            className="bg-[#ff5500] hover:bg-[#e64d00] text-white font-semibold text-xs sm:text-sm px-8 py-2.5 rounded-full shadow-sm transition-all inline-block"
          >
            Go to Log in
          </Link>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW 2: Limit Reached Screen (Image 3 - Sorry Limit Reached)
  // -------------------------------------------------------------
  if (limitReached) {
    return (
      <div className="w-full max-w-xl mx-auto text-center py-12 animate-in fade-in duration-200">
        <FigmaHeaderLogos />
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Sorry Limit Reached
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 font-normal mt-2.5">
          sorry your late, all slots are filled! Better Luck Next Time
        </p>

        <div className="mt-8">
          <Link
            href="/login"
            className="bg-[#ff5500] hover:bg-[#e64d00] text-white font-semibold text-xs sm:text-sm px-8 py-2.5 rounded-full shadow-sm transition-all inline-block"
          >
            Back to Log in
          </Link>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW 3: Form Screen (Image 4 - Join the Competition)
  // -------------------------------------------------------------
  return (
    <div className="w-full max-w-4xl mx-auto text-center">
      <FigmaHeaderLogos />

      <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
        Join the Competition
      </h1>
      <p className="text-xs sm:text-sm text-slate-500 font-normal mt-1.5 mb-8">
        Register your team and get ready to build something awesome.
      </p>

      {error && (
        <div className="mb-6 p-2.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-xs font-medium max-w-lg mx-auto">
          {error}
        </div>
      )}

      {/* Main Container Card */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-4 sm:p-6 text-left">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          {/* LEFT: Orange Enter Details Form */}
          <div className="bg-[#ff5500] rounded-2xl p-5 sm:p-6 text-white shadow-xs space-y-3.5">
            <h2 className="text-xl font-bold tracking-tight mb-2">
              Enter Details
            </h2>

            {/* Team Name */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold w-20 shrink-0">
                Team Name
              </label>
              <input
                type="text"
                required
                placeholder="Team Name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="w-full bg-white text-slate-900 text-xs px-3 py-1.5 rounded-lg outline-none placeholder:text-slate-400"
              />
            </div>

            {/* Team Size */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold w-20 shrink-0">
                Team Size
              </label>
              <div className="flex items-center gap-2">
                {([2, 3, 4] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setTeamSize(sz)}
                    className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center transition-all cursor-pointer ${
                      teamSize === sz
                        ? "bg-white text-[#ff5500] shadow-sm scale-105"
                        : "bg-white/30 text-white hover:bg-white/40"
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            {/* Captain (with Semester and Phone Number confirmation) */}
            <div className="flex items-start gap-2 pt-1">
              <label className="text-xs font-semibold w-20 shrink-0 pt-1.5">
                Captain
              </label>
              <div className="w-full space-y-1.5">
                <input
                  type="text"
                  required
                  placeholder="Captain Name"
                  value={captainName}
                  onChange={(e) => setCaptainName(e.target.value)}
                  className="w-full bg-white text-slate-900 text-xs px-3 py-1.5 rounded-lg outline-none placeholder:text-slate-400"
                />
                <input
                  type="text"
                  required
                  placeholder="USN [ 4MT2XBBMMM ]"
                  value={captainUsn}
                  onChange={(e) => setCaptainUsn(e.target.value.toUpperCase())}
                  className="w-full bg-white text-slate-900 text-xs px-3 py-1.5 rounded-lg outline-none placeholder:text-slate-400 font-mono"
                />

                {/* Semester & Phone Number Confirmation (Only for Captain) */}
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={captainSemester}
                    onChange={(e) => setCaptainSemester(e.target.value)}
                    required
                    className="w-full bg-white text-slate-900 text-xs px-2.5 py-1.5 rounded-lg outline-none cursor-pointer"
                  >
                    <option value="" disabled>
                      Semester
                    </option>
                    <option value="1">1st Sem</option>
                    <option value="2">2nd Sem</option>
                    <option value="3">3rd Sem</option>
                    <option value="4">4th Sem</option>
                    <option value="5">5th Sem</option>
                    <option value="6">6th Sem</option>
                    <option value="7">7th Sem</option>
                    <option value="8">8th Sem</option>
                  </select>

                  <input
                    type="tel"
                    required
                    placeholder="Phone Number"
                    value={captainPhone}
                    onChange={(e) => setCaptainPhone(e.target.value)}
                    className="w-full bg-white text-slate-900 text-xs px-3 py-1.5 rounded-lg outline-none placeholder:text-slate-400 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Member 2 */}
            <div className="flex items-start gap-2">
              <label className="text-xs font-semibold w-20 shrink-0 pt-1.5">
                Member 2
              </label>
              <div className="w-full space-y-1.5">
                <input
                  type="text"
                  required
                  placeholder="Name"
                  value={m2Name}
                  onChange={(e) => setM2Name(e.target.value)}
                  className="w-full bg-white text-slate-900 text-xs px-3 py-1.5 rounded-lg outline-none placeholder:text-slate-400"
                />
                <input
                  type="text"
                  required
                  placeholder="USN [ 4MT2XBBMMM ]"
                  value={m2Usn}
                  onChange={(e) => setM2Usn(e.target.value.toUpperCase())}
                  className="w-full bg-white text-slate-900 text-xs px-3 py-1.5 rounded-lg outline-none placeholder:text-slate-400 font-mono"
                />
              </div>
            </div>

            {/* Member 3 (visible when teamSize is 3 or 4) */}
            {teamSize >= 3 && (
              <div className="flex items-start gap-2 animate-in fade-in duration-150">
                <label className="text-xs font-semibold w-20 shrink-0 pt-1.5">
                  Member 3
                </label>
                <div className="w-full space-y-1.5">
                  <input
                    type="text"
                    required
                    placeholder="Name"
                    value={m3Name}
                    onChange={(e) => setM3Name(e.target.value)}
                    className="w-full bg-white text-slate-900 text-xs px-3 py-1.5 rounded-lg outline-none placeholder:text-slate-400"
                  />
                  <input
                    type="text"
                    required
                    placeholder="USN [ 4MT2XBBMMM ]"
                    value={m3Usn}
                    onChange={(e) => setM3Usn(e.target.value.toUpperCase())}
                    className="w-full bg-white text-slate-900 text-xs px-3 py-1.5 rounded-lg outline-none placeholder:text-slate-400 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Member 4 (visible when teamSize is 4) */}
            {teamSize >= 4 && (
              <div className="flex items-start gap-2 animate-in fade-in duration-150">
                <label className="text-xs font-semibold w-20 shrink-0 pt-1.5">
                  Member 4
                </label>
                <div className="w-full space-y-1.5">
                  <input
                    type="text"
                    required
                    placeholder="Name"
                    value={m4Name}
                    onChange={(e) => setM4Name(e.target.value)}
                    className="w-full bg-white text-slate-900 text-xs px-3 py-1.5 rounded-lg outline-none placeholder:text-slate-400"
                  />
                  <input
                    type="text"
                    required
                    placeholder="USN [ 4MT2XBBMMM ]"
                    value={m4Usn}
                    onChange={(e) => setM4Usn(e.target.value.toUpperCase())}
                    className="w-full bg-white text-slate-900 text-xs px-3 py-1.5 rounded-lg outline-none placeholder:text-slate-400 font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Live Preview Subcard */}
          <div className="flex flex-col items-center justify-center p-4 text-center">
            {/* Character Mascot */}
            <div className="w-24 h-24 relative mb-3">
              <Image
                src="/characters/Character-01.png"
                alt="Contest Character"
                fill
                className="object-contain"
                priority
              />
            </div>

            {/* Team Name with Blue Checkmark */}
            <div className="flex items-center gap-1.5 justify-center mb-3">
              <h3 className="font-extrabold text-xl text-slate-900 tracking-tight">
                {teamName.trim() || "Cseonecore"}
              </h3>
              <span className="w-4 h-4 rounded-full bg-sky-500 text-white flex items-center justify-center text-[10px] font-bold">
                ✓
              </span>
            </div>

            {/* Pills / Badges */}
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-xs">
              <span className="bg-[#fef08a] text-[#854d0e] font-semibold text-[11px] px-3 py-1 rounded-full shadow-2xs">
                Coins : 100
              </span>
              <span className="bg-[#bfdbfe] text-[#1e40af] font-semibold text-[11px] px-3 py-1 rounded-full shadow-2xs">
                Team : {teamSize}
              </span>
              <span className="bg-[#bbf7d0] text-[#166534] font-semibold text-[11px] px-3 py-1 rounded-full shadow-2xs">
                {captainName.trim()
                  ? `${captainName.trim()} (Captain${
                      captainSemester ? ` - Sem ${captainSemester}` : ""
                    })`
                  : "Member 1 (Captain)"}
              </span>
              <span className="bg-[#fecaca] text-[#991b1b] font-semibold text-[11px] px-3 py-1 rounded-full shadow-2xs">
                {m2Name.trim() || "Member 2 Name"}
              </span>
              {teamSize >= 3 && (
                <span className="bg-[#fbcfe8] text-[#9d174d] font-semibold text-[11px] px-3 py-1 rounded-full shadow-2xs">
                  {m3Name.trim() || "Member 3 Name"}
                </span>
              )}
              {teamSize >= 4 && (
                <span className="bg-[#e9d5ff] text-[#6b21a8] font-semibold text-[11px] px-3 py-1 rounded-full shadow-2xs">
                  {m4Name.trim() || "Member 4 Name"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Register Team Button */}
      <div className="mt-8">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="bg-[#ff5500] hover:bg-[#e64d00] active:scale-95 text-white font-semibold text-sm px-10 py-3 rounded-full shadow-md shadow-orange-500/25 transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Registering Team...</span>
            </>
          ) : (
            <span>Register Team</span>
          )}
        </button>
      </div>
    </div>
  );
};
