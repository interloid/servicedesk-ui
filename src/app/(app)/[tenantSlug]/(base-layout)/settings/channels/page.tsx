import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Channels & Email",
  description: "Connect inboxes and support channels",
};

export default function ChannelsPage() {
  return (
    <ComingSoon
      title="Channels & email"
      description="Connect your inboxes and routes so tickets flow in wherever your customers reach out. Coming soon."
    />
  );
}
