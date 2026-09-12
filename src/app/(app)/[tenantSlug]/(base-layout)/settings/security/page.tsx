import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Security & SSO",
  description: "Protect your workspace",
};

export default function SecurityPage() {
  return (
    <ComingSoon
      title="Security & SSO"
      description="Configure authentication, SSO, and security controls to keep your workspace protected. Coming soon."
    />
  );
}
