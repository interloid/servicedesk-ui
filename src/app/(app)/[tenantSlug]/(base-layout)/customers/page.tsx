import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Customers",
  description: "Manage your customers and accounts",
};

export default function CustomersPage() {
  return (
    <ComingSoon
      title="Customers"
      description="Manage and organize your customers, companies, and their contact details from one place. Coming soon."
    />
  );
}
