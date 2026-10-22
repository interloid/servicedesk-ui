"use client";

import { useEffect, useRef } from "react";

/**
 * True when a key press belongs to whatever has focus: a text field, a
 * contenteditable, an open dialog / menu / listbox, or a combobox / grid
 * (their own keys -- typeahead, arrows -- must not trigger page shortcuts
 * behind them; a closed Radix Select trigger is a combobox that picks the
 * first option starting with the letter typed).
 */
export function isShortcutBlocked(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;

  const target = event.target as HTMLElement | null;
  if (!target) return false;

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.closest(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"], [role="grid"]',
    ) !== null
  );
}

/**
 * Runs `handler` when the single key `key` (case-insensitive) is pressed
 * outside a text field or open popup. See the Keyboard shortcuts modal for
 * the list. A handler that returns `false` had nothing to do, so the key
 * keeps its default action.
 */
export function useKeyboardShortcut(
  key: string,
  handler: (event: KeyboardEvent) => void | boolean,
  enabled = true,
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isShortcutBlocked(event)) return;
      if (event.key.toLowerCase() !== key.toLowerCase()) return;

      if (handlerRef.current(event) !== false) event.preventDefault();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [key, enabled]);
}
