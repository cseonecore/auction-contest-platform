
-- Migration 003: Enable Row Level Security

alter table public.settings enable row level security;
alter table public.teams enable row level security;
alter table public.members enable row level security;
alter table public.topics enable row level security;
alter table public.slots enable row level security;
alter table public.wallets enable row level security;
alter table public.bids enable row level security;
alter table public.challenge_problems enable row level security;
alter table public.challenge_solves enable row level security;
alter table public.submissions enable row level security;
alter table public.evaluations enable row level security;
alter table public.eval_updates enable row level security;
alter table public.audit_log enable row level security;
