"use client";

import * as React from "react";

import { useSidebar } from "@/components/ui/sidebar";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export function SidebarViewportSync() {
  const { isMobile, setOpenMobile } = useSidebar();

  useIsomorphicLayoutEffect(() => {
    setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  return null;
}
