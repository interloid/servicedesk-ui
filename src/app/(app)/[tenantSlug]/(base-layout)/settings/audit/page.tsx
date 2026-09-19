import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Audit Log",
  description: "Track important changes",
};

export default function AuditPage() {
  return (
    <ComingSoon
      title="Audit Log"
      description="Track and review important activities and changes across your organization, including user actions, configuration updates, and security events."
    />
  );
}
