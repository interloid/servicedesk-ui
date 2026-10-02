import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandTheme } from "@/components/shared/layout/brand-theme";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import type {
  PortalCustomer,
  PortalSupportHours,
  PortalTenant,
} from "@/features/portal/portal";
import {
  PortalGuestMenu,
  PortalUserMenu,
} from "@/features/portal/components/portal-user-menu";
import { cn } from "@/lib/utils";

/**
 * The portal wears the tenant's brand, not ours: BrandTheme rewrites the
 * --brand-* custom properties from branding_json, so the header bar and every
 * primary button below pick up the customer's supplier colour without a single
 * hard-coded hex in this tree.
 */
export function PortalShell({
  tenant,
  customer,
  supportHours,
  children,
}: {
  tenant: PortalTenant;
  customer?: PortalCustomer | null;
  supportHours: PortalSupportHours;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <BrandTheme
        primary={tenant.primaryColor}
        secondary={tenant.secondaryColor}
        text={tenant.textColor}
        background={tenant.backgroundColor}
      />

      <PortalHeader tenant={tenant} customer={customer} />

      {/* flex-col is what lets PortalCentered's flex-1 fill this element, so
          the sign-in and confirmation cards can centre in the space between the
          header and the footer. Every page renders a single child here, so
          column flex is otherwise indistinguishable from block flow. Don't drop
          it without checking those three screens still centre. */}
      <main className="flex flex-1 flex-col px-4 py-8 sm:px-5 md:px-6 md:py-12">
        {children}
      </main>

      <PortalFooter tenant={tenant} supportHours={supportHours} />
    </div>
  );
}

