/**
 * A search term as one value inside a PostgREST `or=(…)` filter, matched
 * anywhere with ilike: `query.or(\`name.ilike.${ilikeOrValue(term)}\`)`.
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
 * PostgREST still reads `*` as `%` in a like pattern; there is no escape for
 * that, so a `*` in the box widens the match. That only ever matches more of
 * the caller's own rows -- RLS and the other filters still apply.
 */
export function ilikeOrValue(term: string): string {
  const like = term.replace(/[\\%_]/g, "\\$&");

  return `"%${like.replace(/["\\]/g, "\\$&")}%"`;
}
