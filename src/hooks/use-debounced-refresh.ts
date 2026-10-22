"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

/** Quiet time before a refresh, so a burst of changes is one refresh. */
const DEBOUNCE_MS = 400;
/** A steady stream of changes still refreshes at least this often. */
const MAX_WAIT_MS = 2000;

export type DebouncedRefresh = {
  /** Queue a refresh: debounced, but never more than MAX_WAIT_MS late. */
  schedule: () => void;
  /** Refresh now, dropping anything queued. */
  fire: () => void;
  /** Drop anything queued without refreshing. */
  cancel: () => void;
};

/**
 * Wraps `refresh` in the debounce. Module scope, so its timer is plain
 * closure state rather than something a render owns.
 */
function createDebouncedRefresh(refresh: () => void): DebouncedRefresh {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstQueuedAt: number | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    firstQueuedAt = null;
  };

  const fire = () => {
    cancel();
    refresh();
  };

  // Debounced, but never more than MAX_WAIT_MS after the first change
  // queued, so a steady stream can't starve the refresh.
  const schedule = () => {
    const now = Date.now();
    firstQueuedAt ??= now;
    if (timer) clearTimeout(timer);
    const wait = Math.max(
      0,
      Math.min(DEBOUNCE_MS, firstQueuedAt + MAX_WAIT_MS - now),
    );
    timer = setTimeout(fire, wait);
  };

  return { schedule, fire, cancel };
}

/**
 * A debounced `router.refresh()` for realtime listeners: a reply and its
 * attachments, or a bulk update, re-read the server-rendered page once. The
 * returned functions are stable, so they can sit in an effect's listeners.
 */
export function useDebouncedRefresh(): DebouncedRefresh {
  const router = useRouter();

  const debounced = useMemo(
    () => createDebouncedRefresh(() => router.refresh()),
    [router],
  );

  useEffect(() => debounced.cancel, [debounced]);

  return debounced;
}
