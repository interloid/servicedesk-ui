import {
  ATTACHMENT_BUCKET,
  type PortalResult,
  type PortalUploadedFile,
  type PortalUploadTarget,
} from "@/features/portal/portal";
import { createSupabaseClient } from "@/lib/supabase/client";

type FileDescriptor = { name: string; size: number; type: string };

/**
 * Authorise a set of attachments, then put the bytes in the bucket from the
 * browser, using tokens the server minted.
 *
 * This exists because attachments cannot travel with the Server Action that
 * needs them: action bodies are capped at 1 MB by default and 4.5 MB by the
 * platform, well under any attachment limit worth offering. The server
 * authorises a path, this fills it, and the follow-up action records what
 * landed.
 *
 * One place for both forms (new request and reply), so the rollback lives here
 * once: if any upload in the set fails, the ones that did land are handed to
 * `discard` before the error is thrown, instead of being left in the bucket
 * with nothing pointing at them.
 *
 * Targets arrive in the same order as the files they were minted for.
 */
export async function prepareAndUpload(
  files: File[],
  prepare: (
    descriptors: FileDescriptor[],
  ) => Promise<PortalResult<{ targets: PortalUploadTarget[] }>>,
  discard: (paths: string[]) => Promise<void>,
): Promise<PortalUploadedFile[]> {
  if (files.length === 0) {
    return [];
  }

  const prepared = await prepare(
    files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
    })),
  );

  if (!prepared.success) {
    throw new Error(prepared.message);
  }

  const { targets } = prepared.data;

  if (targets.length === 0) {
    return [];
  }

  const supabase = createSupabaseClient();

  const settled = await Promise.allSettled(
    targets.map(async (target, index) => {
      const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .uploadToSignedUrl(target.path, target.token, files[index]);

      if (error) {
        throw new Error(`We couldn't upload ${target.name}. Try again.`);
      }

      return {
        path: target.path,
        name: target.name,
        size: target.size,
        mime: target.mime,
      } satisfies PortalUploadedFile;
    }),
  );

  const uploaded = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  if (failed) {
    await discard(uploaded.map((file) => file.path)).catch(() => undefined);

    throw failed.reason instanceof Error
      ? failed.reason
      : new Error("We couldn't upload those files. Try again.");
  }

  return uploaded;
}
