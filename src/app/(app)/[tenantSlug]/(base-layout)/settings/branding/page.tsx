import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Branding",
  description: "Customize your customer experience",
};

export default function BrandingPage() {
  return (
    <ComingSoon
      title="Branding"
      description="Apply your logo, colors, and domain so every customer touchpoint feels like you. Coming soon."
    />
  );
}
