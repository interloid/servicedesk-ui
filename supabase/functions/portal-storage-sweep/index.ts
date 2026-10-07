import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Deletes staged attachment uploads that were never filed.
//
// A file uploaded from the new-request form is parked under
// `<tenant>/staging/<batch>/` because there is no ticket id to put it against
// yet; attachStagedUploads moves it onto the ticket once the request exists. A
// customer who abandons the form -- or a bot posting straight at the form --
// leaves those bytes in the bucket forever, and nothing in the product ever
// reads from that prefix again. Daily, everything older than a day goes.
//
// One caller: pg_cron (migration 20260926120000), daily.
//
// Deletion goes through the Storage API rather than `delete from
// storage.objects`: the table is metadata, so deleting the row leaves the file
// itself in the bucket's backend, taking up quota for ever and invisible to
// anybody. The API call removes both.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is missing");
}

if (!SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = "ticket-attachments";
const STAGING_SEGMENT = "staging";

/**
 * A day. Long enough that somebody who closes the tab and comes back tomorrow
 * finds their files still there; short enough that abandoned drafts do not
 * accumulate.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Storage removes at most 100 paths per call. */
const REMOVE_BATCH_SIZE = 100;

/** One page of a storage listing, and of the tenants query. Both are paged. */
const PAGE_LIMIT = 1000;

function isServiceRole(req: Request): boolean {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return false;
  }

  if (token === SERVICE_ROLE_KEY) {
    return true;
  }

  // The gateway has already verified the signature; read the role claim.
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

type StoredEntry = {
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * Every object under one prefix, following folder listings, with each name
 * relative to that prefix (`<batch>/<file>`, not just `<file>`).
 *
 * `<tenant>/staging/<batch>/<file>` is two levels deep, so this walks the batch
 * folders rather than assuming a flat listing -- a flat list of `<tenant>/staging`
 * returns the batches and none of the files. The returned names keep the folder
 * they came from: the caller joins them onto the prefix to build the path it
 * removes, and a name without its batch segment points at nothing, so the
 * removal would "succeed" while deleting nothing.
 */
async function listRecursive(path: string): Promise<StoredEntry[]> {
  const files: StoredEntry[] = [];

  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list(path, { limit: PAGE_LIMIT, offset });

    if (error) {
      throw new Error(`listing ${path} failed: ${error.message}`);
    }

    const entries = data ?? [];

    for (const entry of entries) {
      // A "folder" in the storage API is a zero-byte object whose id is null.
      if (entry.id === null) {
        const nested = await listRecursive(`${path}/${entry.name}`);
        files.push(
          ...nested.map((file) => ({
            ...file,
            name: `${entry.name}/${file.name}`,
          })),
        );
        continue;
      }

      files.push({
        name: entry.name,
        created_at:
          (entry as { created_at?: string | null }).created_at ?? null,
        updated_at:
          (entry as { updated_at?: string | null }).updated_at ?? null,
      });
    }

    if (entries.length < PAGE_LIMIT) {
      return files;
    }
  }
}

/** Every tenant id, a page at a time -- one select is capped at max_rows. */
async function listTenantIds(): Promise<string[]> {
  const ids: string[] = [];

  for (let from = 0; ; from += PAGE_LIMIT) {
    const { data, error } = await admin
      .from("tenants")
      .select("id")
      .order("id")
      .range(from, from + PAGE_LIMIT - 1);

    if (error) {
      throw new Error(`tenants: ${error.message}`);
    }

    const page = data ?? [];
    ids.push(...page.map((row: { id: string }) => row.id));

    if (page.length < PAGE_LIMIT) {
      return ids;
    }
  }
}

function isStale(entry: StoredEntry, cutoff: number): boolean {
  // created_at is what decides it: updated_at moves when a file is moved onto a
  // ticket, and a file that has been moved is no longer under this prefix.
  const created = entry.created_at ? Date.parse(entry.created_at) : NaN;

  if (Number.isNaN(created)) {
    // No timestamp to judge it by. Left alone rather than deleted on a guess --
    // the cost of keeping one orphan is smaller than the cost of deleting a file
    // somebody is about to attach.
    return false;
  }

  return created < cutoff;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false }, { status: 405 });
  }

  if (!isServiceRole(req)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const cutoff = Date.now() - MAX_AGE_MS;

  let tenantIds: string[];

  try {
    tenantIds = await listTenantIds();
  } catch (error) {
    console.error(
      "[portal-storage-sweep]",
      error instanceof Error ? error.message : String(error),
    );
    return Response.json({ ok: false }, { status: 500 });
  }

  const stale: string[] = [];
  let scanned = 0;

  for (const tenantId of tenantIds) {
    const stagingPrefix = `${tenantId}/${STAGING_SEGMENT}`;

    let entries: StoredEntry[];

    try {
      entries = await listRecursive(stagingPrefix);
    } catch (error) {
      // One unreadable tenant prefix must not abandon the rest of the sweep.
      console.error(
        "[portal-storage-sweep]",
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    scanned += entries.length;

    for (const entry of entries) {
      if (isStale(entry, cutoff)) {
        stale.push(`${stagingPrefix}/${entry.name}`);
      }
    }
  }

  if (stale.length === 0) {
    return Response.json({ ok: true, scanned, removed: 0 });
  }

  let removed = 0;

  for (let i = 0; i < stale.length; i += REMOVE_BATCH_SIZE) {
    const batch = stale.slice(i, i + REMOVE_BATCH_SIZE);

    const { error } = await admin.storage.from(BUCKET).remove(batch);

    if (error) {
      console.error("[portal-storage-sweep] remove:", error.message);
      continue;
    }

    removed += batch.length;
  }

  console.log(
    `[portal-storage-sweep] scanned ${scanned} staged uploads, removed ${removed}`,
  );

  return Response.json({ ok: true, scanned, removed });
});
