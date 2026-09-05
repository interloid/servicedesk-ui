"use client";

import { useSidebar } from "@/components/ui/sidebar";
import { useEffect, useLayoutEffect } from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function SidebarViewportSync() {
  const { isMobile, setOpenMobile } = useSidebar();

  useIsomorphicLayoutEffect(() => {
    setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  return null;
}
