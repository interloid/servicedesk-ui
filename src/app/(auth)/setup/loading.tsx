import { PageLoader } from "@/components/shared/page-loader";

export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <PageLoader />
    </div>
  );
}
