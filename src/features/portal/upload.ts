import {
  ATTACHMENT_BUCKET,
  type PortalUploadedFile,
  type PortalUploadTarget,
} from "@/features/portal/portal";
import { createSupabaseClient } from "@/lib/supabase/client";

/**
 * Put the bytes in the bucket, from the browser, using tokens the server
 * minted.
 *
 * This exists because attachments cannot travel with the Server Action that
 * needs them: action bodies are capped at 1 MB by default and 4.5 MB by the
 * platform, well under any attachment limit worth offering. The server
 * authorises a path, this fills it, and the follow-up action records what
 * landed.
 *
 * Targets arrive in the same order as the files they were minted for.
 */
export async function uploadToTargets(
  targets: PortalUploadTarget[],
  files: File[],
): Promise<PortalUploadedFile[]> {
  if (targets.length === 0) {
    return [];
  }

  const supabase = createSupabaseClient();

  return Promise.all(
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
      };
    }),
  );
}
