-- ============================================================
-- Migration 025: Add character_index column to teams table
-- ============================================================
-- Idempotently add character_index column for profile picture allocation
-- ============================================================

-- Step 1: Add the column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'teams' and column_name = 'character_index'
  ) then
    alter table public.teams add column character_index integer;
  end if;
end
$$;

-- Step 2: For teams without character_index, assign sequentially based on creation order
-- Teams get character_index 1-10 based on when they were created
do $$
declare
  v_updated integer := 0;
begin
  -- Assign character_index to all teams that don't have it set
  -- Using created_at for ordering, assign sequential indices (1-10, cycling)
  with ranked as (
    select id, 
           row_number() over (order by created_at asc) as rn
    from public.teams
    where character_index is null
  )
  update public.teams t
  set character_index = ((r.rn - 1) % 10) + 1
  from ranked r
  where t.id = r.id;
  
  get diagnostics v_updated = row_count;
  
  raise notice 'Updated character_index for % teams', v_updated;
end
$$;