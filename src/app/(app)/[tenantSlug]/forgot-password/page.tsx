import { AuthShell } from "@/features/auth/components/auth-card";
import { ForgotTenantPasswordForm } from "@/features/auth/components/forget-tenant-password-form";

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <ForgotTenantPasswordForm />
    </AuthShell>
  );
}
