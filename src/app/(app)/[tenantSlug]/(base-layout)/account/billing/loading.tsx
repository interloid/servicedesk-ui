import BillingDashboard from "@/features/billing/components/billing-dashboard";

// Reuses the dashboard's own skeleton so the loading state matches the layout
// that replaces it, instead of a spinner that shifts everything on arrival.
export default function Loading() {
  return (
    <BillingDashboard params={Promise.resolve({ tenantSlug: "" })} isLoading />
  );
}
