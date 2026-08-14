"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { HeaderSearch } from "@/components/shared/layout/header-search";
import { NotificationMenu } from "@/components/shared/layout/notification-menu";
import { ProfileMenu } from "@/components/shared/layout/profile-menu";
import type { ShellIdentity } from "@/lib/identity";
import { findActiveNavItem } from "@/lib/nav";

/**
 * Sticky top bar for every authenticated route.
 *
 * Geometry is measured from `Update design.dc.html`'s own `<header>` and `gqField` —
 * 60px bar, 38px search field, 12px `/` keycap. Where a brief named a different number,
 * the design wins.
 *
 * The search control is a <button>, deliberately: it is the Command palette's trigger,
 * not a text input. It opens nothing yet.
 *
 * `identity` arrives as a prop rather than being fetched here: this is a Client Component
 * (it needs `usePathname`), and `getShellIdentity` reaches `next/headers`. The route-group
 * layout resolves it once and hands it to the sidebar, this bar and the footer.
 */
export function AppHeader({ identity }: { identity: ShellIdentity | null }) {
  const pathname = usePathname();
  const active = findActiveNavItem(pathname);
  const page = active?.item.label ?? "Dashboard";

  return (
    <header className="sticky top-0 z-10 flex h-15 shrink-0 items-center gap-2.5 border-b bg-background/95 px-4 backdrop-blur md:px-6 lg:px-8">
      <SidebarTrigger className="size-9 shrink-0 lg:hidden" />

      <span className="min-w-0 flex-1 truncate text-base font-bold text-foreground lg:hidden">
        {page}
      </span>

      <HeaderSearch className="hidden h-9.5 max-w-105 flex-1 gap-2.25 rounded-md border-border bg-muted lg:flex" />

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Search"
          className="lg:hidden"
        >
          <Search aria-hidden />
        </Button>

        <NotificationMenu />
        <ProfileMenu identity={identity} />
      </div>
    </header>
  );
}
