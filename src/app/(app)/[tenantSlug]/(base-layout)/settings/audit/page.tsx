import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Audit Log",
  description: "Track important changes",
};

export default function AuditPage() {
  return (
    <ComingSoon
      title="Audit log"
      description="See a detailed history of important changes made across your workspace. Coming soon."
    />
  );
}
