-- Migration 010: Single-device session enforcement
-- ============================================================
-- Tracks active authenticated sessions per user to prevent
-- simultaneous logins on multiple devices.
-- Enforced server-side; frontend restrictions are supplementary.
-- ============================================================

-- 1. Create the active_sessions table
-- Stores the session identifier per authenticated user.
-- The UNIQUE constraint on user_id ensures only one active session per account.
create table if not exists public.active_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null, -- Supabase session identifier
  created_at timestamptz not null default now(),
  constraint uq_active_sessions_user unique (user_id)
);

-- 2. Index for session lookups
create index if not exists idx_active_sessions_user
  on public.active_sessions(user_id);

-- 3. RLS: Enable row level security on active_sessions
alter table public.active_sessions enable row level security;

-- 4. RLS Policy: Authenticated users can view their own active session
create policy "Users view own active session"
on public.active_sessions
for select
to authenticated
using (user_id = auth.uid());

-- 5. RLS Policy: Service role can manage all sessions (bypass RLS)
create policy "Service role manage sessions"
on public.active_sessions
for all
to service_role
using (true)
with check (true);

-- 6. RPC: check_session_active
-- Checks if the current user already has an active session.
-- Returns false if another device is already logged in (active session exists).
-- Returns true if no active session exists (new login allowed).
-- Note: called BEFORE login to check for existing sessions.
-- If auth.uid() is null (user not logged in), returns true to allow login.
create or replace function public.check_session_active()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_session_count integer;
begin
  v_user_id := auth.uid();

  -- If user is not logged in (no session), allow the login attempt
  if v_user_id is null then
    return true;
  end if;

  -- Check if there's an existing active session for this user
  select count(*) into v_session_count
  from public.active_sessions
  where user_id = v_user_id;

  if v_session_count > 0 then
    -- Another device is already logged in
    return false;
  end if;

  -- No active session; allow new login
  return true;
end;
$$;

-- 7. RPC: mark_session_active
-- Marks the current session as active for the authenticated user.
-- Called AFTER successful login to establish the new active session.
-- Overwrites any previous session record (the new login wins).
create or replace function public.mark_session_active()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return false;
  end if;

  -- Insert or overwrite the active session record for this user
  -- Use a unique session identifier based on userId and timestamp
  insert into public.active_sessions (user_id, session_id)
  values (v_user_id, concat('session_', v_user_id, '_', extract(epoch from now())))
  on conflict (user_id) do update
  set session_id = concat('session_', v_user_id, '_', extract(epoch from now())),
      created_at = now();

  return true;
end;
$$;

-- 8. RPC: invalidate_current_session
-- Invalidates the current session (e.g., on logout).
-- Removes the session record so the user must re-authenticate.
create or replace function public.invalidate_current_session()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return false;
  end if;

  delete from public.active_sessions
  where user_id = v_user_id;

  return true;
end;
$$;

-- 9. Grant execute permissions to authenticated users
grant execute on function public.check_session_active() to authenticated;
grant execute on function public.mark_session_active() to authenticated;
grant execute on function public.invalidate_current_session() to authenticated;