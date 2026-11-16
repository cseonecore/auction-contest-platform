"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { FigmaHeaderLogos } from "@/components/shared/FigmaHeaderLogos";

export const FigmaLoginForm: React.FC = () => {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [captainUsn, setCaptainUsn] = useState("");
  const [showUsn, setShowUsn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!teamName.trim()) {
      setError("Please enter your Team Name.");
      return;
    }

    if (!captainUsn.trim()) {
      setError("Please enter the Captain USN.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: teamName.trim(),
          captainUsn: captainUsn.trim().toUpperCase(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error || "Invalid Team Name or Captain USN. Please check your credentials."
        );
      }

      // Store current team in localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem("b2b_logged_in_team", JSON.stringify(data.team));
      }

      // Redirect to profile
      router.push("/profile");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto text-center">
      {/* Logos */}
      <FigmaHeaderLogos />

      {/* Heading */}
      <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
        Log in To Your Profile
      </h1>
      <p className="text-xs sm:text-sm text-slate-500 font-normal mt-2">
        Enter your Team ID and Captain USN and view your profile
      </p>

      {/* Error Message */}
      {error && (
        <div className="mt-4 p-2.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-xs font-medium max-w-sm mx-auto">
          {error}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="mt-8 space-y-4 max-w-sm mx-auto">
        {/* Team Name Input */}
        <div>
          <input
            type="text"
            required
            placeholder="Team Name"
            value={teamName}
            onChange={(e) => {
              setTeamName(e.target.value);
              if (error) setError(null);
            }}
            className="w-full px-5 py-3 rounded-full border border-slate-300 text-sm placeholder:text-slate-400 text-slate-900 bg-white focus:outline-hidden focus:border-[#fe5102] focus:ring-1 focus:ring-[#fe5102] transition-all shadow-xs"
          />
        </div>

        {/* Captain USN Input */}
        <div className="relative">
          <input
            type={showUsn ? "text" : "password"}
            required
            placeholder="Captain USN"
            value={captainUsn}
            maxLength={10}
            onChange={(e) => {
              setCaptainUsn(e.target.value.toUpperCase());
              if (error) setError(null);
            }}
            className="w-full pl-5 pr-12 py-3 rounded-full border border-slate-300 text-sm placeholder:text-slate-400 text-slate-900 bg-white focus:outline-hidden focus:border-[#fe5102] focus:ring-1 focus:ring-[#fe5102] transition-all shadow-xs uppercase font-mono"
          />
          <button
            type="button"
            onClick={() => setShowUsn((prev) => !prev)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
            aria-label={showUsn ? "Hide Captain USN" : "Show Captain USN"}
          >
            {showUsn ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-[#fe5102] hover:bg-[#e54700] active:scale-95 text-white font-semibold px-8 py-2.5 rounded-full text-sm shadow-xs transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Logging in...</span>
              </>
            ) : (
              <span>Log in</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
