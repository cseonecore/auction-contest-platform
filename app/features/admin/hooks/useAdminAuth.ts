'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

export interface AdminAuthState {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  role: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface AdminSignInResult {
  data: { user: User | null; session: Session | null };
  error: { message: string } | null;
}

const SIGNED_OUT_STATE: AdminAuthState = {
  user: null,
  session: null,
  isAdmin: false,
  role: null,
  isLoading: false,
  error: null,
};

function stateFromSession(session: Session | null): AdminAuthState {
  const user = session?.user ?? null;
  const role = (user?.app_metadata?.role as string) ?? null;

  return {
    user,
    session,
    isAdmin: role === 'admin',
    role,
    isLoading: false,
    error: null,
  };
}

function isNetworkError(message: string): boolean {
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(
    message
  );
}

export function useAdminAuth() {
  const [state, setState] = useState<AdminAuthState>({
    user: null,
    session: null,
    isAdmin: false,
    role: null,
    isLoading: true,
    error: null,
  });

  /**
   * Reads the locally stored session. `getSession()` only touches the
   * network when a stored access token needs refreshing; if that refresh
   * fails (offline, blocked network, revoked token) the SDK surfaces a
   * raw "Failed to fetch". Treat that as "signed out" and clear the stale
   * session instead of blocking the whole admin console behind an
   * opaque error banner.
   */
  const readSession = useCallback(async (): Promise<AdminAuthState> => {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (!error) return stateFromSession(session);

    if (isNetworkError(error.message)) {
      console.warn('[AdminAuth] Session refresh failed:', error.message);
    } else {
      console.warn('[AdminAuth] Stored session rejected:', error.message);
    }

    // Drop the unusable stored session so the sign-in form can be used.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return { ...SIGNED_OUT_STATE };
  }, []);

  const refreshAuth = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      setState(await readSession());
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to check authentication status';
      setState({
        ...SIGNED_OUT_STATE,
        error: isNetworkError(msg)
          ? 'Could not verify the saved session. Please sign in again.'
          : msg,
      });
    }
  }, [readSession]);

  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      try {
        const next = await readSession();
        if (isMounted) setState(next);
      } catch (err: unknown) {
        if (!isMounted) return;
        const msg =
          err instanceof Error ? err.message : 'Failed to check authentication status';
        setState({
          ...SIGNED_OUT_STATE,
          error: isNetworkError(msg)
            ? 'Could not verify the saved session. Please sign in again.'
            : msg,
        });
      }
    }

    void initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setState(stateFromSession(session));
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [readSession]);

  /**
   * Signs in through `/api/admin/login` rather than calling the Supabase
   * auth endpoint from the browser. The server verifies the password and
   * the `admin` role, then the browser adopts the returned tokens. This
   * avoids the browser-only "Failed to fetch" failure mode and prevents
   * non-admin accounts from ever receiving a session here.
   */
  const signIn = useCallback(
    async (credentials: { email: string; password: string }): Promise<AdminSignInResult> => {
      try {
        const response = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              session?: { access_token: string; refresh_token: string };
              error?: string;
            }
          | null;

        if (!response.ok || !payload?.session) {
          return {
            data: { user: null, session: null },
            error: {
              message:
                payload?.error ||
                `Admin sign-in failed (HTTP ${response.status}). Please try again.`,
            },
          };
        }

        const { data, error } = await supabase.auth.setSession({
          access_token: payload.session.access_token,
          refresh_token: payload.session.refresh_token,
        });

        if (error) {
          return {
            data: { user: null, session: null },
            error: {
              message: isNetworkError(error.message)
                ? 'Signed in, but the browser could not confirm the session. Check your connection and try again.'
                : error.message,
            },
          };
        }

        return {
          data: { user: data.user ?? null, session: data.session ?? null },
          error: null,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        return {
          data: { user: null, session: null },
          error: {
            message: isNetworkError(message)
              ? 'Could not reach the admin authentication service. Check your connection and try again.'
              : message || 'Admin sign-in failed. Please try again.',
          },
        };
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    try {
      // Local scope clears the browser session even when the auth server
      // is unreachable, so the admin can always get back to the form.
      return await supabase.auth.signOut({ scope: 'local' });
    } catch (err: unknown) {
      return {
        error: err instanceof Error ? err : new Error('Sign out failed'),
      };
    } finally {
      setState({ ...SIGNED_OUT_STATE });
    }
  }, []);

  return {
    ...state,
    refreshAuth,
    signIn,
    signOut,
  };
}
