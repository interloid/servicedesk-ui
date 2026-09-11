import { AuthShell } from "@/features/auth/components/auth-card";
import { ForgotTenantPasswordForm } from "@/features/auth/components/forget-tenant-password-form";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset your password",
};

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <ForgotTenantPasswordForm />
    </AuthShell>
  );
}
