
-- Migration 004: RLS policies for Bid2Build
-- Authentication: Supabase Auth UUID = members.id
-- Admin: auth.jwt() -> app_metadata -> role = 'admin'
-- Service role: trusted backend/evaluator; bypasses RLS

-- --------------------------------------------------
-- 1. Helper functions
-- --------------------------------------------------

create or replace function public.current_team_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.team_id
  from public.members m
  where m.id = (select auth.uid())
  limit 1;
$$;

create or replace function public.is_team_captain()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teams t
    where t.id = public.current_team_id()
      and t.captain_id = (select auth.uid())
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- --------------------------------------------------
-- 2. Settings
-- Admin only. Public settings can be exposed later
-- through a safe server-side endpoint if needed.
-- --------------------------------------------------

create policy "Admins manage settings"
on public.settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 3. Teams
-- Members can view their own team.
-- Admins can manage all teams.
-- --------------------------------------------------

create policy "Members view own team"
on public.teams
for select
to authenticated
using (
  id = public.current_team_id()
  or public.is_admin()
);

create policy "Admins manage teams"
on public.teams
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 4. Members
-- Team members can view teammates.
-- Admins manage all members.
-- --------------------------------------------------

create policy "Members view teammates"
on public.members
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

create policy "Admins manage members"
on public.members
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 5. Topics
-- Authenticated users can view topics.
-- Admins manage topics.
-- --------------------------------------------------

create policy "Authenticated view topics"
on public.topics
for select
to authenticated
using (true);

create policy "Admins manage topics"
on public.topics
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 6. Slots
-- Authenticated users can view auction slots.
-- Admins manage slots.
-- --------------------------------------------------

create policy "Authenticated view slots"
on public.slots
for select
to authenticated
using (true);

create policy "Admins manage slots"
on public.slots
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 7. Wallets
-- Teams view their own wallets.
-- Admins manage wallets.
-- --------------------------------------------------

create policy "Teams view own wallets"
on public.wallets
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

create policy "Admins manage wallets"
on public.wallets
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 8. Bids
-- Authenticated teams can view auction bids.
-- Bid insertion will happen through place_bid RPC.
-- Admins manage bids.
-- --------------------------------------------------

create policy "Authenticated view bids"
on public.bids
for select
to authenticated
using (true);

create policy "Admins manage bids"
on public.bids
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 9. Challenge problems
-- Authenticated users view problems.
-- Admins manage problems.
-- --------------------------------------------------

create policy "Authenticated view problems"
on public.challenge_problems
for select
to authenticated
using (true);

create policy "Admins manage problems"
on public.challenge_problems
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 10. Challenge solves
-- Teams view their own solves.
-- Evaluator writes through trusted backend.
-- Admins can manage all solves.
-- --------------------------------------------------

create policy "Teams view own solves"
on public.challenge_solves
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

create policy "Admins manage solves"
on public.challenge_solves
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 11. Submissions
-- Teams view their own submissions.
-- Captains can submit through trusted RPC/backend.
-- Admins manage submissions.
-- --------------------------------------------------

create policy "Teams view own submissions"
on public.submissions
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

create policy "Admins manage submissions"
on public.submissions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 12. Evaluations
-- Teams view evaluations for their submissions.
-- Evaluator service writes using service role.
-- Admins manage evaluations.
-- --------------------------------------------------

create policy "Teams view own evaluations"
on public.evaluations
for select
to authenticated
using (
  exists (
    select 1
    from public.submissions s
    where s.id = evaluations.submission_id
      and s.team_id = public.current_team_id()
  )
  or public.is_admin()
);

create policy "Admins manage evaluations"
on public.evaluations
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 13. Evaluation updates
-- Teams view updates for their own evaluations.
-- Evaluator service writes using service role.
-- Admins manage updates.
-- --------------------------------------------------

create policy "Teams view own evaluation updates"
on public.eval_updates
for select
to authenticated
using (
  exists (
    select 1
    from public.evaluations e
    join public.submissions s
      on s.id = e.submission_id
    where e.id = eval_updates.evaluation_id
      and s.team_id = public.current_team_id()
  )
  or public.is_admin()
);

create policy "Admins manage evaluation updates"
on public.eval_updates
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- --------------------------------------------------
-- 14. Audit log
-- Admins can read audit records.
-- Trusted backend writes audit records.
-- --------------------------------------------------

create policy "Admins view audit log"
on public.audit_log
for select
to authenticated
using (public.is_admin());

-- --------------------------------------------------
-- 15. Restrict helper function execution
-- --------------------------------------------------

revoke all on function public.current_team_id() from public;
revoke all on function public.is_team_captain() from public;
revoke all on function public.is_admin() from public;

grant execute on function public.current_team_id() to authenticated;
grant execute on function public.is_team_captain() to authenticated;
grant execute on function public.is_admin() to authenticated;
