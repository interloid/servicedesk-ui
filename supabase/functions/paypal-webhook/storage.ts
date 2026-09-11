import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export async function uploadInvoicePdf(
  tenantId: string,
  invoiceId: string,
  pdf: Uint8Array,
): Promise<string> {
  const fileName = `INV-${invoiceId}.pdf`;

  const storagePath = `${tenantId}/${fileName}`;

  const { error } = await admin.storage
    .from("invoices")
    .upload(storagePath, pdf, {
      contentType: "application/pdf",
      // A converged retry re-uploads over the partial object from an earlier
      // failed delivery rather than tripping the 409 "already exists" error.
      upsert: true,
    });

  // The caller decides whether the upload succeeded before writing
  // storage_path: persisting it here on a failed upload would leave the row
  // pointing at a file that does not exist, and the idempotency guard would
  // then skip the PDF on every retry.
  if (error) {
    throw error;
  }

  return storagePath;
}

export async function getInvoiceSignedUrl(
  storagePath: string,
  expiresInSeconds = 60 * 60 * 24 * 7,
): Promise<string> {
  const { data, error } = await admin.storage
    .from("invoices")
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    throw error;
  }

  return data.signedUrl;
}

export async function deleteInvoicePdf(storagePath: string) {
  const { error } = await admin.storage.from("invoices").remove([storagePath]);

  if (error) {
    throw error;
  }
}
