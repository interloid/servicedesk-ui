/**
 * Most a ticket reply or a new ticket can attach, all files together. The
 * Server Action body limit in next.config.ts sits a little above it, so the
 * request still fits with the rest of the form.
 */
export const TICKET_ATTACHMENTS_MAX_BYTES = 20 * 1024 * 1024;

/** Most files one reply or new ticket can carry. */
export const TICKET_ATTACHMENTS_MAX_FILES = 10;

/**
 * The file types staff may attach, by extension, with the content type each is
 * stored under. The stored type comes from here, never from the browser's
 * `file.type`, so a file can't be uploaded as `text/html` or `image/svg+xml`
 * and later render as active content from a signed link. Text-like formats
 * that a browser could interpret (xml, log, md...) are stored as text/plain.
 *
 * Broad on purpose: the reply composer has always taken any file, and support
 * work runs on logs, office documents, archives and screenshots. Covers the
 * create-ticket picker's `accept` list (.png,.jpg,.jpeg,.pdf,.log).
 */
export const TICKET_ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  // Text, logs and data
  txt: "text/plain",
  log: "text/plain",
  md: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  xml: "text/plain",
  yaml: "text/plain",
  yml: "text/plain",
  // Mail
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  // Archives
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  gz: "application/gzip",
  tgz: "application/gzip",
  tar: "application/x-tar",
  // Audio / video (screen recordings, voicemails)
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

/** The `accept` attribute value for a file input taking these types. */
export const TICKET_ATTACHMENT_ACCEPT = Object.keys(TICKET_ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

/**
 * A file name's extension, lower-case and reduced to [a-z0-9] (at most 10
 * characters), or "" when it has none. Safe to put in a storage key.
 */
export function attachmentExtension(name: string): string {
  const raw = (name.match(/\.([^./\\]+)$/) || [])[1] ?? "";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);
}

/** The content type to store a file under, or null when it isn't allowed. */
export function attachmentContentType(name: string): string | null {
  const ext = attachmentExtension(name);
  return Object.prototype.hasOwnProperty.call(TICKET_ATTACHMENT_TYPES, ext)
    ? TICKET_ATTACHMENT_TYPES[ext]
    : null;
}

/** An error to show when `files` is over the limit, else null. */
export function attachmentsTooLarge(files: File[]): string | null {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  return total > TICKET_ATTACHMENTS_MAX_BYTES
    ? "Attachments are limited to 20 MB in total."
    : null;
}

/**
 * Every rule a set of attachments must pass -- count, total size, type -- as
 * the first error to show, else null.
 */
export function attachmentsError(
  files: { name: string; size: number }[],
): string | null {
  if (files.length > TICKET_ATTACHMENTS_MAX_FILES) {
    return `Attach up to ${TICKET_ATTACHMENTS_MAX_FILES} files at a time.`;
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > TICKET_ATTACHMENTS_MAX_BYTES) {
    return "Attachments are limited to 20 MB in total.";
  }
  const blocked = files.find((f) => !attachmentContentType(f.name));
  if (blocked) {
    return `${blocked.name} can't be attached: that file type isn't allowed.`;
  }
  return null;
}
