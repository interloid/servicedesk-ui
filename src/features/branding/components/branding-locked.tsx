import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";

import {
  PORTAL_DOMAIN,
  type TenantBranding,
} from "@/features/branding/branding";
import { BrandingEditor } from "./branding-editor";

/**
 * Made-up branding for the blurred backdrop. A locked workspace's real
 * branding is never passed down: the blur is decoration, and anything under
 * it can still be read (or un-blurred) from dev tools.
 */
const SAMPLE_BRANDING: TenantBranding = {
  name: "Acme Support",
  slug: "acme",
  portalUrl: `acme.${PORTAL_DOMAIN}`,
  logoUrl: null,
  primaryColor: null,
  textColor: null,
  backgroundColor: null,
  showLogoOnPortal: true,
};

interface BrandingLockedProps {
  tenantSlug: string;
  portalOrigin: string;
  /** Only a Tenant Admin can open Plans & pricing; a Manager is told who can. */
  canUpgrade: boolean;
}

/** What a Free tenant sees at /settings/branding: the editor, blurred, under a lock. */
export function BrandingLocked({
  tenantSlug,
  portalOrigin,
  canUpgrade,
}: BrandingLockedProps) {
  return (
    <div className="relative h-full overflow-hidden">
      <div
        aria-hidden
        inert
        className="pointer-events-none h-full select-none opacity-60 blur-[6px]"
      >
        <BrandingEditor
          branding={SAMPLE_BRANDING}
          canEdit={false}
          portalOrigin={portalOrigin}
        />
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-background/30 px-4">
        <div className="flex w-full max-w-lg flex-col items-center rounded-2xl bg-white/80 px-6 py-10 text-center shadow-lg ring-1 ring-black/5 backdrop-blur-md sm:px-10">
          <span
            aria-hidden
            className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <Lock className="size-9" />
          </span>
          <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Branding is locked on the Free plan
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            {canUpgrade
              ? "Upgrade to Pro to add your logo, colors, and portal address."
              : "Ask a Tenant Admin to upgrade to Pro to customize branding."}
          </p>
          {canUpgrade && (
            <Button
              asChild
              className="mt-6 h-12 gap-2 rounded-xl px-10 text-base font-semibold"
            >
              <Link href={tenantPath(tenantSlug, TENANT_ROUTES.ACCOUNT.PLANS)}>
                View plans
                <ArrowRight aria-hidden className="size-5" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
