import {
  discardTicketUploadsAction,
  prepareTicketUploadsAction,
} from "../actions/tickets.actions";
import type { TicketUploadedFile } from "../types/tickets.types";
import { createSupabaseClient } from "@/lib/supabase/client";

const ATTACHMENT_BUCKET = "ticket-attachments";

/**
 * Put a reply's (with `ticketId`) or a new ticket's (without) files in the
 * bucket from the browser, with upload URLs the server minted, and return the
 * paths to hand to the action that files them.
 *
 * The bytes never travel through a Server Action: the platform caps a request
 * body at 4.5 MB, well under the 20 MB attachments limit. Same shape as the
 * portal's prepareAndUpload. If any upload in the set fails, the ones that did
 * land are discarded before the error is thrown.
 */
export async function uploadTicketFiles(params: {
  tenantSlug: string;
  ticketId?: string;
  files: File[];
}): Promise<TicketUploadedFile[]> {
  const { tenantSlug, ticketId, files } = params;
  if (files.length === 0) return [];

  const prepared = await prepareTicketUploadsAction({
    tenantSlug,
    ticketId,
    files: files.map((f) => ({ name: f.name, size: f.size })),
  });
  if (!prepared.success) throw new Error(prepared.error);

  const storage = createSupabaseClient().storage.from(ATTACHMENT_BUCKET);
  const settled = await Promise.allSettled(
    prepared.targets.map(async (target, i) => {
      // Uploaded as the type the server chose from the extension; the
      // server refuses an object stored under any other type.
      const body = new Blob([files[i]], { type: target.mime });
      const { error } = await storage.uploadToSignedUrl(
        target.path,
        target.token,
        body,
      );
      if (error) throw new Error(`Couldn't upload ${target.name}. Try again.`);
      return { path: target.path, name: target.name };
    }),
  );

  const uploaded = settled.flatMap((r) =>
    r.status === "fulfilled" ? [r.value] : [],
  );
  const failed = settled.find(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (failed) {
    await discardTicketFiles(tenantSlug, ticketId, uploaded);
    throw failed.reason instanceof Error
      ? failed.reason
      : new Error("Couldn't upload those files. Try again.");
  }
  return uploaded;
}

/** Best-effort removal of uploads whose reply or ticket wasn't saved. */
export async function discardTicketFiles(
  tenantSlug: string,
  ticketId: string | undefined,
  uploaded: TicketUploadedFile[],
): Promise<void> {
  if (uploaded.length === 0) return;
  await discardTicketUploadsAction({
    tenantSlug,
    ticketId,
    paths: uploaded.map((u) => u.path),
  }).catch(() => undefined);
}
