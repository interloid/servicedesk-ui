const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a well-formed UUID. Check ids from URLs and form data with this
 * before they reach a uuid column: a malformed one makes Postgres raise 22P02
 * instead of simply matching nothing.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
