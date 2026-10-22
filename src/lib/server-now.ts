import "server-only";

import { cache } from "react";

/**
 * The server's clock, read once per request. Passed down so relative times
 * ("52 minutes ago") render the same on the server and in the browser, and
 * kept out of component bodies because Date.now() there is a render-purity
 * violation. One shared cache() so every component in a request sees the
 * same value.
 */
export const serverNow = cache(async function serverNow(): Promise<number> {
  return Date.now();
});
