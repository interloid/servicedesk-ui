"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, Menu } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/features/portal/actions/portal.actions";
import { PortalPasswordDialog } from "@/features/portal/components/portal-password-dialog";
import { PortalProfileDialog } from "@/features/portal/components/portal-profile-dialog";
import {
  PORTAL_ROUTES,
  portalPath,
  type PortalCustomer,
} from "@/features/portal/portal";
import { portalToastError } from "@/features/portal/portal-toast";
import { cn } from "@/lib/utils";

export function PortalUserMenu({
  tenantSlug,
  customer,
}: {
  tenantSlug: string;
  customer: PortalCustomer;
}) {
  const [isPending, startTransition] = useTransition();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);

  function onSignOut() {
    startTransition(async () => {
      const result = await signOutAction(tenantSlug);

      if (result.success) {
        // A full load rather than router.push: the auth cookies were just
        // cleared server-side, and every cached RSC payload above this point
        // was rendered for the signed-in customer.
        //
        // No success toast, and there could not be one: window.location.assign
        // tears the Toaster down with the page, so it would never be read. The
        // sign-in screen it lands on is the confirmation.
        window.location.assign(result.data.redirectTo);
        return;
      }

      // Previously unreported: the action failing left the menu item spinning
      // with nothing to read, and the only way out was to close the menu and
      // try again blind.
      portalToastError(result.message);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={TRIGGER_CLASS}>
          <CustomerAvatar
            customer={customer}
            className="hidden size-8 sm:flex"
          />

          <span className="hidden max-w-45 truncate text-sm font-semibold md:inline">
            {customer.fullName}
          </span>

          <ChevronDown
            aria-hidden
            className="hidden size-4 opacity-80 sm:block"
          />

          {/* A phone has no room for the Help pill and the avatar side by
              side, so the menu becomes the one control on the bar. */}
          <Menu aria-hidden className="size-5 sm:hidden" />

          <span className="sr-only">Open account menu</span>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          sideOffset={10}
          className="w-68 p-1.5"
        >
          <DropdownMenuLabel className="flex items-center gap-3 px-2.5 py-2.5">
            <CustomerAvatar customer={customer} className="size-9" onCard />

            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-bold text-foreground">
                {customer.fullName}
              </span>

              <span className="truncate text-xs font-normal text-muted-foreground">
                {customer.email}
              </span>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          <MobileNavItems tenantSlug={tenantSlug} />

          <DropdownMenuItem
            onSelect={() => setIsProfileOpen(true)}
            className="h-9 px-3 text-sm font-medium cursor-pointer"
          >
            Profile settings
          </DropdownMenuItem>

          <DropdownMenuItem
            onSelect={() => setIsPasswordOpen(true)}
            className="h-9 px-3 text-sm font-medium cursor-pointer"
          >
            Change password
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* variant, not hand-written colours: the base gives
              focus:bg-destructive/10 (a light red wash) and keeps the label
              and the icon red, where the manual text-destructive left the row
              highlighting neutral grey -- a red word on a grey hover. Matches
              how the agent menu does it. */}
          <DropdownMenuItem
            onSelect={onSignOut}
            disabled={isPending}
            variant="destructive"
            className="h-9 px-3 text-sm font-medium cursor-pointer"
          >
            <span>{isPending ? "Signing out…" : "Sign out"}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PortalProfileDialog
        open={isProfileOpen}
        onOpenChange={setIsProfileOpen}
        tenantSlug={tenantSlug}
        customer={customer}
      />

      <PortalPasswordDialog
        open={isPasswordOpen}
        onOpenChange={setIsPasswordOpen}
        tenantSlug={tenantSlug}
      />
    </>
  );
}

/**
 * The phone-only menu for a visitor who is not signed in. From `sm` up the
 * header's Help pill is enough, so this renders nothing there.
 */
export function PortalGuestMenu({ tenantSlug }: { tenantSlug: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(TRIGGER_CLASS, "sm:hidden")}>
        <Menu aria-hidden className="size-5" />
        <span className="sr-only">Open menu</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-60 p-1.5">
        <MobileNavItems tenantSlug={tenantSlug} alwaysShow />

        <DropdownMenuItem asChild className={LINK_ITEM_CLASS}>
          <Link href={portalPath(tenantSlug, PORTAL_ROUTES.LOGIN)}>
            <span>Sign in</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LINK_ITEM_CLASS =
  "gap-2.5 px-2.5 py-2 text-foreground hover:text-foreground focus:text-foreground";

const TRIGGER_CLASS =
  "flex items-center gap-2 rounded-lg p-2 outline-none transition-colors hover:bg-current/12 focus-visible:ring-2 focus-visible:ring-current/60 sm:px-1.5 sm:py-1";

/**
 * Help centre and Submit a request, which live in the header and footer on a
 * wide screen. On a phone the header drops the Help pill, so the menu picks
 * them up -- hidden from `sm` up, where they would only be repeats.
 */
function MobileNavItems({
  tenantSlug,
  alwaysShow = false,
}: {
  tenantSlug: string;
  alwaysShow?: boolean;
}) {
  // Colours named because globals.css paints every `a` in the brand colour.
  const itemClass = cn(LINK_ITEM_CLASS, !alwaysShow && "sm:hidden");

  return (
    <>
      <DropdownMenuItem asChild className={itemClass}>
        <Link href={portalPath(tenantSlug, PORTAL_ROUTES.HELP)}>
          <span>Help centre</span>
        </Link>
      </DropdownMenuItem>

      <DropdownMenuItem asChild className={itemClass}>
        <Link href={portalPath(tenantSlug, PORTAL_ROUTES.NEW_REQUEST)}>
          <span>Submit a request</span>
        </Link>
      </DropdownMenuItem>

      {alwaysShow ? null : <DropdownMenuSeparator className="sm:hidden" />}
    </>
  );
}

/**
 * Photo when one is set, initials otherwise. On the brand bar the initials
 * tint with currentColor so they read on any brand; inside the menu card
 * (`onCard`) they use the neutral muted fill instead.
 */
function CustomerAvatar({
  customer,
  className,
  onCard = false,
}: {
  customer: PortalCustomer;
  className?: string;
  onCard?: boolean;
}) {
  return (
    <Avatar aria-hidden className={className}>
      {customer.avatarUrl ? (
        <AvatarImage src={customer.avatarUrl} alt="" className="object-cover" />
      ) : null}
      <AvatarFallback
        className={
          onCard
            ? "bg-muted text-xs font-bold text-muted-foreground"
            : // text-inherit is load-bearing, not decoration. AvatarFallback's
              // base sets text-muted-foreground, and `bg-current/20` resolves
              // against this element's own computed colour -- not its parent's.
              // Left alone, the tint is 20% of slate-500 and the letters are
              // slate-500 too, on a brand-coloured bar: both all but invisible,
              // which is how a background can be "set" and still not show.
              // Inheriting puts the bar's foreground back into currentColor,
              // which is what makes the tint read on any brand.
              "bg-current/20 text-xs font-bold text-inherit"
        }
      >
        {customer.initials}
      </AvatarFallback>
    </Avatar>
  );
}
