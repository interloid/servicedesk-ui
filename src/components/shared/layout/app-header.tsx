"use client";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { HeaderSearch } from "@/components/shared/layout/header-search";
import { NotificationMenu } from "@/components/shared/layout/notification-menu";
import { ProfileMenu } from "@/components/shared/layout/profile-menu";
import { ShellIdentity } from "@/types/shell-identity";

export function AppHeader({ identity }: { identity: ShellIdentity | null }) {
  return (
    <header className="sticky top-0 z-10 flex h-15 shrink-0 items-center gap-2.5 border-b bg-background/95 px-4 backdrop-blur md:px-6 lg:px-8">
      <SidebarTrigger
        icon={<Menu />}
        className="size-9 shrink-0 lg:hidden 
              border
              border-border
              bg-card
              text-muted-foreground
              hover:bg-muted"
      />

      <HeaderSearch className="hidden h-9.5 max-w-105 flex-1 gap-2.25 rounded-md border-border bg-muted lg:flex" />

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Search"
          className="relative size-10 sm:size-11 rounded-md lg:hidden"
        >
          <Search aria-hidden />
        </Button>

        <NotificationMenu />
        <ProfileMenu identity={identity} />
      </div>
    </header>
  );
}
