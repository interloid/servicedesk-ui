import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Notification Center",
  description: "Manage what you hear about",
};

export default function NotificationsPage() {
  return (
    <ComingSoon
      title="Notification center"
      description="Choose what updates you and your team receive — right in the app, by email, or elsewhere. Coming soon."
    />
  );
}
