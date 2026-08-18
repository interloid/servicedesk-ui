import { LoadingSpinner } from "./loading-spinner";

export function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LoadingSpinner className="size-8 text-brand-accent" />
    </div>
  );
}
