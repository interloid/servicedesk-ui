import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the bucket says about a stored object, or null if it is not there.
 * The stored object -- not the client -- is the source of truth for size and
 * type, so a caller that lies about a 4 KB file cannot make a 4 GB one appear
 * in the thread as something small.
 *
 * Shared by the portal and the agent ticket uploads, which both have the
 * browser put files in the bucket and then report the paths.
 */
export async function statStoredObject(
  admin: SupabaseClient,
  bucket: string,
  directory: string,
  filename: string,
): Promise<{ size: number; mime: string } | null> {
  const { data, error } = await admin.storage
    .from(bucket)
    .list(directory, { search: filename, limit: 1 });

  const object = data?.find((entry) => entry.name === filename);

  if (error || !object) {
    if (error) {
      console.error("[storage] could not stat an upload:", error.message);
    }

    return null;
  }

  return {
    size: Number(object.metadata?.size ?? 0),
    mime:
      (object.metadata?.mimetype as string | undefined) ||
      "application/octet-stream",
  };
}
