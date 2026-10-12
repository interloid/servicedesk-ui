"use client";

import { useState } from "react";

/** A suggestion row under the keyboard (or mouse) highlight, and the rest. */
export const SUGGESTION_ACTIVE_CLASS =
  "bg-teal-50 text-teal-900 hover:bg-teal-50";
export const SUGGESTION_IDLE_CLASS = "hover:bg-teal-50";

const scrollIntoView = (el: HTMLElement | null) =>
  el?.scrollIntoView({ block: "nearest" });

/**
 * Arrow-key highlight for a suggestion list that stays under a text input
 * (the mention picker, tag suggestions): wraps at both ends, follows the
 * mouse, keeps the highlighted row scrolled into view, and clamps when the
 * list shrinks under it. The input keeps focus; Enter/Escape stay with the
 * caller, since what they do differs per list.
 */
export function useListNavigation(count: number) {
  const [index, setIndex] = useState(0);
  const active = count > 0 ? Math.min(index, count - 1) : 0;

  /** Handles ArrowUp/ArrowDown; true when the key was used. */
  const move = (key: string): boolean => {
    if (count === 0) return false;
    if (key === "ArrowDown") {
      setIndex((active + 1) % count);
      return true;
    }
    if (key === "ArrowUp") {
      setIndex((active - 1 + count) % count);
      return true;
    }
    return false;
  };

  /**
   * Spread onto each row. The rows are options (aria-selected is only valid
   * there), so the list around them should be role="listbox".
   */
  const itemProps = (idx: number) => ({
    role: "option" as const,
    "aria-selected": idx === active,
    onMouseEnter: () => setIndex(idx),
    ref: idx === active ? scrollIntoView : undefined,
    className: idx === active ? SUGGESTION_ACTIVE_CLASS : SUGGESTION_IDLE_CLASS,
  });

  return { index: active, setIndex, move, itemProps };
}
