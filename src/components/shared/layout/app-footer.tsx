import type { ShellIdentity } from "@/lib/identity";

/**
 * The shell's bottom strip, transcribed from `Update design.dc.html` (and its React
 * port, `react/app/-app-/layout.tsx`): product · org, three utility entries, and the
 * build number right-aligned in mono.
 *
 * Status / Docs / Keyboard shortcuts render as text, not links: none of those routes
 * exists yet, and a dead <a> is worse than a plain label. Promote them to <Link> when
 * the destinations land.
 *
 * The org name is the one part that is real data. It arrives as a prop from the
 * route-group layout — `getShellIdentity` is server-only and the layout already resolves
 * it for the sidebar and the top bar, so re-fetching here would be a second round trip
 * for one string. When there is no session the strip still renders; it is chrome, and a
 * footer that disappears is a layout shift, not a security boundary.
 *
 * Container classes mirror the layout's own content wrapper so the strip's text starts on
 * the same left edge as the page content at every breakpoint.
 */
export function AppFooter({ identity }: { identity: ShellIdentity | null }) {
  return (
    <footer className="mx-auto flex w-full max-w-[2040px] flex-wrap items-center gap-3 border-t px-4 py-3 text-xs text-muted-foreground md:px-6 lg:px-8">
      <span>ServiceDesk Pro{identity ? ` · ${identity.org.name}` : ""}</span>
      <span aria-hidden>·</span>
      <span>Status</span>
      <span>Docs</span>
      <span>Keyboard shortcuts</span>
      <span className="ml-auto font-mono">v3.14</span>
    </footer>
  );
}
