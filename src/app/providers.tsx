"use client";

import { Toaster } from "@/components/ui/sonner";
import { EmailVerificationHandler } from "@/components/shared/email-verification-handler";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <EmailVerificationHandler />
      <Toaster richColors position="bottom-right" />
    </>
  );
}
