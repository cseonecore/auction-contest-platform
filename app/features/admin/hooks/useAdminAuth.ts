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

export function useAdminAuth() {
  const [state, setState] = useState<AdminAuthState>({
    user: null,
    session: null,
    isAdmin: false,
    role: null,
    isLoading: true,
    error: null,
  });

  const refreshAuth = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        setState({
          user: null,
          session: null,
          isAdmin: false,
          role: null,
          isLoading: false,
          error: error.message,
        });
        return;
      }

      const user = session?.user ?? null;
      const role = (user?.app_metadata?.role as string) ?? null;
      const isAdmin = role === 'admin';

      setState({
        user,
        session,
        isAdmin,
        role,
        isLoading: false,
        error: null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to check authentication status';
      setState({
        user: null,
        session: null,
        isAdmin: false,
        role: null,
        isLoading: false,
        error: msg,
      });
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!isMounted) return;

        if (error) {
          setState({
            user: null,
            session: null,
            isAdmin: false,
            role: null,
            isLoading: false,
            error: error.message,
          });
          return;
        }

        const user = session?.user ?? null;
        const role = (user?.app_metadata?.role as string) ?? null;
        const isAdmin = role === 'admin';

        setState({
          user,
          session,
          isAdmin,
          role,
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Failed to check authentication status';
        setState({
          user: null,
          session: null,
          isAdmin: false,
          role: null,
          isLoading: false,
          error: msg,
        });
      }
    }

    void initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      const user = session?.user ?? null;
      const role = (user?.app_metadata?.role as string) ?? null;
      const isAdmin = role === 'admin';

      setState({
        user,
        session,
        isAdmin,
        role,
        isLoading: false,
        error: null,
      });
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return {
    ...state,
    refreshAuth,
    signIn: supabase.auth.signInWithPassword.bind(supabase.auth),
    signOut: supabase.auth.signOut.bind(supabase.auth),
  };
}
