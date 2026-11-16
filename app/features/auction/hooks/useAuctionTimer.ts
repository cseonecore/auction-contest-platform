"use client";

import { useState, useEffect, useRef } from "react";
import { calculateCountdown, formatMinSec } from "../utils/countdown";

export function useAuctionTimer(endTime: string | null | undefined, onExpire?: () => void) {
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [isExpired, setIsExpired] = useState<boolean>(true);
  const [isUrgent, setIsUrgent] = useState<boolean>(false);
  const [isCritical, setIsCritical] = useState<boolean>(false);
  const onExpireCalledRef = useRef<boolean>(false);

  useEffect(() => {
    onExpireCalledRef.current = false;

    if (!endTime) {
      setSecondsLeft(0);
      setIsExpired(true);
      setIsUrgent(false);
      setIsCritical(false);
      return;
    }

    const tick = () => {
      const countdown = calculateCountdown(endTime);
      setSecondsLeft(countdown.secondsLeft);
      setIsExpired(countdown.isExpired);
      setIsUrgent(countdown.isUrgent);
      setIsCritical(countdown.isCritical);

      if (countdown.isExpired) {
        if (!onExpireCalledRef.current && onExpire) {
          onExpireCalledRef.current = true;
          onExpire();
        }
      }
    };

    tick();
    const interval = setInterval(tick, 250);

    return () => clearInterval(interval);
  }, [endTime, onExpire]);

  return {
    secondsLeft,
    formatted: formatMinSec(secondsLeft),
    isExpired,
    isUrgent,
    isCritical,
  };
}
