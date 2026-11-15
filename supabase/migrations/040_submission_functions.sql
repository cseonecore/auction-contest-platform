-- Migration 040: Submission & Challenge Backend
-- ============================================================
-- Reserved range: 040–059 for submission work.
--
-- This migration adds:
--   1. live_url column to submissions table
--   2. UNIQUE constraint on (team_id, slot_id) for resubmission upserts
--   3. Submission deadline + challenge bonus settings
--   4. team_deadline(p_team_id) — authoritative deadline per team
--   5. submit_project(p_slot_id, p_repository_url, p_live_url) — captain submits
--   6. record_solve(p_team_id, p_problem_id) — service-role only
--   7. Column-level security to hide test_cases from the browser
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Extend the submissions table
-- ─────────────────────────────────────────────────────────────

-- Add a column for the deployed / live demo URL.
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS live_url text;

-- Enforce one submission row per (team, slot).
-- Resubmissions are rejected; this unique constraint also protects
-- against simultaneous duplicate submissions.
ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_team_slot_unique UNIQUE (team_id, slot_id);

-- Extend submissions status constraint to include evaluator statuses
-- (queued, running, scored, failed) alongside original (submitted, evaluating, evaluated, review)
ALTER TABLE public.submissions
  DROP CONSTRAINT IF EXISTS submissions_status_check;

ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_status_check
  CHECK (status in ('queued', 'running', 'scored', 'failed', 'submitted', 'evaluating', 'evaluated', 'review'));


-- ─────────────────────────────────────────────────────────────
-- 2. Settings for submission deadlines and challenge bonuses
--    Admin can change these in the settings table at any time.
-- ─────────────────────────────────────────────────────────────

