import { AuthShell } from "@/features/auth/components/auth-card";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset your password",
};

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
