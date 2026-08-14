"use client";

import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useLogout } from "@/features/auth/hooks/use-auth";
import type { ShellIdentity } from "@/lib/identity";

type ProfileMenuProps = {
  identity: ShellIdentity | null;
};

export function ProfileMenu({ identity }: ProfileMenuProps) {
  const { logout, isPending } = useLogout();

  async function onSignOut() {
    const result = await logout();

    if (!result.success) {
      toast.error(result.message);
    }
  }

  if (!identity) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex h-11 items-center gap-2 rounded-lg px-2">
          <Avatar className="size-8">
            <AvatarFallback className="bg-foreground text-xs font-bold text-background">
              {identity.user.initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-col items-start">
            <span className="max-w-[160px] truncate text-sm font-semibold text-foreground">
              {identity.user.name}
            </span>

            <span className="max-w-[160px] truncate text-xs text-muted-foreground">
              {identity.user.role}
            </span>
          </div>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-60 rounded-xl p-0">
        <DropdownMenuLabel className="flex flex-col gap-0.5 border-b px-3.5 py-3 font-normal">
          <span className="text-sm font-semibold text-foreground">{identity.user.name}</span>

          <span className="text-xs text-muted-foreground">
            {identity.user.role} · {identity.org.name}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="hidden" />

        <div className="p-1.5">
          <DropdownMenuItem className="h-9.5 px-3 text-sm font-medium">
            Profile settings
          </DropdownMenuItem>

          <DropdownMenuItem className="h-9.5 px-3 text-sm font-medium">
            Keyboard shortcuts
          </DropdownMenuItem>

          <DropdownMenuItem
            variant="destructive"
            className="h-9.5 px-3 text-sm font-medium"
            disabled={isPending}
            onSelect={(event) => {
              event.preventDefault();
              void onSignOut();
            }}
          >
            {isPending ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
