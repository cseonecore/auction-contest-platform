"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { GoogleButton } from "./GoogleButton";
import { ForgotPasswordModal } from "./ForgotPasswordModal";
import { supabase } from "@/lib/supabase";

function LoginFormInternal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Form states - initialized with any URL error (e.g. from /auth/callback)
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    urlError ? decodeURIComponent(urlError) : null
  );
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);

  // Field validation errors
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Keep synced if search params change dynamically
  useEffect(() => {
    if (urlError) {
      setErrorMessage(decodeURIComponent(urlError));
    }
  }, [urlError]);

  const validate = (): boolean => {
    let isValid = true;
    setEmailError(null);
    setPasswordError(null);
    setErrorMessage(null);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) {
      setEmailError("Email address is required.");
      isValid = false;
    } else if (!emailRegex.test(email.trim())) {
      setEmailError("Please enter a valid email address.");
      isValid = false;
    }

    if (!password) {
      setPasswordError("Password is required.");
      isValid = false;
    } else if (password.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      isValid = false;
    }

    return isValid;
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        // Human-friendly error translation
        if (
          error.message.toLowerCase().includes("invalid login credentials") ||
          error.message.toLowerCase().includes("invalid grant")
        ) {
          setErrorMessage(
            "Invalid email or password. Please verify your credentials and try again."
          );
        } else if (error.message.toLowerCase().includes("email not confirmed")) {
          setErrorMessage(
            "Please confirm your email address before logging in."
          );
        } else {
          setErrorMessage(error.message);
        }
        return;
      }

      if (data.session) {
        // Successfully logged in! Redirect to profile
        router.push("/profile");
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during login. Please try again.";
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="bg-white dark:bg-zinc-900 border border-slate-200/90 dark:border-zinc-800 rounded-2xl shadow-xl shadow-slate-100/60 dark:shadow-none p-6 sm:p-10 transition-all w-full max-w-md mx-auto">
        {/* Page Heading & Subtitle */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 text-xs font-semibold mb-3">
            <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400"></span>
            Bid2Build Auth Portal
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-zinc-50 tracking-tight">
            Login Page
          </h1>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1.5">
            Welcome back! Sign in to continue.
          </p>
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-6 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-xs sm:text-sm flex items-start gap-2.5 animate-in fade-in duration-150"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{errorMessage}</div>
          </div>
        )}

        {/* Option 1: Google Login */}
        <div className="space-y-4">
          <GoogleButton onError={(msg) => setErrorMessage(msg)} />

          {/* Separator OR */}
          <div className="relative flex items-center justify-center my-6">
            <div className="border-t border-slate-200 dark:border-zinc-800 w-full"></div>
            <span className="bg-white dark:bg-zinc-900 px-3 text-xs uppercase font-bold tracking-wider text-slate-400 dark:text-zinc-500 relative">
              OR
            </span>
          </div>
        </div>

        {/* Option 2: Email Login Form */}
        <form onSubmit={handleEmailLogin} noValidate className="space-y-4">
          {/* Email Address Field */}
          <div className="space-y-1.5">
            <label
              htmlFor="login-email"
              className="block text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              Email Address <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                className={`w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border transition-all duration-150 outline-none
                  bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500
                  ${
                    emailError
                      ? "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-950/40"
                      : "border-slate-300 dark:border-zinc-700 hover:border-slate-400 dark:hover:border-zinc-600 focus:border-indigo-600 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950/40"
                  }`}
              />
            </div>
            {emailError && (
              <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 font-medium mt-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {emailError}
              </p>
            )}
          </div>

          {/* Password Field with Show/Hide Toggle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Password <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setIsForgotPasswordOpen(true)}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors cursor-pointer"
              >
                Forgot Password?
              </button>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(null);
                }}
                className={`w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border transition-all duration-150 outline-none
                  bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500
                  ${
                    passwordError
                      ? "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-950/40"
                      : "border-slate-300 dark:border-zinc-700 hover:border-slate-400 dark:hover:border-zinc-600 focus:border-indigo-600 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950/40"
                  }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {passwordError && (
              <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 font-medium mt-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {passwordError}
              </p>
            )}
          </div>

          {/* Login Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-sm shadow-md shadow-indigo-600/20 hover:shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Logging in...</span>
                </>
              ) : (
                <span>Login</span>
              )}
            </button>
          </div>
        </form>

        {/* Create Account Link */}
        <div className="mt-8 pt-6 border-t border-slate-100 dark:border-zinc-800 text-center">
          <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
            >
              Create Account
            </Link>
          </p>
        </div>
      </div>

      {/* Forgot Password Modal */}
      <ForgotPasswordModal
        isOpen={isForgotPasswordOpen}
        onClose={() => setIsForgotPasswordOpen(false)}
        defaultEmail={email}
      />
    </>
  );
}

export const LoginForm: React.FC = () => {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-md mx-auto p-12 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto" />
        </div>
      }
    >
      <LoginFormInternal />
    </Suspense>
  );
};
