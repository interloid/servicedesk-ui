/** Longest tag the picker accepts. */
export const TAG_NAME_MAX = 40;

/**
 * Tags are stored lower-case with single spaces, so "Billing " and "billing"
 * are one tag (tags.uq_tag_name is case-sensitive).
 */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, TAG_NAME_MAX);
}