function PortalHeader({
  tenant,
  customer,
}: {
  tenant: PortalTenant;
  customer?: PortalCustomer | null;
}) {
  return (
    // `border-current/15`, not a fixed dark or light hairline: currentColor is
    // already the readable foreground for this brand, so the edge stays visible
    // whether the tenant picked navy or pale yellow.
    <header className="sticky top-0 z-40 border-b border-current/15 bg-brand-accent text-brand-accent-foreground shadow-[0_1px_0_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.06)]">
      {/* Same max width as the footer, so the logo and the footer's name
          line up on a wide screen instead of sitting at opposite gutters. */}
      <div className="mx-auto flex h-15 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:h-16 sm:gap-4 sm:px-5 md:px-6">
        <Link
          href={portalPath(tenant.slug, PORTAL_ROUTES.REQUESTS)}
          // The colour is set here, not inherited from the header. globals.css
          // carries `a { @apply text-primary }`, and --primary IS the brand
          // colour — so an anchor sitting on the brand bar paints itself the
          // same colour as the bar it is on and disappears. An element selector
          // loses to a class, so naming the colour here settles it. The hover
          // variant is needed for the same reason: `a:hover` reaches for
          // --brand-pressed, which is just as invisible.
          className="flex min-w-0 items-center gap-2.5 rounded-md text-brand-accent-foreground outline-none hover:text-brand-accent-foreground focus-visible:ring-2 focus-visible:ring-current/60"
        >
          <TenantMark tenant={tenant} className="bg-current/15" />

          {/* min-w-0 + truncate so a long workspace name shortens instead of
              squeezing the actions off the right edge on a narrow screen. */}
          <span className="min-w-0 truncate text-base font-bold tracking-tight">
            {tenant.name.charAt(0).toUpperCase() +
              tenant.name.slice(1).toLowerCase()}
            <span className="font-semibold text-current/80"> Support</span>
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <Link
            href={portalPath(tenant.slug, PORTAL_ROUTES.HELP)}
            className={cn(
              // bg-current, not bg-white. A white overlay lightens the bar, and
              // on a mid-tone brand that pushed the pill to 1.18:1 against the
              // header while dropping its own text to 2.76:1 -- the control was
              // washing out the very text it held. currentColor tints toward the
              // readable foreground instead, so it separates on any brand.
              // text-brand-accent-foreground for the same reason as the logo
              // link above: without it `a { @apply text-primary }` wins over the
              // header's inherited colour and this pill vanishes into the bar.
              // Hidden on a phone: the menu button carries Help centre there.
              "hidden rounded-lg bg-current/12 px-3.5 py-2 text-sm font-semibold text-brand-accent-foreground transition-colors sm:inline-flex",
              "hover:bg-current/20 hover:text-brand-accent-foreground focus-visible:ring-2 focus-visible:ring-current/60 focus-visible:outline-none",
            )}
          >
            Help centre
          </Link>

          {customer ? (
            <PortalUserMenu tenantSlug={tenant.slug} customer={customer} />
          ) : (
            <PortalGuestMenu tenantSlug={tenant.slug} />
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * One line. The design called for a logo, a tagline, a Support column and a
 * phone disclosure; of everything in those, the only two things not already
 * reachable elsewhere were the tenant's name and its support hours -- the guest
 * menu carries both footer links and the header carries Help centre from sm up.
 * So the name and the hours are what stayed.
 *
 * The band is still the fixed dark one rather than the brand colour: the header
 * already carries the brand, and a second brand bar would fight whatever the
 * tenant picked. slate-400 on slate-900 is 6.9:1, so the small print stays
 * readable.
 */
function PortalFooter({
  tenant,
  supportHours,
}: {
  tenant: PortalTenant;
  supportHours: PortalSupportHours;
}) {
  const details = [
    supportHours.hours,
    supportHours.urgentTarget
      ? `Urgent issues answered in ${supportHours.urgentTarget}`
      : null,
  ].filter((detail): detail is string => Boolean(detail));

  const items = [
    <span key="name" className="font-semibold text-white">
      {tenant.name} Support
    </span>,
    ...details.map((detail, index) => (
      <span key={`detail-${index}`}>{detail}</span>
    )),
  ];

  return (
    <footer className="bg-slate-900 text-slate-400">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-5 md:px-6">
        {/* flex-wrap rather than one forced line: at 320px the hours and the
            urgent target do not both fit, and truncating them would drop the
            only information the footer carries. Each item sits in its own
            nowrap row together with the separator that follows it, so a wrap
            can never orphan a "·" at the start of a line. */}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {items.map((item, index) => (
            <span key={index} className="flex items-center gap-2">
              {item}
              {index < items.length - 1 ? (
                <span aria-hidden className="text-slate-600">
                  ·
                </span>
              ) : null}
            </span>
          ))}
        </p>
      </div>
    </footer>
  );
}

/** The tenant's logo, or its initial on a tinted square when there is none. */
function TenantMark({
  tenant,
  className,
}: {
  tenant: PortalTenant;
  className?: string;
}) {
  if (tenant.logoUrl) {
    return (
      <Image
        src={tenant.logoUrl}
        alt=""
        width={32}
        height={32}
        className="size-8 shrink-0 rounded-md object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-extrabold",
        className,
      )}
    >
      {tenant.initial}
    </span>
  );
}

/**
 * Centres one block in whatever space the page has left: horizontally, and
 * vertically when there is room to spare.
 *
 * `flex-1` is what fills the space, and it only works because <main> is a
 * column flex container. A percentage (min-h-full) would not: main is a flex-1
 * item in the shell's min-h-dvh column, so it has a used height but no height
 * property, and the percentage has nothing to resolve against. The flex
 * algorithm measures against the used height instead, which is why the stage
 * grows here where min-h-full quietly did nothing.
 *
 * The vertical centring is `my-auto` on the child rather than justify-center
 * on this element. Auto margins collapse to zero once the block is taller than
 * the space; justify-center keeps pushing, which puts the top of the card
 * above the scroll origin -- the page cannot scroll back up to it, so on a
 * short window the heading is simply unreachable.
 *
 * That centres the block between the header and the footer rather than in the
 * raw viewport, which is a few px above true centre now that the footer is a
 * one-line band.
 */
export function PortalCentered({
  width,
  children,
}: {
  width: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto flex w-full flex-1 flex-col", width)}>
      <div className="my-auto w-full">{children}</div>
    </div>
  );
}

/** The centred one-card layout every sign-in and onboarding screen uses. */
export function PortalCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-120 rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.06)] sm:p-8",
        className,
      )}
    >
      {children}
    </div>
  );
}
