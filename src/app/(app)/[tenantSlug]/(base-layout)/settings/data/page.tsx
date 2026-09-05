import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Data & Privacy",
  description: "Manage data retention and exports",
};

export default function DataPage() {
  return (
    <ComingSoon
      title="Data & privacy"
      description="Control data retention, export, and privacy settings for your workspace. Coming soon."
    />
  );
}
