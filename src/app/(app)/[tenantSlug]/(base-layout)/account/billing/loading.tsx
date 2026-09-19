import BillingDashboard from "@/features/billing/components/billing-dashboard";

export default function Loading() {
  return (
    <BillingDashboard params={Promise.resolve({ tenantSlug: "" })} isLoading />
  );
}
