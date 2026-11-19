"use client";

/**
 * Server-authoritative countdown.
 *
 * The database owns the deadline (`slots.end_time`). The browser only
 * *displays* the remaining time: it never decides that the auction is
 * over. When the countdown reaches zero the hook asks the backend to
 * refresh the state; the backend decides whether the item closed.
 */

import { useEffect, useRef, useState } from "react";

export interface CountdownState {
  secondsLeft: number;
  isExpired: boolean;
  isUrgent: boolean;
  isCritical: boolean;
}

const URGENT_THRESHOLD_SECONDS = 5;
const CRITICAL_THRESHOLD_SECONDS = 3;

/**
 * Calculates the remaining seconds from an absolute deadline.
 *
 * `serverOffsetMs` compensates for the difference between the server
 * clock and the browser clock, so a participant with a wrong device
 * clock still sees the correct remaining time.
 */
export function calculateRemaining(
  endTime: string | null | undefined,
  serverOffsetMs = 0
): CountdownState {
  if (!endTime) {
    return {
      secondsLeft: 0,
      isExpired: true,
      isUrgent: false,
      isCritical: false,
    };
  }

  const endMs = new Date(endTime).getTime();
  const nowMs = Date.now() - serverOffsetMs;
  const diffMs = endMs - nowMs;

  if (diffMs <= 0) {
    return {
      secondsLeft: 0,
      isExpired: true,
      isUrgent: false,
      isCritical: false,
    };
  }

  const secondsLeft = Math.ceil(diffMs / 1000);

  return {
    secondsLeft,
    isExpired: false,
    isUrgent: secondsLeft <= URGENT_THRESHOLD_SECONDS,
    isCritical: secondsLeft <= CRITICAL_THRESHOLD_SECONDS,
  };
}

interface UseAuctionTimerOptions {
  /** Absolute deadline (ISO string) from the database. */
  endTime: string | null | undefined;
  /** Server clock, used to correct for device clock drift. */
  serverTime?: string | null;
  /** True while the backend says the clock is running. */
  running?: boolean;
  /** True while the backend has the clock paused. */
  paused?: boolean;
  /** Remaining seconds frozen by a pause. */
  pausedRemainingSeconds?: number;
  /** Called once when the countdown reaches zero. */
  onExpire?: () => void;
}

export function useAuctionTimer({
  endTime,
  serverTime,
  running = true,
  paused = false,
  pausedRemainingSeconds = 0,
  onExpire,
}: UseAuctionTimerOptions) {
  const [countdown, setCountdown] = useState<CountdownState>(() =>
    calculateRemaining(endTime)
  );
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const expireCalledRef = useRef(false);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  // Offset between the server clock and the browser clock, measured
  // once per server timestamp so a wrong device clock cannot make the
  // countdown wrong.
  useEffect(() => {
    if (!serverTime) {
      setServerOffsetMs(0);
      return;
    }

    const parsed = new Date(serverTime).getTime();
    if (Number.isNaN(parsed)) {
      setServerOffsetMs(0);
      return;
    }

    setServerOffsetMs(Date.now() - parsed);
  }, [serverTime]);

  useEffect(() => {
    expireCalledRef.current = false;
  }, [endTime]);

  useEffect(() => {
    if (paused) {
      setCountdown({
        secondsLeft: Math.max(0, pausedRemainingSeconds),
        isExpired: false,
        isUrgent: false,
        isCritical: false,
      });
      return;
    }

    if (!running || !endTime) {
      setCountdown({
        secondsLeft: 0,
        isExpired: !paused,
        isUrgent: false,
        isCritical: false,
      });
      return;
    }

    const tick = () => {
      const next = calculateRemaining(endTime, serverOffsetMs);
      setCountdown(next);

      if (next.isExpired && !expireCalledRef.current) {
        expireCalledRef.current = true;
        // The backend decides what an expired timer means — the client
        // only asks it to refresh the authoritative state.
        onExpireRef.current?.();
      }
    };

    tick();
    const interval = setInterval(tick, 250);

    return () => clearInterval(interval);
  }, [endTime, running, paused, pausedRemainingSeconds, serverOffsetMs]);

  return countdown;
}
