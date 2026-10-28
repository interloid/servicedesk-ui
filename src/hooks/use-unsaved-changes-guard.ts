"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Asks before leaving a form with unsaved changes.
 *
 * - Refresh, close tab or typing a new URL: the browser's own "Leave site?"
 *   prompt (browsers don't allow a custom popup there).
 * - Clicking any in-app link (sidebar, header, back link, Cancel): the click
 *   is held and `pendingHref` is set, so the page can show its own confirm
 *   popup; `leave()` then goes there, `stay()` drops it.
 *
 * Programmatic `router.push` (e.g. after a successful save) is not blocked.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

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

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const leave = useCallback(() => {
    if (!pendingHref) return;
    const href = pendingHref;
    setPendingHref(null);
    router.push(href);
  }, [pendingHref, router]);

  const stay = useCallback(() => setPendingHref(null), []);

  return { pendingHref, leave, stay };
}
