"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * A square copy control for one value on the customer page. The value is
 * always on screen beside it, so a refused clipboard points there rather than
 * just reporting failure.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied to your clipboard.`);
    } catch {
      toast.error("We couldn't copy that. Select the text and copy it.");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-9 shrink-0"
      aria-label={`Copy ${label.toLowerCase()}`}
      title={`Copy ${label.toLowerCase()}`}
      onClick={copy}
    >
      <Copy aria-hidden className="size-4" />
    </Button>
  );
}
