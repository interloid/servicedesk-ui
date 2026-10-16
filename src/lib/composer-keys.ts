import type { ClipboardEvent, KeyboardEvent } from "react";

/**
 * Chat composer keys, shared by the agent thread and the customer portal:
 *
 *   Enter          send
 *   Shift+Enter    new line
 *   Ctrl/⌘+Enter   send (also on touch screens)
 *
 * Tab, Ctrl+A, Ctrl+Z and Ctrl+V for text are the textarea's own.
 *
 * On a touch screen plain Enter is a new line: the on-screen keyboard has no
 * Shift+Enter, and the Send button is right there. Enter that confirms an IME
 * composition (Japanese, Chinese, ...) never sends.
 */
export function isComposerSendKey(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return false;
  if (event.ctrlKey || event.metaKey) return true;
  if (event.shiftKey || event.altKey) return false;
  return !isCoarsePointer();
}

function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true
  );
}

/**
 * Files pasted into a composer (a screenshot, files copied in the file
 * manager), or [] for an ordinary text paste. When the clipboard carries text
 * as well -- copying from Word or a web page also puts a picture of it there
 * -- it is a text paste, and the browser is left to paste the text.
 */
export function pastedFiles(event: ClipboardEvent<HTMLElement>): File[] {
  const data = event.clipboardData;
  if (!data || data.files.length === 0) return [];
  if (data.getData("text/plain").trim()) return [];
  return Array.from(data.files);
}
