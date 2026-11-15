"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  User as UserIcon,
  Users,
  LogOut,
  ShieldCheck,
  Mail,
  Calendar,
  Loader2,
  ArrowRight,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";

interface TeamData {
  id: string;
  name: string;
  locked: boolean;
  created_at: string;
}

interface MemberData {
  id: string;
  name: string;
  email: string;
  college?: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [members, setMembers] = useState<MemberData[]>([]);

  useEffect(() => {
    async function loadUserSession() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user) {
          setUser(session.user);

          // Fetch team and member info linked to this user via RLS
          const { data: memberRows } = await supabase
            .from("members")
            .select("id, name, email, college, team_id")
            .eq("id", session.user.id)
            .maybeSingle();

          if (memberRows?.team_id) {
            const { data: teamRow } = await supabase
              .from("teams")
              .select("*")
              .eq("id", memberRows.team_id)
              .maybeSingle();

            if (teamRow) {
              setTeam(teamRow);
            }

            const { data: teammates } = await supabase
              .from("members")
              .select("id, name, email, college")
              .eq("team_id", memberRows.team_id);

            if (teammates) {
              setMembers(teammates);
            }
          }
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      } finally {
        setLoading(false);
      }
    }

    loadUserSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          <p className="text-sm text-slate-500 dark:text-zinc-400">
            Loading profile...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-100 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 text-slate-900 dark:text-zinc-100 py-10 px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="max-w-4xl mx-auto mb-8 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-bold text-lg text-slate-900 dark:text-white tracking-tight"
        >
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-extrabold text-sm shadow-xs shadow-indigo-500/30">
            B2B
          </div>
          <span>
            Bid<span className="text-indigo-600 dark:text-indigo-400">2</span>Build
          </span>
        </Link>

        {user ? (
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        ) : (
          <Link
            href="/login"
            className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Sign In
          </Link>
        )}
      </header>

      {/* Main Profile View */}
      <main className="max-w-4xl mx-auto space-y-6">
        {!user ? (
          <div className="bg-white dark:bg-zinc-900 border border-slate-200/90 dark:border-zinc-800 rounded-2xl shadow-xl shadow-slate-100/50 dark:shadow-none p-8 sm:p-12 text-center max-w-lg mx-auto">
            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-400 mx-auto mb-4">
              <UserIcon className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100">
              Authentication Required
            </h2>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mt-2 mb-6">
              Please sign in to view your team profile, auction slots, and project status.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/login"
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                <span>Go to Login</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/register"
                className="px-6 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 font-semibold text-sm hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
              >
                Register Team
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* User Account Card */}
            <div className="md:col-span-1 bg-white dark:bg-zinc-900 border border-slate-200/90 dark:border-zinc-800 rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-zinc-800">
                <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-lg">
                  {user.email?.charAt(0).toUpperCase() || "U"}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-zinc-100">
                    Account Overview
                  </h3>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-3 h-3" /> Authenticated
                  </span>
                </div>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-slate-400 block font-medium">Email</span>
                  <p className="font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5 mt-0.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    {user.email}
                  </p>
                </div>

                <div>
                  <span className="text-slate-400 block font-medium">User ID</span>
                  <p className="font-mono text-slate-600 dark:text-zinc-400 truncate mt-0.5">
                    {user.id}
                  </p>
                </div>

                <div>
                  <span className="text-slate-400 block font-medium">Created</span>
                  <p className="text-slate-600 dark:text-zinc-400 flex items-center gap-1.5 mt-0.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {new Date(user.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-zinc-800">
                <button
                  onClick={handleSignOut}
                  className="w-full py-2.5 rounded-xl border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out of Account
                </button>
              </div>
            </div>

            {/* Team Info & Teammates */}
            <div className="md:col-span-2 bg-white dark:bg-zinc-900 border border-slate-200/90 dark:border-zinc-800 rounded-2xl p-6 shadow-xs space-y-6">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    <h3 className="font-bold text-base text-slate-900 dark:text-zinc-100">
                      Team Details
                    </h3>
                  </div>
                  {team && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400">
                      {team.locked ? "Locked" : "Active"}
                    </span>
                  )}
                </div>

                {team ? (
                  <div className="mt-4 space-y-4">
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-zinc-800/50 border border-slate-200/70 dark:border-zinc-800">
                      <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">
                        Assigned Team Name
                      </span>
                      <p className="text-lg font-bold text-slate-900 dark:text-zinc-50 mt-0.5">
                        {team.name}
                      </p>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                        Registered Team Members ({members.length})
                      </h4>
                      <div className="divide-y divide-slate-100 dark:divide-zinc-800 border border-slate-200/70 dark:border-zinc-800 rounded-xl overflow-hidden">
                        {members.map((m) => (
                          <div
                            key={m.id}
                            className="p-3 text-xs flex items-center justify-between"
                          >
                            <div>
                              <span className="font-semibold text-slate-800 dark:text-zinc-200">
                                {m.name}
                              </span>
                              <span className="block text-slate-400">
                                {m.email}
                              </span>
                            </div>
                            {m.college && (
                              <span className="text-slate-500 bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                                {m.college}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-10 space-y-3">
                    <p className="text-sm text-slate-500 dark:text-zinc-400">
                      No team assigned to this account yet.
                    </p>
                    <Link
                      href="/register"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-xs transition-colors"
                    >
                      <span>Register a New Team</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
