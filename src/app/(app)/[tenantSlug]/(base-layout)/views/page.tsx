import { ComingSoon } from "@/components/shared/coming-soon";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Views",
  description: "Manage and track support views",
};

export default function ViewsPage() {
  return (
    <ComingSoon
      title="Saved Views"
      description="Manage and track support views. Coming soon."
    />
  );
}
