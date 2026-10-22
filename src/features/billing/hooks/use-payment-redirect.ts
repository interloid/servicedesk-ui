"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Hands the browser to PayPal and keeps the caller's buttons disabled until
 * the page has actually left.
 *
 * window.location.assign returns straight away, so a transition that ends on
 * it re-enables its button while the old page is still on screen -- and a
 * second click sends another create / abort / revise to PayPal. `redirecting`
 * never resets on its own; only a page restored from the back/forward cache
 * (the buyer pressed Back on PayPal) clears it, so the buttons work again.
 */
export function usePaymentRedirect() {
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };

    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const redirect = useCallback((url: string) => {
    setRedirecting(true);
    window.location.assign(url);
  }, []);

  return { redirecting, redirect };
}
