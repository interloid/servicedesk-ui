import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";
import { getShellIdentity } from "@/lib/identity";
import { getTenantContext } from "@/features/tenancy/services/tenant-resolver";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to your ServiceDesk Pro workspace.",
  alternates: { canonical: "/login" },
  // Nothing here should be indexed once it fronts a real session.
  robots: { index: false, follow: false },
};

/**
 * Unauthenticated route. It sits in the (auth) group precisely so it inherits none of the
 * (app) shell — no sidebar, no top bar, no content container.
 *
 * Container is the design's `authPad`: a centred single column, 22px between the logo row
 * and the card, 56px/24px padding at md and up and 28px/20px below it.
 *
 * On a tenant subdomain the page is that tenant's sign-in: the host is resolved to its
 * branding so the card can name the workspace, and `login()` re-verifies the issued
 * session's tenant against the same host.
 */
export default async function LoginPage(props: PageProps<"/login">) {
  const [identity, tenant] = await Promise.all([getShellIdentity(), getTenantContext()]);

  /*
   * `?error=` is how the OAuth callback reports a failed or cancelled Google sign-in — that
   * round trip is a full document navigation, so there is no client state left to carry it.
   * Read here rather than with `useSearchParams` in the form: this is already a Server
   * Component, and the hook would force the form under a Suspense boundary.
   */
  const { error } = await props.searchParams;
  const initialError = Array.isArray(error) ? error[0] : error;

  return (
    <AuthShell>
      <LoginForm identity={identity} tenant={tenant} initialError={initialError} />
    </AuthShell>
  );
}
