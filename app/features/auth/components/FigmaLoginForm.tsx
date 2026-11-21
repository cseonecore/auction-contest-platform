"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { FigmaHeaderLogos } from "@/components/shared/FigmaHeaderLogos";
import { supabase } from "@/lib/supabase";

export const FigmaLoginForm: React.FC = () => {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [captainUsn, setCaptainUsn] = useState("");
  const [showUsn, setShowUsn] = useState(false);
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
      setError("Please enter the Captain USN (Password).");
      return;
    }

    const USN_PATTERN = /^4MT\d{2}[A-Z]{2}\d{3}$/i;
    const cleanCaptainUsn = captainUsn.trim().toUpperCase();
    if (!USN_PATTERN.test(cleanCaptainUsn)) {
      setError("Captain USN must follow pattern 4MT2XBBMMM (e.g., 4MT24CS001).");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: teamName.trim(),
          captainUsn: cleanCaptainUsn,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error || "Invalid Team Name or Captain USN. Please check your credentials."
        );
      }

      // Adopt the Supabase session issued by the server so the
      // browser can call RLS-protected RPCs (place_bid, realtime).
      if (data.session?.access_token && data.session?.refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (sessionError) {
          console.warn(
            "[Login] Could not adopt the auction session:",
            sessionError.message
          );
        }
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
        Only the designated Team Captain can log in. Enter your Team Name and
        Captain USN (Password) to access your team profile.
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
            autoComplete="organization"
            onChange={(e) => {
              setTeamName(e.target.value);
              if (error) setError(null);
            }}
            className="w-full px-5 py-3 rounded-full border border-slate-300 text-sm placeholder:text-slate-400 text-slate-900 bg-white focus:outline-hidden focus:border-[#fe5102] focus:ring-1 focus:ring-[#fe5102] transition-all shadow-xs"
          />
        </div>

        {/* Captain USN Input (acts as Password, masked by default) */}
        <div>
          <div className="relative">
            <input
              type={showUsn ? "text" : "password"}
              required
              placeholder="Captain USN (e.g. 4MT24CS001)"
              value={captainUsn}
              maxLength={10}
              autoComplete="current-password"
              onChange={(e) => {
                setCaptainUsn(e.target.value.toUpperCase());
                if (error) setError(null);
              }}
              className="w-full pl-5 pr-12 py-3 rounded-full border border-slate-300 text-sm placeholder:text-slate-400 text-slate-900 bg-white focus:outline-hidden focus:border-[#fe5102] focus:ring-1 focus:ring-[#fe5102] transition-all shadow-xs uppercase font-mono tracking-wider"
            />
            <button
              type="button"
              onClick={() => setShowUsn((prev) => !prev)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1 cursor-pointer"
              aria-label={showUsn ? "Hide Captain USN" : "Show Captain USN"}
            >
              {showUsn ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 text-left pl-4 pt-1 font-sans">
            Captain USN acts as your password (Format:{" "}
            <span className="font-mono font-medium text-slate-500">4MT2XBBMMM</span>).
            Teammates cannot log in.
          </p>
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
