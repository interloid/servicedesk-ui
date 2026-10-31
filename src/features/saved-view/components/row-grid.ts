/**
 * Shared by the list's header, every row and the loading skeleton so the
 * columns line up. Lives outside the client list so the server-rendered
 * skeleton gets the string, not a client reference.
 */
export const ROW_GRID =
  "grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[2rem_3rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem] md:gap-x-4";
