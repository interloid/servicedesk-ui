import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ tenantSlug: string }>;
}

/**
 * Cancelling is a popup on the plans page now, not a page of its own. The route
 * stays as a redirect so older links and bookmarks land somewhere useful
 * instead of 404ing.
 */
export default async function Page({ params }: PageProps) {
  const { tenantSlug } = await params;

  redirect(`/${tenantSlug}/account/plans`);
}
