"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";

/**
 * Scoped to the signed-in shell. Without this, anything thrown while rendering a
 * tenant page falls through to the root error page, which drops the sidebar and
 * header and leaves the user with no way to navigate.
 */
export default function TenantError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h2 className="text-lg font-semibold text-foreground">
        This page didn&apos;t load
      </h2>

      <p className="max-w-sm text-sm text-muted-foreground">
        Something went wrong while loading this section. Your workspace and data
        are unaffected.
      </p>

      {error.digest && (
        <p className="text-xs text-muted-foreground/60">
          Error ID: {error.digest}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={() => unstable_retry()}
        className="mt-2 h-9 font-semibold"
      >
        Try again
      </Button>
    </div>
  );
}
