import { ForgotTenantPasswordForm } from "@/features/auth/components/forget-tenant-password-form";

export default function ResetPasswordPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-card px-4 py-12">
      <div className="mb-8">
        <div className="flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-accent font-semibold text-white shadow-sm">
            N
          </span>
          <span className="text-xl font-bold text-slate-900 tracking-tight">
            ServiceDesk Pro
          </span>
        </div>
      </div>
      <ForgotTenantPasswordForm />
    </div>
  );
}
