-- Migration 039:
--   Team size is now 3–4 members (previously 2–3).
--   Updates the enforce_team_member_limit trigger to allow up to 4 members.
--
--   SAFE:
--     * Does NOT delete or trim any existing team members.
--     * Does NOT modify the captain phone logic.
--     * Only changes the INSERT guard from "count >= 3" to "count >= 4".
--
-- Run once in the Supabase SQL editor or via `supabase db push`.
-- Safe to re-run.

begin;

-- ═══════════════════════════════════════════════════════════════════
-- 1 · Update the per-team member cap from 3 → 4
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.enforce_team_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Serialise concurrent inserts for the same team so two requests cannot
  -- both observe "3 members" and each add a 5th.
  perform pg_advisory_xact_lock(hashtext(NEW.team_id::text)::bigint);

  select count(*)
  into v_count
  from public.members
  where team_id = NEW.team_id;

  if v_count >= 4 then
    raise exception 'A team can have at most 4 members (the captain plus up to three teammates).';
  end if;

  return NEW;
end;
$$;

-- Re-create the trigger (function replace is enough; DROP+CREATE for clarity)
drop trigger if exists enforce_team_member_limit on public.members;
create trigger enforce_team_member_limit
before insert on public.members
for each row
execute function public.enforce_team_member_limit();

commit;
