import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { AuthCard, AuthShell } from "@/features/auth/components/auth-card";
import { APP_ROUTES } from "@/lib/routes";
import { isValidTenantSlug, tenantPath } from "@/lib/tenancy";

export const metadata: Metadata = {
  title: "Unauthorized",
  description: "You don't have access to this workspace.",
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/**
 * Where the proxy sends a signed-in customer who asks for an agent-app route,
 * e.g. /{slug}/tickets. Deliberately outside every tenant: the agent shell
 * needs getShellIdentity, which is null for a customer, so a route under
 * (base-layout) would 404 instead of explaining itself.
 *
 * `tenant` is the slug from the URL they were turned away from, used only to
 * offer a link back to the portal that actually belongs to them. It is
 * re-validated here because a query string is caller-controlled.
 */
export default async function UnauthorizedPage(props: PageProps) {
  const params = await props.searchParams;
  const raw = params.tenant;
  const slug = Array.isArray(raw) ? raw[0] : raw;
  const portalPath = isValidTenantSlug(slug)
    ? tenantPath(slug, "/portal/requests")
    : null;

  return (
    <AuthShell>
      <AuthCard className="items-center text-center">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-accent/10 text-brand-accent"
        >
          <ShieldAlert className="size-5.5" />
        </span>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            You don&apos;t have access to this workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            The help desk dashboard is for the support team who run it. Your
            account is a customer account, so your requests live in the support
            portal instead.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
          {portalPath ? (
            <Link
              href={portalPath}
              className="inline-flex items-center justify-center rounded-lg bg-brand-accent px-4 py-2.5 text-sm font-medium text-brand-accent-foreground transition-colors hover:bg-brand-accent/90"
            >
              Go to my support portal
            </Link>
          ) : null}

          <Link
            href={APP_ROUTES.HOME}
            className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Back to home
          </Link>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
