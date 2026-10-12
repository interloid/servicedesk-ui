/**
 * Most a ticket reply or a new ticket can attach, all files together. The
 * Server Action body limit in next.config.ts sits a little above it, so the
 * request still fits with the rest of the form.
 */
export const TICKET_ATTACHMENTS_MAX_BYTES = 20 * 1024 * 1024;

/** An error to show when `files` is over the limit, else null. */
export function attachmentsTooLarge(files: File[]): string | null {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  return total > TICKET_ATTACHMENTS_MAX_BYTES
    ? "Attachments are limited to 20 MB in total."
    : null;
}
