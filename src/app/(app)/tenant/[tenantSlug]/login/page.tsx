// src/app/(app)/tenant/[tenantSlug]/login/page.tsx
import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";
import { getShellIdentity } from "@/lib/identity";
import { getTenantContext } from "@/features/tenancy/services/tenant-resolver";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to your ServiceDesk Pro workspace.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ tenantSlug?: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function LoginPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  // Pass tenantSlug from route params to getTenantContext
  const [identity, tenant] = await Promise.all([
    getShellIdentity(),
    getTenantContext(params.tenantSlug),
  ]);
    console.log("🚀 ~ LoginPage ~ tenantSlug:", params.tenantSlug)


  const errorParam = searchParams.error;
  const initialError = Array.isArray(errorParam) ? errorParam[0] : errorParam;

  return (
    <AuthShell>
      <LoginForm 
        identity={identity} 
        tenant={tenant} 
        initialError={initialError} 
      />
    </AuthShell>
  );
}