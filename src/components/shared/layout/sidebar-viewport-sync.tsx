"use client";

import * as React from "react";

import { useSidebar } from "@/components/ui/sidebar";

/**
 * Closes the mobile drawer whenever the viewport crosses the lg boundary.
 *
 * ROOT CAUSE (upstream, in `ui/sidebar.tsx`, which is not ours to edit): `SidebarProvider`
 * keeps `openMobile` in its own state and never resets it when `isMobile` flips. `Sidebar`
 * renders `<Sheet open={openMobile}>` only while `isMobile` is true, so:
 *
 *   1. open the drawer at 375 → `openMobile = true`, Radix locks the page
 *      (`body { pointer-events: none }`) behind a modal scrim — correct so far;
 *   2. resize past 1024 → `Sidebar` switches to the permanent branch and the Sheet
 *      unmounts. Radix's own cleanup runs correctly: the lock is released. But
 *      `openMobile` is still `true`;
 *   3. resize back under 1024 → the Sheet remounts *already open*. The drawer appears
 *      unbidden and its scrim swallows every click in the header — which is why the
 *      search trigger "stops responding" after a resize.
 *
 * `useIsMobile()` itself is sound: its `matchMedia` listener re-fires in both directions
 * and the state never goes stale. Three plain crossings with the drawer untouched leave
 * `body { pointer-events: auto }`, exactly one visible trigger, and a live search control.
 *
 * The fix has to be a layout effect, not a passive one: on the false→true transition the
 * stale-open Sheet is committed to the DOM in the same render, so resetting in a passive
 * effect would flash the drawer for a frame before closing it.
 */

// useLayoutEffect warns when React renders this on the server; the passive fallback there
// is harmless because the reset only ever matters after a client-side resize.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export function SidebarViewportSync() {
  const { isMobile, setOpenMobile } = useSidebar();

  useIsomorphicLayoutEffect(() => {
    setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  return null;
}
