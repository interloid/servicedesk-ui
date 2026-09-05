import { ComingSoon } from "@/components/shared/coming-soon";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tickets",
  description: "Manage and track support tickets",
};

export default function TicketsPage() {
  return (
    <ComingSoon
          title="Tickets"
          description="Manage and track support tickets. Coming soon."
        />
  );
}
