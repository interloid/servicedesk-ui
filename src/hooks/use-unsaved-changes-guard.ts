"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** `pendingHref` while the browser's Back button is being held. */
const BACK = "__back__";

/**
 * The guard on screen, if any. One form page is open at a time, so a single
 * slot is enough; it is set only while that form has unsaved changes.
 */
let activeGuard: ((href: string) => void) | null = null;

/**
 * For code that navigates with `router.push` (keyboard shortcuts, header
 * search, the notification bell): true to go ahead, false when a form has
 * unsaved changes, in which case its "Leave without saving?" popup is open
 * and "Leave" goes to `href`.
 */
export function confirmNavigation(href: string): boolean {
  if (!activeGuard) return true;
  activeGuard(href);
  return false;
}

/**
 * Asks before leaving a form with unsaved changes.
 *
 * - Refresh, close tab or typing a new URL: the browser's own "Leave site?"
 *   prompt (browsers don't allow a custom popup there).
 * - Clicking any in-app link (sidebar, header, back link, Cancel), or an
 *   in-app `router.push` that asks `confirmNavigation` first: the move is held
 *   and `pendingHref` is set, so the page can show its own confirm popup;
 *   `leave()` then goes there, `stay()` drops it.
 * - The browser's Back button: a copy of the current history entry is pushed
 *   while the form is dirty, so Back lands on the same page and is held the
 *   same way.
 *
 * Programmatic `router.push` (e.g. after a successful save) is not blocked.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  // Set by leave() going back, so that popstate isn't held a second time.
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers only prompt when returnValue is set.
      e.returnValue = "";
    };

    // Capture phase on document runs before Next's <Link> handler (React
    // listens on the app root), so stopping it here keeps the page in place.
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same page (e.g. an in-page #anchor): nothing is lost.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;

      e.preventDefault();
      e.stopPropagation();
      setPendingHref(url.pathname + url.search + url.hash);
    };

    // The extra entry carries Next's own state (__NA and the route tree), so
    // the router passes it through untouched, and popping back to the entry
    // below restores the same tree: the form stays mounted, edits and all.
    const guardedUrl = window.location.href;
    if (!window.history.state?.unsavedGuard) {
      window.history.pushState(
        { ...window.history.state, unsavedGuard: true },
        "",
        guardedUrl,
      );
    }

    const onPopState = () => {
      if (leavingRef.current) return;
      // Back from the extra entry: still on this page. Anything else (a jump
      // several entries back from the history menu) can't be held.
      if (window.location.href !== guardedUrl) return;
      setPendingHref(BACK);
    };

    const guard = (href: string) => setPendingHref(href);
    activeGuard = guard;
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onClick, true);
    return () => {
      if (activeGuard === guard) activeGuard = null;
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const leave = useCallback(() => {
    if (!pendingHref) return;
    const href = pendingHref;
    setPendingHref(null);
    if (href === BACK) {
      // The extra entry is already gone; one more step is the page the
      // person was going back to.
      leavingRef.current = true;
      window.history.back();
      return;
    }
    router.push(href);
  }, [pendingHref, router]);

  const stay = useCallback(() => {
    // Put the extra entry back, so the next Back is held too.
    if (pendingHref === BACK) {
      window.history.pushState(
        { ...window.history.state, unsavedGuard: true },
        "",
        window.location.href,
      );
    }
    setPendingHref(null);
  }, [pendingHref]);

  return { pendingHref, leave, stay };
}
