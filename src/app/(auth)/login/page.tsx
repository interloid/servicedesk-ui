import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";
import { getTenantContext } from "@/features/tenancy/services/tenant-resolver";
import { getShellIdentity } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to your ServiceDesk Pro workspace.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function LoginPage(props: PageProps) {
  const searchParams = await props.searchParams;

  const [identity, tenant] = await Promise.all([
    getShellIdentity(),
    getTenantContext(),
  ]);

  const errorParam = searchParams.error;
  const initialError = Array.isArray(errorParam) ? errorParam[0] : errorParam;

  const nextParam = searchParams.next;
  const next = Array.isArray(nextParam) ? nextParam[0] : nextParam;

  return (
    <AuthShell>
      <LoginForm
        identity={identity}
        tenant={tenant}
        initialError={initialError}
        next={next}
      />
    </AuthShell>
  );
}