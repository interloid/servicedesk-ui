import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

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

      <main className="flex-1 px-4 py-8 sm:px-5 md:px-6 md:py-12">
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
      <div className="mx-auto flex h-15 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:gap-4 sm:px-5 md:px-6">
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
            <PortalUserMenu
              tenantSlug={tenant.slug}
              tenantName={tenant.name}
              customer={customer}
            />
          ) : (
            <PortalGuestMenu tenantSlug={tenant.slug} />
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * A fixed dark band rather than the brand colour: the header already carries
 * the brand, and a second brand bar would fight whatever the tenant picked.
 * slate-400 on slate-900 is 6.9:1, so the small print stays readable.
 *
 * Only links that go somewhere real. The design also shows Status page,
 * Privacy policy, Terms and social icons, but tenants have nowhere to set
 * those URLs yet -- add them here once branding carries them.
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

  const supportLinks = [
    { href: portalPath(tenant.slug, PORTAL_ROUTES.HELP), label: "Help centre" },
    {
      href: portalPath(tenant.slug, PORTAL_ROUTES.NEW_REQUEST),
      label: "Submit a request",
    },
  ];

  return (
    <footer className="bg-slate-900 text-slate-400">
      <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-8 sm:px-5 md:px-6 md:pt-10 md:pb-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between md:gap-10">
          <div className="flex min-w-0 items-start gap-3">
            <TenantMark tenant={tenant} className="bg-white/10 text-white" />

            <div className="min-w-0">
              <p className="text-sm font-bold wrap-break-word text-white">
                {tenant.name} Support
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                We&apos;re here to help
              </p>

              {details.length > 0 ? (
                // Stacked on a phone, one dotted line from sm up: letting the
                // pair wrap left a stray "·" at the start of the second line.
                <p className="mt-2 flex flex-col gap-0.5 text-xs leading-normal sm:flex-row sm:flex-wrap sm:gap-x-1.5">
                  {details.map((detail, index) => (
                    <span key={detail}>
                      {index > 0 ? (
                        <span aria-hidden className="mr-1.5 hidden sm:inline">
                          ·
                        </span>
                      ) : null}
                      {detail}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </div>

          {/* Wide screens: a plain column. Phones: a disclosure, so the
              footer stays short under a long form. No rules anywhere: the
              band is dark on its own, and a hairline between two columns of a
              six-word footer was carrying more weight than the words. The gap
              does the separating now. */}
          <nav aria-label="Support" className="hidden md:block">
            <p className="text-xs font-semibold text-white">Support</p>
            <ul className="mt-3 flex flex-col gap-2">
              {supportLinks.map((link) => (
                <li key={link.href}>
                  <FooterLink href={link.href}>{link.label}</FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          <details className="group md:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
              Support
              <ChevronDown
                aria-hidden
                className="size-4 text-slate-400 transition-transform group-open:rotate-180"
              />
            </summary>
            <ul className="flex flex-col gap-2.5 pb-4">
              {supportLinks.map((link) => (
                <li key={link.href}>
                  <FooterLink href={link.href}>{link.label}</FooterLink>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    // Colours named on the anchor for the same reason as the header:
    // globals.css paints every `a` in the brand colour.
    <Link
      href={href}
      className="text-xs text-slate-400 transition-colors hover:text-white hover:underline"
    >
      {children}
    </Link>
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
