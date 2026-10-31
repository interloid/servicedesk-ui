/**
 * A search term as one value inside a PostgREST `or=(…)` filter, matched
 * anywhere with ilike: `query.or(\`name.ilike.${ilikeOrValue(term)}\`)`.
 * The one helper for this: tickets, customers, audit and the portal all use
 * it, so the same text finds the same rows on every screen.
 *
 * Two layers of escaping, in this order:
 *
 * 1. LIKE: `%`, `_` and `\` are wildcards or the escape character, so each is
 *    backslash-escaped to match itself. "50%" finds "50%", not "50" and
 *    anything after it.
 * 2. PostgREST: inside `or=(…)` a bare `,`, `(` or `)` ends the value, and
 *    PostgREST only honours escapes inside double quotes. So the whole value
 *    is quoted, with `"` and `\` escaped inside it. "login, again" stays one
 *    term instead of breaking the filter.
 *
 * PostgREST rewrites every `*` in a like pattern to `%` before Postgres sees
 * it, escaped or not (`\*` would become `\%`, a literal percent). So a typed
 * `*` is sent as `_`, one of any character: it still matches the `*` itself,
 * and widens the match by a single character at most.
 */
export function ilikeOrValue(term: string): string {
  const like = term.replace(/[\\%_]/g, "\\$&").replace(/\*/g, "_");

  return `"%${like.replace(/["\\]/g, "\\$&")}%"`;
}
