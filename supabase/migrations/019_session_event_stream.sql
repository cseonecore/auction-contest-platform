-- ============================================================
-- Migration 019: Session lifecycle event stream
-- ============================================================
-- The participant arena reconciles from INSERT events on
-- public.auction_events (migration 016). Slot, bid, wallet, bonus
-- and elimination changes all publish events, but the SESSION state
-- machine did not: start / end / pause / resume / reset were silent.
-- A participant watching the event stream could therefore never
-- observe a session restart (Stop → Start) or a pause through
-- realtime alone.
--
-- This migration adds an AFTER trigger on public.auction_sessions
-- that publishes, through the existing public.emit_auction_event():
--
--     session_started   a session row is created (Start)
--     session_ended     a session transitions to 'completed' (Stop)
--     auction_paused    is_paused false → true
--     auction_resumed   is_paused true → false
--     auction_reset     an active session is cancelled by a reset
--
-- It introduces no new tables, no new RPCs and changes no rules.
-- Idempotent: safe to re-run.
-- ============================================================

create or replace function public.trg_auction_sessions_emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ── INSERT: a new session was created (start_auction) ───────
  if (tg_op = 'INSERT') then
    perform public.emit_auction_event(
      'session_started',
      null,
      null,
      jsonb_build_object(
        'session_id', new.id,
        'status',     new.status,
        'round',      new.round,
        'is_paused',  new.is_paused
      )
    );
    return new;
  end if;

  -- ── UPDATE: session completed (end_auction_session / Stop) ──
  if new.status = 'completed' and old.status <> 'completed' then
    perform public.emit_auction_event(
      'session_ended',
      null,
      null,
      jsonb_build_object(
        'session_id',      new.id,
        'round',           new.round,
        'previous_status', old.status,
        'ended_at',        new.ended_at
      )
    );
  end if;

  -- ── UPDATE: an active session was cancelled (reset_auction) ─
  if new.status = 'cancelled'
     and old.status in ('ready','question_selection','bidding_open','bidding_closed',
                        'finalizing','question_assigned','solving') then
    perform public.emit_auction_event(
      'auction_reset',
      null,
      null,
      jsonb_build_object(
        'session_id',      new.id,
        'previous_status', old.status
      )
    );
  end if;

  -- ── UPDATE: pause / resume ──────────────────────────────────
  if new.is_paused is distinct from old.is_paused then
    perform public.emit_auction_event(
      case when new.is_paused then 'auction_paused' else 'auction_resumed' end,
      null,
      null,
      jsonb_build_object(
        'session_id', new.id,
        'is_paused',  new.is_paused
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auction_sessions_emit_event on public.auction_sessions;
create trigger trg_auction_sessions_emit_event
  after insert or update of status, is_paused on public.auction_sessions
  for each row execute function public.trg_auction_sessions_emit_event();

comment on function public.trg_auction_sessions_emit_event() is
  'Publishes session lifecycle changes (start / end / pause / resume / '
  'reset) to the public.auction_events stream via emit_auction_event().';
