import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface Subscription {
  id: string;
  tenant_id: string;
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

export async function createInvoice({
  subscription,
  payment,
}: {
  subscription: Subscription;
  payment: Payment;
}) {
  const invoiceNumber = await generateInvoiceNumber();

  const { data, error } = await admin
    .from("invoices")
    .insert({
      tenant_id: subscription.tenant_id,

      subscription_id: subscription.id,

      paypal_txn_id: payment.id,

      amount: Number(payment.amount.total),

      currency: payment.amount.currency,

      status: "paid",

      period_start: subscription.current_period_start,

      period_end: subscription.current_period_end,

      paid_at: payment.create_time,

      invoice_number: invoiceNumber,
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

async function generateInvoiceNumber() {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(now.getMonth() + 1).padStart(2, "0");

  const prefix = `INV-${year}${month}`;

  const { count } = await admin.from("invoices").select("*", {
    count: "exact",
    head: true,
  });

  const sequence = String((count ?? 0) + 1).padStart(6, "0");

  return `${prefix}-${sequence}`;
}
