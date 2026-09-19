import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Team & Roles",
  description: "Manage members and permissions",
};

export default function TeamPage() {
  return (
    <ComingSoon
      title="Team & roles"
      description="Invite members, assign roles, and control what each person can access. Coming soon."
    />
  );
}
