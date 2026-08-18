import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-card px-4 py-12">
      <div className="mb-8">
        <div className="flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-accent font-semibold text-white shadow-sm">
            N
          </div>
          <span className="text-xl font-bold text-slate-900 tracking-tight">
            ServiceDesk Pro
          </span>
        </div>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
