"use client";

import { useEffect, useState } from "react";

/**
 * The current time, re-read every `intervalMs` while `enabled`. Keep it in the
 * smallest component that shows a countdown, so the tick re-renders that and
 * not the page around it.
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);

  return now;
}
