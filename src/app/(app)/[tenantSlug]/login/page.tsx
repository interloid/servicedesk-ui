import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/components/auth-card";
import { TenantLoginForm } from "@/features/auth/components/tenant-login-form";
import { getTenantContext } from "@/features/tenancy/services/tenant-resolver";
import { getShellIdentity } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to your organization workspace.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function TenantLoginPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const [identity, tenant] = await Promise.all([
    getShellIdentity(params.tenantSlug),
    getTenantContext(params.tenantSlug),
  ]);

  const errorParam = searchParams.error;
  const initialError = Array.isArray(errorParam) ? errorParam[0] : errorParam;

  const nextParam = searchParams.next;
  const next = Array.isArray(nextParam) ? nextParam[0] : nextParam;

  return (
    <AuthShell>
      <TenantLoginForm
        identity={identity}
        tenant={tenant ?? null}
        tenantSlug={params.tenantSlug}
        initialError={initialError}
        next={next}
      />
    </AuthShell>
  );
}
