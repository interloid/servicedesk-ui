export type MentionSegment = {
  type: "text" | "mention";
  content: string;
  userId?: string;
};

const MENTION_REGEX = /@\[([^\]]+)\]\(user:([a-f0-9-]{36})\)/g;

/**
 * Serialize a selected mention into stored form: @[Full Name](user:uuid)
 */
export function serializeMention(name: string, userId: string): string {
  return `@[${name}](user:${userId})`;
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
      content: match[1],
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
  return body.replace(MENTION_REGEX, "@$1");
}
