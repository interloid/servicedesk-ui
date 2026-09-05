import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface BillingDashboardData {
  accountName: string;
  accountId: string;
  isSuspended?: boolean;
  suspensionReason?: {
    card?: string;
    invoiceId?: string;
    amount?: string;
  };
  plan: {
    name: string;
    rate: string;
  };
  agents: {
    active: number;
    admins: number;
    regular: number;
  };
  seats: {
    used: number;
    total: number;
    unused: number;
  };
  renewalDate: string;
  amountDue: {
    total: string;
    unusedSeats: number;
  };
  paymentMethod: {
    type: string;
    last4: string;
    expiry: string;
    email?: string;
    brand?: string;
    bin?: string;
    issuer?: string;
    country?: string;
    status?: string;
  };
  invoices: Array<{
    id: string;
    date: string;
    agents: number;
    amount: string;
    status: string;
    pdfUrl?: string;
  }>;
}

export async function fetchTenantBillingData(
  tenantSlug: string,
): Promise<BillingDashboardData | null> {
  const supabase = await createSupabaseServerClient();
  const sanitizedSlug = (tenantSlug || "").trim();

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name, slug, plan_id")
    .eq("slug", sanitizedSlug)
    .single();

  if (tenantError || !tenant) return null;

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("*, plans(*)")
    .eq("tenant_id", tenant.id)
    .in("status", ["active", "trialing"])
    .order("created_at", { ascending: false })
    .maybeSingle();

  const { data: paymentMethod } = await supabase
    .from("payment_methods")
    .select("*")
    .eq("tenant_id", tenant.id)
    .eq("is_default", true)
    .eq("status", "active")
    .maybeSingle();

  const { data: activeMembers } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("status", "active");

  const members = activeMembers || [];
  const usedSeats = members.length;

  const adminCount = members.filter(
    (m) => m.role === "tenant_admin" || m.role === "owner",
  ).length;
  const regularCount = usedSeats - adminCount;

  const plan = sub?.plans;
  const totalSeats = sub?.seats ?? plan?.seat_limit ?? 2;
  const unusedSeats = Math.max(0, totalSeats - usedSeats);

  const monthlyRate = Number(plan?.price_month ?? 0);

  const totalAmount = monthlyRate.toFixed(2);

  const paypalSubId = sub?.paypal_subscription_id || "";
  const isFreePlan = paypalSubId.startsWith("FREE-") || monthlyRate === 0;

  const { data: invoiceRows } = await supabase
    .from("invoices")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("period_start", { ascending: false });

  const invoices = await Promise.all(
    (invoiceRows || []).map(async (inv) => {
      const amountNum = Number(inv.amount ?? 0);

      let pdfUrl: string | undefined = undefined;

      if (inv.storage_path) {
        const cleanPath = inv.storage_path
          .replace(/^invoices\//, "")
          .replace(/^\//, "");
        const { data: signedData } = await supabase.storage
          .from("invoices")
          .createSignedUrl(cleanPath, 3600);

        pdfUrl = signedData?.signedUrl || undefined;
      }

      return {
        id: inv.invoice_number || inv.id.slice(0, 8).toUpperCase(),
        date: new Date(inv.period_start).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        agents: totalSeats > 0 ? totalSeats : 0,
        amount: `$${amountNum.toFixed(2)}`,
        status: inv.status === "paid" ? "Paid" : "Unpaid",
        pdfUrl,
      };
    }),
  );

  let paymentMethodData: BillingDashboardData["paymentMethod"];

  if (paymentMethod) {
    const expiryMonth = paymentMethod.card_expiry_month;
    const expiryYear = paymentMethod.card_expiry_year;
    const expiry = expiryMonth && expiryYear
      ? `${String(expiryMonth).padStart(2, "0")}/${String(expiryYear).slice(-2)}`
      : "N/A";

    paymentMethodData = {
      type:
        paymentMethod.card_brand ||
        (paymentMethod.payment_source_type === "paypal"
          ? "PayPal"
          : paymentMethod.payment_source_type) ||
        "PayPal",
      last4: paymentMethod.card_last4 || "N/A",
      expiry,
      email: paymentMethod.paypal_email || undefined,
      brand: paymentMethod.card_brand || undefined,
      bin: paymentMethod.card_bin || undefined,
      issuer: paymentMethod.card_issuer || undefined,
      country: paymentMethod.card_country || undefined,
      status: paymentMethod.status || undefined,
    };
  } else {
    paymentMethodData = {
      type: isFreePlan ? "Free Tier" : "PayPal",
      last4: "N/A",
      expiry: "N/A",
    };
  }

  return {
    accountName: tenant.name,
    accountId: tenant.slug.toUpperCase(),
    plan: {
      name: plan?.name ?? "Free",
      rate: isFreePlan ? "$0/mo" : `$${monthlyRate}/mo`,
    },
    agents: {
      active: usedSeats,
      admins: adminCount,
      regular: regularCount,
    },
    seats: {
      used: usedSeats,
      total: totalSeats,
      unused: unusedSeats,
    },
    renewalDate:
      sub?.current_period_end && !paypalSubId.startsWith("FREE-")
        ? new Date(sub.current_period_end).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "N/A",
    amountDue: {
      total: `$${totalAmount}`,
      unusedSeats: unusedSeats,
    },
    paymentMethod: paymentMethodData,
    invoices,
  };
}
