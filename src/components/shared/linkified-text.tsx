import { Fragment } from "react";

// http(s) URLs and bare www. hosts. Anything else -- javascript:, data:,
// mailto: -- stays text, so a message can never carry a dangerous href.
const URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

// Sentence punctuation after a URL ("see https://x.com/a.") belongs to the
// sentence, not the link. A closing bracket stays when the URL opened one,
// as Wikipedia-style links do.
function trimTrailing(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (/[.,!?;:'"*]/.test(ch)) {
      end -= 1;
      continue;
    }
    const pair = ch === ")" ? "(" : ch === "]" ? "[" : ch === "}" ? "{" : null;
    if (pair) {
      const body = url.slice(0, end);
      const opens = body.split(pair).length - 1;
      const closes = body.split(ch).length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

/**
 * Plain text with its URLs as links that open in a new tab. Never renders the
 * text as HTML: every part is a text node or an <a> built here.
 */
export function LinkifiedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    const raw = trimTrailing(match[0]);
    const start = match.index ?? 0;
    if (!raw || /^www\.$/i.test(raw)) continue;

    if (start > last) parts.push(text.slice(last, start));
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    parts.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="font-medium text-brand-accent underline underline-offset-2 break-all hover:opacity-80"
      >
        {raw}
      </a>,
    );
    last = start + raw.length;
  }

  if (last === 0) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));

  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}
