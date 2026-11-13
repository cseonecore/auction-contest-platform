
-- Migration 002: Remaining contest tables

create table public.challenge_problems (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  title text not null,
  description text not null,
  difficulty text not null default 'easy'
    check (difficulty in ('easy', 'medium', 'hard')),
  test_cases jsonb not null default '[]'::jsonb,
  points integer not null default 0 check (points >= 0),
  created_at timestamptz not null default now()
);

create table public.challenge_solves (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  problem_id uuid not null references public.challenge_problems(id) on delete cascade,
  solved_at timestamptz not null default now(),
  unique (team_id, problem_id)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  slot_id uuid not null references public.slots(id),
  repository_url text,
  submitted_by uuid,
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted'
    check (status in ('submitted', 'evaluating', 'evaluated', 'review'))
);

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  score numeric(6,2) not null default 0 check (score >= 0),
  report jsonb not null default '{}'::jsonb,
  evaluator_version text,
  evaluated_at timestamptz not null default now(),
  status text not null default 'completed'
    check (status in ('queued', 'running', 'completed', 'failed', 'review'))
);

create table public.eval_updates (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_team_id uuid references public.teams(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Helpful indexes
create index idx_challenge_problems_topic
  on public.challenge_problems(topic_id);

create index idx_challenge_solves_team
  on public.challenge_solves(team_id);

create index idx_submissions_team
  on public.submissions(team_id);

create index idx_submissions_slot
  on public.submissions(slot_id);

create index idx_eval_updates_evaluation
  on public.eval_updates(evaluation_id);

create index idx_audit_log_created_at
  on public.audit_log(created_at desc);
