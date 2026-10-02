/**
 * What the requests list already knows about a request's thread, kept for the
 * request page's loading skeleton.
 *
 * loading.tsx renders before the request is read, so on its own it cannot know
 * whether the team has replied. The list row that was clicked does, so it
 * leaves the answer here on the way out. In-memory and per tab: a reload or a
 * pasted link has no hint, and the skeleton falls back to the one message
 * every request has.
 */
const teamReplies = new Map<string, boolean>();

export function rememberThreadHint(requestId: string, hasTeamReply: boolean) {
  teamReplies.set(requestId, hasTeamReply);
}

/** True or false when the list said so; undefined when nothing is known. */
export function threadHasTeamReply(requestId: string): boolean | undefined {
  return teamReplies.get(requestId);
}