-- Base deadline: the contest-wide submission cutoff.
-- Stored as a JSON string so it can be parsed as timestamptz.
-- Change this value to match your real contest schedule!
INSERT INTO public.settings (key, value)
VALUES (
  'submission_deadline',
  '"2026-11-16T18:00:00+05:30"'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- How many bonus minutes a team earns per challenge solve.
INSERT INTO public.settings (key, value)
VALUES ('challenge_bonus_minutes_per_solve', '10'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Maximum total bonus minutes a team can earn from solves.
INSERT INTO public.settings (key, value)
VALUES ('challenge_bonus_max_minutes', '60'::jsonb)
ON CONFLICT (key) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- 3. team_deadline(p_team_id)
--    The SINGLE SOURCE OF TRUTH for "when must this team submit?"
--    = base_deadline  +  (10 min × solves,  capped at 60 min)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.team_deadline(p_team_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base_deadline timestamptz;
  v_solve_count   integer;
  v_per_solve     integer;
  v_max_bonus     integer;
  v_bonus_minutes integer;
BEGIN
  -- ── 1. Authorize caller ────────────────────────────────────
  -- Authenticated callers can only view their own team's deadline.
  -- Admins, service role, or internal security definer callers may view any team.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND COALESCE(auth.role(), '') <> 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.teams t WHERE t.id = p_team_id AND t.captain_id = auth.uid()
      UNION
      SELECT 1 FROM public.members m WHERE m.team_id = p_team_id AND m.id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied: You can only view your own team deadline';
    END IF;
  END IF;

  -- ── 2. Read the contest-wide base deadline ─────────────────
  SELECT (s.value #>> '{}')::timestamptz
  INTO   v_base_deadline
  FROM   public.settings s
  WHERE  s.key = 'submission_deadline';

  IF v_base_deadline IS NULL THEN
    RAISE EXCEPTION 'Submission deadline not configured. '
                    'Add a settings row with key = submission_deadline.';
  END IF;

  -- Read bonus config (with safe defaults)
  SELECT coalesce((s.value #>> '{}')::integer, 10)
  INTO   v_per_solve
  FROM   public.settings s
  WHERE  s.key = 'challenge_bonus_minutes_per_solve';
  v_per_solve := coalesce(v_per_solve, 10);

  SELECT coalesce((s.value #>> '{}')::integer, 60)
  INTO   v_max_bonus
  FROM   public.settings s
  WHERE  s.key = 'challenge_bonus_max_minutes';
  v_max_bonus := coalesce(v_max_bonus, 60);

  -- Count how many challenge problems this team has solved
  SELECT count(*)::integer
  INTO   v_solve_count
  FROM   public.challenge_solves cs
  WHERE  cs.team_id = p_team_id;

  -- Each solve = v_per_solve minutes, total capped at v_max_bonus
  v_bonus_minutes := LEAST(v_solve_count * v_per_solve, v_max_bonus);

  RETURN v_base_deadline + make_interval(mins => v_bonus_minutes);
END;
$$;

REVOKE ALL ON FUNCTION public.team_deadline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_deadline(uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- 4. submit_project(p_slot_id, p_repository_url, p_live_url)
--    Called by the team captain from the browser.
--    Inserts one submission per (team, slot) with status 'queued'.
--    Resubmissions are strictly rejected: only one submission
--    per team per won slot is allowed.
--
--    NOTE ON VERIFICATION CHECKS:
--    This function enforces captain authorization, slot ownership,
--    server deadline, and non-empty URLs.
--    Deeper checks (repository accessibility / HTTP checks, commit-window
--    validation against contest times, and README content inspection)
--    and evaluation row creation/scoring belong to the AI evaluation service.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_project(
  p_slot_id        uuid,
  p_repository_url text,
  p_live_url       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id       uuid;
  v_team_id       uuid;
  v_slot          public.slots%ROWTYPE;
  v_deadline      timestamptz;
  v_submission_id uuid;
BEGIN
  -- ── 1. Authenticate ────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- ── 2. Caller must be a team captain ───────────────────────
  SELECT t.id
  INTO   v_team_id
  FROM   public.teams t
  WHERE  t.captain_id = v_user_id
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'Only the team captain can submit projects';
  END IF;

  -- ── 3. The slot must exist and be won by this team ─────────
  SELECT *
  INTO   v_slot
  FROM   public.slots
  WHERE  id = p_slot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot not found';
  END IF;

  IF v_slot.status <> 'sold' THEN
    RAISE EXCEPTION 'This slot has not been won yet (status: %)', v_slot.status;
  END IF;

  IF v_slot.winner_team_id <> v_team_id THEN
    RAISE EXCEPTION 'Your team did not win this slot';
  END IF;

  -- ── 4. Server-authoritative deadline check ─────────────────
  v_deadline := public.team_deadline(v_team_id);

  IF clock_timestamp() > v_deadline THEN
    RAISE EXCEPTION 'Submission deadline has passed (deadline: %)', v_deadline;
  END IF;

  -- ── 5. Validate inputs (Rule Book §6 requirement) ─────────
  IF p_repository_url IS NULL OR trim(p_repository_url) = '' THEN
    RAISE EXCEPTION 'Repository URL is required';
  END IF;

  IF p_live_url IS NULL OR trim(p_live_url) = '' THEN
    RAISE EXCEPTION 'Live URL or APK link is required (Rule Book §6)';
  END IF;

  -- ── 6. Enforce single submission per slot (no resubmissions) 
  IF EXISTS (
    SELECT 1 FROM public.submissions
    WHERE team_id = v_team_id AND slot_id = p_slot_id
  ) THEN
    RAISE EXCEPTION 'A project has already been submitted for this slot. Resubmission is not permitted.';
  END IF;

  -- ── 7. Insert submission ──────────────────────────────────
  --    The UNIQUE (team_id, slot_id) constraint protects against simultaneous duplicate submissions.
  --    If a concurrent request collides on the unique constraint, catch it and raise the same error.
  --    Sets status to 'queued' for the evaluation worker.
  BEGIN
    INSERT INTO public.submissions (
      team_id, slot_id, repository_url, live_url,
      submitted_by, submitted_at, status
    )
    VALUES (
      v_team_id,
      p_slot_id,
      trim(p_repository_url),
      trim(p_live_url),
      v_user_id,
      clock_timestamp(),
      'queued'
    )
    RETURNING id INTO v_submission_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'A project has already been submitted for this slot. Resubmission is not permitted.';
  END;

  -- ── 8. Audit log ──────────────────────────────────────────
  INSERT INTO public.audit_log (
    actor_id, actor_team_id, action,
    entity_type, entity_id, details
  )
  VALUES (
    v_user_id,
    v_team_id,
    'project_submitted',
    'submission',
    v_submission_id,
    jsonb_build_object(
      'slot_id',        p_slot_id,
      'repository_url', trim(p_repository_url),
      'live_url',       trim(p_live_url),
      'status',         'queued',
      'deadline',       v_deadline
    )
  );

  -- ── 9. Return result ──────────────────────────────────────
  RETURN jsonb_build_object(
    'success',       true,
    'submission_id', v_submission_id,
    'slot_id',       p_slot_id,
    'team_id',       v_team_id,
    'status',        'queued',
    'deadline',      v_deadline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_project(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_project(uuid, text, text) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- 5. record_solve(p_team_id, p_problem_id)
--    *** SERVICE ROLE ONLY — NOT callable from the browser. ***
--    Called by the judge backend after ALL hidden tests pass.
--    Each solve earns 10 min bonus time, capped at 60 min total.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_solve(
  p_team_id    uuid,
  p_problem_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_solve_count  integer;
  v_max_solves   integer;
  v_per_solve    integer;
  v_max_bonus    integer;
  v_solve_id     uuid;
  v_new_deadline timestamptz;
BEGIN
  -- Read bonus config
  SELECT coalesce((s.value #>> '{}')::integer, 10)
  INTO   v_per_solve
  FROM   public.settings s
  WHERE  s.key = 'challenge_bonus_minutes_per_solve';
  v_per_solve := coalesce(v_per_solve, 10);

  SELECT coalesce((s.value #>> '{}')::integer, 60)
  INTO   v_max_bonus
  FROM   public.settings s
  WHERE  s.key = 'challenge_bonus_max_minutes';
  v_max_bonus := coalesce(v_max_bonus, 60);

  -- How many solves yield new bonus time?  60 / 10 = 6.
  v_max_solves := v_max_bonus / v_per_solve;

  -- Current solve count for this team
  SELECT count(*)::integer
  INTO   v_solve_count
  FROM   public.challenge_solves
  WHERE  team_id = p_team_id;

  -- Cap reached?
  IF v_solve_count >= v_max_solves THEN
    RETURN jsonb_build_object(
      'success',     false,
      'reason',      format(
        'Team already has %s solves (%s-minute bonus cap reached)',
        v_max_solves, v_max_bonus
      ),
      'solve_count', v_solve_count
    );
  END IF;

  -- Already solved this specific problem?
  IF EXISTS (
    SELECT 1 FROM public.challenge_solves
    WHERE team_id = p_team_id AND problem_id = p_problem_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'This problem was already solved by this team'
    );
  END IF;

  -- Validate FK targets exist
  IF NOT EXISTS (SELECT 1 FROM public.challenge_problems WHERE id = p_problem_id) THEN
    RAISE EXCEPTION 'Challenge problem not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id) THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  -- Insert the solve record
  INSERT INTO public.challenge_solves (team_id, problem_id)
  VALUES (p_team_id, p_problem_id)
  RETURNING id INTO v_solve_id;

  -- Calculate updated deadline
  v_new_deadline := public.team_deadline(p_team_id);

  -- Audit
  INSERT INTO public.audit_log (
    actor_team_id, action, entity_type, entity_id, details
  )
  VALUES (
    p_team_id,
    'challenge_solved',
    'challenge_solve',
    v_solve_id,
    jsonb_build_object(
      'problem_id',    p_problem_id,
      'solve_number',  v_solve_count + 1,
      'new_deadline',  v_new_deadline,
      'bonus_minutes', LEAST((v_solve_count + 1) * v_per_solve, v_max_bonus)
    )
  );

  RETURN jsonb_build_object(
    'success',       true,
    'solve_id',      v_solve_id,
    'solve_number',  v_solve_count + 1,
    'bonus_minutes', LEAST((v_solve_count + 1) * v_per_solve, v_max_bonus),
    'new_deadline',  v_new_deadline
  );
END;
$$;

-- CRITICAL SECURITY: browser users (authenticated role) must NEVER call this.
-- Only the service_role (trusted judge backend) can execute it.
REVOKE ALL ON FUNCTION public.record_solve(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_solve(uuid, uuid) FROM authenticated;
-- service_role inherits from the function owner (postgres) and can still call it.


-- ─────────────────────────────────────────────────────────────
-- 6. Hide test_cases from browser users
--    Revoke table-level access from anon, authenticated, and public.
--    Grant authenticated only the safe non-sensitive columns.
--    The service role (judge backend) bypasses RLS and column grants
--    to read test_cases for server-side evaluation.
-- ─────────────────────────────────────────────────────────────

REVOKE ALL ON public.challenge_problems FROM anon;
REVOKE ALL ON public.challenge_problems FROM authenticated;
REVOKE ALL ON public.challenge_problems FROM PUBLIC;

GRANT SELECT (id, topic_id, title, description, difficulty, points, created_at)
  ON public.challenge_problems TO authenticated;

