"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";

/**
 * The portal's own error boundary. It sits under portal/layout.tsx, so the
 * tenant's branded header stays on screen; without it a failed portal page
 * fell through to the root error page and the customer lost the whole shell.
 *
 * `retry`, not `reset`: that is the prop this Next.js version passes (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 */
export default function PortalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h2 className="text-lg font-semibold text-foreground">
        This page didn&apos;t load
      </h2>

      <p className="max-w-sm text-sm text-muted-foreground">
        Something went wrong on our side. Your requests are safe. Try again in a
        moment.
      </p>

      {error.digest && (
        <p className="text-xs text-muted-foreground/60">
          Error ID: {error.digest}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={() => retry()}
        className="mt-2 h-9 font-semibold"
      >
        Try again
      </Button>
    </div>
  );
}
