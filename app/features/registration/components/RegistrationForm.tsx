"use client";

import React, { useState } from "react";
import {
  RegistrationFormData,
  TeamSize,
  FormErrors,
  RegistrationSuccessData,
  Teammate,
} from "../types";
import { FormField } from "./FormField";
import { TeamSizeSelector } from "./TeamSizeSelector";
import { TeammateSection } from "./TeammateSection";
import { RegistrationSuccess } from "./RegistrationSuccess";
import { supabase } from "@/lib/supabase";

const INITIAL_FORM_STATE: RegistrationFormData = {
  teamName: "",
  leader: {
    name: "",
    usn: "",
    email: "",
    phone: "",
  },
  teamSize: 3,
  teammates: [
    { id: 2, name: "", usn: "" },
    { id: 3, name: "", usn: "" },
    { id: 4, name: "", usn: "" },
  ],
};

export const RegistrationForm: React.FC = () => {
  const [formData, setFormData] =
    useState<RegistrationFormData>(INITIAL_FORM_STATE);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successData, setSuccessData] =
    useState<RegistrationSuccessData | null>(null);

  // Active teammates based on selected team size (3 or 4)
  const activeTeammates: Teammate[] =
    formData.teamSize === 3
      ? formData.teammates.filter((t) => t.id === 2 || t.id === 3)
      : formData.teammates;

  // Handle Team Name Change
  const handleTeamNameChange = (val: string) => {
    setFormData((prev) => ({ ...prev, teamName: val }));
    if (errors.teamName) {
      setErrors((prev) => ({ ...prev, teamName: undefined }));
    }
  };

  // Handle Leader Info Change
  const handleLeaderChange = (
    field: "name" | "usn" | "email" | "phone",
    val: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      leader: {
        ...prev.leader,
        [field]: val,
      },
    }));

    // Clear specific error on change
    const errorKey =
      field === "name"
        ? "leaderName"
        : field === "usn"
        ? "leaderUsn"
        : field === "email"
        ? "leaderEmail"
        : "leaderPhone";

    if (errors[errorKey]) {
      setErrors((prev) => ({ ...prev, [errorKey]: undefined }));
    }
  };

  // Handle Team Size Change
  const handleTeamSizeChange = (newSize: TeamSize) => {
    setFormData((prev) => ({
      ...prev,
      teamSize: newSize,
    }));
    // Clear teammate errors if any
    setErrors((prev) => ({ ...prev, teammateErrors: undefined }));
  };

  // Handle Teammate Update
  const handleUpdateTeammate = (
    id: number,
    field: "name" | "usn",
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      teammates: prev.teammates.map((t) =>
        t.id === id ? { ...t, [field]: value } : t
      ),
    }));

    // Clear error for this teammate
    if (errors.teammateErrors?.[id]?.[field]) {
      setErrors((prev) => ({
        ...prev,
        teammateErrors: {
          ...prev.teammateErrors,
          [id]: {
            ...prev.teammateErrors?.[id],
            [field]: undefined,
          },
        },
      }));
    }
  };

  // Reset Form
  const handleReset = () => {
    setFormData(INITIAL_FORM_STATE);
    setErrors({});
    setSuccessData(null);
  };

  // Validation function
  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};
    const teammateErrors: Record<number, { name?: string; usn?: string }> = {};

    // 1. Team Name
    if (!formData.teamName.trim()) {
      newErrors.teamName = "Team name is required.";
    } else if (formData.teamName.trim().length < 3) {
      newErrors.teamName = "Team name must be at least 3 characters.";
    }

    // 2. Team Leader Name
    if (!formData.leader.name.trim()) {
      newErrors.leaderName = "Leader name is required.";
    }

    // 3. Team Leader USN
    const cleanLeaderUsn = formData.leader.usn.trim().toUpperCase();
    if (!cleanLeaderUsn) {
      newErrors.leaderUsn = "Leader USN is required.";
    }

    // 4. Team Leader Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.leader.email.trim()) {
      newErrors.leaderEmail = "Email address is required.";
    } else if (!emailRegex.test(formData.leader.email.trim())) {
      newErrors.leaderEmail = "Please enter a valid email address.";
    }

    // 5. Team Leader Phone
    const phoneRegex = /^[0-9+ -]{10,15}$/;
    const cleanPhone = formData.leader.phone.replace(/[\s-]/g, "");
    if (!formData.leader.phone.trim()) {
      newErrors.leaderPhone = "Phone number is required.";
    } else if (cleanPhone.length < 10 || !phoneRegex.test(formData.leader.phone.trim())) {
      newErrors.leaderPhone = "Please enter a valid phone number (at least 10 digits).";
    }

    // 6. Active Teammates Validation & USN Duplication Check
    const allUsns: { usn: string; member: string; id: number }[] = [];
    if (cleanLeaderUsn) {
      allUsns.push({ usn: cleanLeaderUsn, member: "Team Leader", id: 1 });
    }

    activeTeammates.forEach((tm) => {
      const tmErrors: { name?: string; usn?: string } = {};
      const cleanTmName = tm.name.trim();
      const cleanTmUsn = tm.usn.trim().toUpperCase();

      if (!cleanTmName) {
        tmErrors.name = `Teammate ${tm.id} name is required.`;
      }

      if (!cleanTmUsn) {
        tmErrors.usn = `Teammate ${tm.id} USN is required.`;
      } else {
        // Check for duplicates
        const duplicate = allUsns.find((item) => item.usn === cleanTmUsn);
        if (duplicate) {
          tmErrors.usn = `Duplicate USN! Already used by ${duplicate.member}.`;
        } else {
          allUsns.push({ usn: cleanTmUsn, member: `Teammate ${tm.id}`, id: tm.id });
        }
      }

      if (tmErrors.name || tmErrors.usn) {
        teammateErrors[tm.id] = tmErrors;
      }
    });

    if (Object.keys(teammateErrors).length > 0) {
      newErrors.teammateErrors = teammateErrors;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      // Scroll to the first error
      const firstError = document.querySelector('[aria-invalid="true"]');
      if (firstError) {
        firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    setIsSubmitting(true);

    try {
      // Submission Payload: ensure only active teammates are included!
      const payload = {
        teamName: formData.teamName.trim(),
        teamSize: formData.teamSize,
        leader: {
          name: formData.leader.name.trim(),
          usn: formData.leader.usn.trim().toUpperCase(),
          email: formData.leader.email.trim(),
          phone: formData.leader.phone.trim(),
        },
        teammates: activeTeammates.map((tm) => ({
          id: tm.id,
          name: tm.name.trim(),
          usn: tm.usn.trim().toUpperCase(),
        })),
        submittedAt: new Date().toISOString(),
      };

      // Call the register API
      const res = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const apiData = await res.json();

      if (!res.ok) {
        // Handle API errors
        throw new Error(apiData.error || "Registration failed");
      }

      // successful registration - API returns initialPassword
      const initialPassword = apiData.initialPassword || "";

      const finalResult: RegistrationSuccessData = {
        registrationId: apiData.teamId || `B2B-${formData.teamSize}M-${Math.floor(1000 + Math.random() * 9000)}`,
        teamName: payload.teamName,
        teamSize: payload.teamSize,
        registeredAt: payload.submittedAt,
        leader: payload.leader,
        teammates: payload.teammates,
        initialPassword, // Include initial password for captain
      };

      // Also persist to localStorage for local recovery/demo inspection
      if (typeof window !== "undefined") {
        try {
          const stored = JSON.parse(
            localStorage.getItem("b2b_registered_teams") || "[]"
          );
          stored.push(finalResult);
          localStorage.setItem("b2b_registered_teams", JSON.stringify(stored));
        } catch {
          // Ignore localStorage quota or private mode issues
        }
      }

      setSuccessData(finalResult);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to register team. Please try again.";
      setErrors((prev) => ({ ...prev, general: message }));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successData) {
    return <RegistrationSuccess data={successData} onReset={handleReset} />;
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-slate-200/90 dark:border-zinc-800 rounded-2xl shadow-xl shadow-slate-100 dark:shadow-none p-6 sm:p-10 transition-all">
      {/* Header section inside card */}
      <div className="border-b border-slate-100 dark:border-zinc-800 pb-6 mb-8 text-center sm:text-left">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 text-xs font-semibold mb-3">
          <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400"></span>
          Bid2Build Event 2026
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-zinc-50 tracking-tight">
          Team Registration
        </h1>
        <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
          Register your team and be part of the event.
        </p>
      </div>

      {errors.general && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-sm flex items-center gap-2.5">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{errors.general}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-8">
        {/* SECTION A: Team Information */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-100 dark:border-zinc-800">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-semibold text-xs">
              A
            </span>
            <h3 className="text-base font-semibold text-slate-800 dark:text-zinc-100">
              Team Information
            </h3>
          </div>

          <FormField
            id="team-name"
            label="Team Name"
            required
            placeholder="e.g. CodeCraft Titans"
            hint="Choose a unique name for your team"
            value={formData.teamName}
            error={errors.teamName}
            onChange={(e) => handleTeamNameChange(e.target.value)}
          />
        </div>

        {/* SECTION B: Team Leader Information */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-100 dark:border-zinc-800">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-semibold text-xs">
              B
            </span>
            <h3 className="text-base font-semibold text-slate-800 dark:text-zinc-100">
              Team Leader Information
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              id="leader-name"
              label="Team Leader Name"
              required
              placeholder="e.g. Alex Morgan"
              value={formData.leader.name}
              error={errors.leaderName}
              onChange={(e) => handleLeaderChange("name", e.target.value)}
            />

            <FormField
              id="leader-usn"
              label="USN"
              required
              placeholder="e.g. 1MS21CS001"
              value={formData.leader.usn}
              error={errors.leaderUsn}
              onChange={(e) =>
                handleLeaderChange("usn", e.target.value.toUpperCase())
              }
            />

            <FormField
              id="leader-email"
              type="email"
              label="Email ID"
              required
              placeholder="e.g. leader@college.edu"
              value={formData.leader.email}
              error={errors.leaderEmail}
              onChange={(e) => handleLeaderChange("email", e.target.value)}
            />

            <FormField
              id="leader-phone"
              type="tel"
              label="Phone Number"
              required
              placeholder="e.g. 9876543210"
              value={formData.leader.phone}
              error={errors.leaderPhone}
              onChange={(e) => handleLeaderChange("phone", e.target.value)}
            />
          </div>
        </div>

        {/* SECTION C: Total Team Members */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-100 dark:border-zinc-800">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-semibold text-xs">
              C
            </span>
            <h3 className="text-base font-semibold text-slate-800 dark:text-zinc-100">
              Total Team Members
            </h3>
          </div>

          <TeamSizeSelector
            value={formData.teamSize}
            onChange={handleTeamSizeChange}
          />
        </div>

        {/* SECTION D: Dynamic Teammate Information */}
        <TeammateSection
          teammates={activeTeammates}
          errors={errors.teammateErrors || {}}
          onUpdateTeammate={handleUpdateTeammate}
        />

        {/* Submission Actions */}
        <div className="pt-6 border-t border-slate-100 dark:border-zinc-800 flex flex-col-reverse sm:flex-row items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleReset}
            disabled={isSubmitting}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 text-sm font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            Reset Form
          </button>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto px-8 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-sm shadow-md shadow-indigo-600/20 hover:shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Registering Team...
              </>
            ) : (
              <>
                <span>Register Team</span>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14 5l7 7m0 0l-7 7m7-7H3"
                  />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
