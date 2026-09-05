import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface Subscription {
  id: string;
  tenant_id: string;
  created_at?: string;
  current_period_start?: string;
  current_period_end?: string;
}

interface Payment {
  id: string;
  create_time?: string;
  amount: {
    total?: string;
    currency?: string;
  };
}

// Inserts only columns that exist on public.invoices:
//   id, tenant_id, paypal_txn_id, amount, status,
//   storage_path, period_start, period_end, created_at, updated_at
//
// Customer-facing invoice numbers are derived from the row id as
// "INV-" + first 8 hex chars, matching how the billing dashboard
// renders them (INV-DE35DB27). There is no invoice_number column.
export async function createInvoice({
  subscription,
  payment,
}: {
  subscription: Subscription;
  payment: Payment;
}) {
  const { data, error } = await admin
    .from("invoices")
    .insert({
      tenant_id: subscription.tenant_id,

      paypal_txn_id: payment.id,

      amount: Number(payment.amount.total),

      status: "paid",

      period_start: subscription.created_at
        ? subscription.created_at.substring(0, 10)
        : undefined,

      period_end: subscription.current_period_end
        ? subscription.current_period_end.substring(0, 10)
        : undefined,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateInvoiceStorage(
  invoiceId: string,
  storagePath: string,
) {
  const { error } = await admin
    .from("invoices")
    .update({
      storage_path: storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  if (error) {
    throw error;
  }
}

export async function refundInvoice(paypalTxnId: string) {
  const { error } = await admin
    .from("invoices")
    .update({
      status: "refunded",
      updated_at: new Date().toISOString(),
    })
    .eq("paypal_txn_id", paypalTxnId);

  if (error) {
    throw error;
  }
}

export async function failInvoice(paypalTxnId: string) {
  const { error } = await admin
    .from("invoices")
    .update({
      status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("paypal_txn_id", paypalTxnId);

  if (error) {
    throw error;
  }
}