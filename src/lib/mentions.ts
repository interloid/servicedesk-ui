export type MentionSegment = {
  type: "text" | "mention";
  content: string;
  userId?: string;
};

// The name runs lazily up to the first "](user:<uuid>)"; it may not cross a
// line or another "@[", so plain text like "@[draft] … @[Bob](user:…)" still
// reads as text plus one mention. New names are stored with "\\", "[" and "]"
// escaped (serializeMention), so a "]" inside a name can't end it early; older
// rows stored the name raw, and the lazy match still reads those -- including
// names with a "]" in them, which the previous `[^\]]+` pattern left as raw
// markup with the user id showing.
const MENTION_REGEX =
  /@\[((?:\\.|(?!@\[)[^\\\n])+?)\]\(user:([a-f0-9-]{36})\)/g;

function escapeMentionName(name: string): string {
  return name.replace(/[\\[\]]/g, "\\$&");
}

function unescapeMentionName(name: string): string {
  // Only the three escapes serializeMention writes, so a raw backslash in an
  // older, unescaped name is left as it was.
  return name.replace(/\\([\\[\]])/g, "$1");
}

/**
 * Serialize a selected mention into stored form: @[Full Name](user:uuid)
 */
export function serializeMention(name: string, userId: string): string {
  return `@[${escapeMentionName(name)}](user:${userId})`;
}

/**
 * Split a stored message body into text and mention segments.
 */
export function parseMentions(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const re = new RegExp(MENTION_REGEX.source, "g");
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: body.slice(lastIndex, match.index),
      });
    }
    segments.push({
      type: "mention",
      content: unescapeMentionName(match[1]),
      userId: match[2],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < body.length) {
    segments.push({ type: "text", content: body.slice(lastIndex) });
  }

  return segments;
}

/**
 * Extract unique user ids referenced by serialized mentions in a body.
 */
export function extractMentionIds(body: string): string[] {
  const ids: string[] = [];
  for (const seg of parseMentions(body)) {
    if (seg.type === "mention" && seg.userId && !ids.includes(seg.userId)) {
      ids.push(seg.userId);
    }
  }
  return ids;
}

/**
 * Replace serialized mentions with a plain, user-facing display text
 * (e.g. "@Name") for use in notification/plain contexts.
 */
export function stripMentions(body: string): string {
  return body.replace(
    new RegExp(MENTION_REGEX.source, "g"),
    (_, name: string) => `@${unescapeMentionName(name)}`,
  );
}

/**
 * Replace serialized mentions with the bare name, for customer-facing text:
 * a mention is the team's way of pulling a colleague in, so the customer sees
 * only who was named, not the markup or the user id.
 */
export function mentionsToNames(body: string): string {
  return body.replace(
    new RegExp(MENTION_REGEX.source, "g"),
    (_, name: string) => unescapeMentionName(name),
  );
}

/**
 * stripMentions until nothing changes, for text a customer wrote. One pass
 * leaves nested markup behind: "@[@[x](user:id)](user:id)" becomes
 * "@[@x](user:id)", a valid mention chip. Every pass that changes the text
 * shortens it, so this ends.
 */
export function stripAllMentions(body: string): string {
  let prev: string;
  let text = body;
  do {
    prev = text;
    text = stripMentions(text);
  } while (text !== prev);
  return text;
}
