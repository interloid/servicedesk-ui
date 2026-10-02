import { PageLoader } from "@/components/shared/page-loader";

/**
 * The portal layout is async — it resolves the tenant, the signed-in customer
 * and the support hours before it can render the header — and without this file
 * Next.js has no fallback for it, so a client-side navigation shows a blank
 * page until all three finish.
 *
 * A spinner rather than a skeleton, unlike the page-level loading files beside
 * it, and the same choice (base-layout)/loading.tsx makes. The shell is almost
 * entirely data: the brand header carries the tenant name, the avatar needs the
 * customer, and the footer needs the support hours. A skeleton could only draw
 * an empty frame with a fake wordmark in it, which looks more broken than a
 * spinner and says nothing about what is loading. Once the shell is up, the
 * page's own loading.tsx takes over with real shapes.
 */
export default function Loading() {
  return <PageLoader />;
}
