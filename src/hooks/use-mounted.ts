"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during the server render and hydration, true once in the browser.
 * Gate text that depends on the viewer's clock or time zone behind it: with
 * suppressHydrationWarning React keeps the server's text, so a time formatted
 * on a UTC server would otherwise stay on screen.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
