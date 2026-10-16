"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function IndeterminateProgress({
  active,
  label = "Loading",
  className,
}: {
  active: boolean;
  label?: string;
  className?: string;
}) {
  const [visible, setVisible] = useState(active);

  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setVisible(true);
  }

  if (!visible) return null;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy={active}
      data-state={active ? "loading" : "finishing"}
      className={cn("progress-track h-0.75 w-full overflow-hidden", className)}
    >
      {/* Loops while loading (a request has no known length), then fills
          the track and fades out; progress-sweep in globals.css. */}
      <div
        data-state={active ? "loading" : "finishing"}
        onTransitionEnd={(event) => {
          if (!active && event.propertyName === "opacity") setVisible(false);
        }}
        className="progress-sweep h-full rounded-full bg-brand-accent"
      />
    </div>
  );
}
