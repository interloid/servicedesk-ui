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
      className={cn("h-0.75 w-full overflow-hidden", className)}
    >
      <div
        data-state={active ? "loading" : "finishing"}
        onTransitionEnd={(event) => {
          if (!active && event.propertyName === "opacity") setVisible(false);
        }}
        className="bg-primary progress-sweep h-full w-full origin-left rounded-full"
      />
    </div>
  );
}
