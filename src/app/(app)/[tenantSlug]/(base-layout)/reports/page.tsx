import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Reports",
  description: "Track your support performance",
};

export default function ReportsPage() {
  return (
    <ComingSoon
      title="Reports"
      description="Understand your team's performance with volume, satisfaction, and resolution analytics. Coming soon."
    />
  );
}
