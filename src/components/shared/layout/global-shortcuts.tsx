"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { isShortcutBlocked } from "@/hooks/use-keyboard-shortcut";
import { confirmNavigation } from "@/hooks/use-unsaved-changes-guard";
import {
  isTenantRouteAllowed,
  stripTenantPrefix,
  tenantPath,
  TENANT_ROUTES,
} from "@/lib/tenancy";

// How long after G the second key of a "G then X" chord still counts.
const CHORD_TIMEOUT_MS = 1500;

/**
 * Which shortcut groups a role can use, shared with the Keyboard shortcuts
 * modal so it lists only those. Tickets follow the route rules in
 * lib/tenancy; billing is the owner's and the billing admin's, as the
 * sidebar shows it (lib/tenancy has no billing helper yet).
 */
export function shortcutAccess(role: string | null | undefined) {
  return {
    tickets: isTenantRouteAllowed(role, TENANT_ROUTES.TICKETS),
    billing: role === "tenant_admin" || role === "billing_admin",
  };
}

/**
 * The shell-wide shortcuts from the Keyboard shortcuts modal: G then T,
 * G then B, and N away from the ticket list (the list opens its own sheet).
 * "/" lives in HeaderSearch, A / E in the tickets table, R in the ticket
 * view, and Esc is every dialog's own.
 */
export function GlobalShortcuts({ role }: { role: string }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const parsed = stripTenantPrefix(pathname);
    if (!parsed) return;

    const { tickets: canSeeTickets, billing: canSeeBilling } =
      shortcutAccess(role);
    let chordUntil = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isShortcutBlocked(event)) return;
      const key = event.key.toLowerCase();

      if (Date.now() < chordUntil) {
        chordUntil = 0;
        const target =
          key === "t" && canSeeTickets
            ? TENANT_ROUTES.TICKETS
            : key === "b" && canSeeBilling
              ? TENANT_ROUTES.ACCOUNT.BILLING
              : null;
        if (target) {
          event.preventDefault();
          const href = tenantPath(parsed.slug, target);
          if (confirmNavigation(href)) router.push(href);
        }
        return;
      }

      if (key === "g") {
        chordUntil = Date.now() + CHORD_TIMEOUT_MS;
        return;
      }

      if (
        key === "n" &&
        canSeeTickets &&
        parsed.rest !== TENANT_ROUTES.TICKETS
      ) {
        event.preventDefault();
        const href = `${tenantPath(parsed.slug, TENANT_ROUTES.TICKETS)}?new=1`;
        if (confirmNavigation(href)) router.push(href);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pathname, role, router]);

  return null;
}
