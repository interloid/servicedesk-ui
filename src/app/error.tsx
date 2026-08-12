"use client";

import { useEffect } from "react";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-4xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-foreground/70">
        An unexpected error occurred. Please try again.
      </p>
      {error.digest && (
        <p className="text-xs text-foreground/40">Error ID: {error.digest}</p>
      )}
      <button
        onClick={() => unstable_retry()}
        className="mt-2 rounded-md border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:bg-foreground/10"
      >
        Try again
      </button>
    </div>
  );
}
