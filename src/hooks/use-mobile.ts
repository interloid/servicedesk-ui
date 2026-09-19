import * as React from "react";

const TABLET_BREAKPOINT = "(max-width: 1023.98px)";

export function useIsMobile() {
  const subscribe = React.useCallback((callback: () => void) => {
    const mql = window.matchMedia(TABLET_BREAKPOINT);

    mql.addEventListener("change", callback);

    return () => {
      mql.removeEventListener("change", callback);
    };
  }, []);

  const getSnapshot = React.useCallback(() => {
    return window.matchMedia(TABLET_BREAKPOINT).matches;
  }, []);

  const getServerSnapshot = React.useCallback(() => {
    return false;
  }, []);

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
