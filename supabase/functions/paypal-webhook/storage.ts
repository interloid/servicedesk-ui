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
      upsert: false,
    });

  await admin
    .from("invoices")
    .update({
      storage_path: storagePath,
    })
    .eq("id", invoiceId);

  if (error) {
    throw error;
  }

  return storagePath;
}

export async function getInvoiceSignedUrl(
  storagePath: string,
): Promise<string> {
  const { data, error } = await admin.storage
    .from("invoices")
    .createSignedUrl(storagePath, 60 * 60);

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
