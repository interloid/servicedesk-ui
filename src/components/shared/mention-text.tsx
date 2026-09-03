"use client";

import { parseMentions } from "@/lib/mentions";

export function MentionText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const segments = parseMentions(text);
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.type === "mention" ? (
          <span
            key={i}
            className="inline-flex items-center rounded bg-brand-accent/10 px-1 font-semibold text-brand-accent"
          >
            @{seg.content}
          </span>
        ) : (
          <span key={i}>{seg.content}</span>
        ),
      )}
    </span>
  );
}
