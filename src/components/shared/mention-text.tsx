"use client";

import { LinkifiedText } from "@/components/shared/linkified-text";
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
            className="inline-flex items-center rounded px-1 font-semibold text-brand-accent"
          >
            {seg.content}
          </span>
        ) : (
          <span key={i}>
            <LinkifiedText text={seg.content} />
          </span>
        ),
      )}
    </span>
  );
}
