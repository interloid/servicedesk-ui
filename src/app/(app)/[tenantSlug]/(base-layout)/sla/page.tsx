import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "SLA Policies",
  description: "Configure service-level agreements",
};

export default function SlaPage() {
  return (
    <ComingSoon
      title="SLA policies"
      description="Set first-response and resolution targets so your team always meets service expectations. Coming soon."
    />
  );
}
