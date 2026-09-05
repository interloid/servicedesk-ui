import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Integrations & API",
  description: "Connect your favorite tools",
};

export default function IntegrationsPage() {
  return (
    <ComingSoon
      title="Integrations & API"
      description="Connect your favorite tools and extend the platform with our REST API and webhooks. Coming soon."
    />
  );
}
