"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "./globals.css";

export default function GlobalError({
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
   
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <h1 className="text-4xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-foreground/70">
          A critical error occurred. Please try again.
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
      </body>
    </html>
  );
}
