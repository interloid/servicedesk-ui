import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface BillingDashboardData {
  accountName: string;
  accountId: string;
  billingStatus: "active" | "past_due" | "cancelled" | "trialing";
  isSuspended?: boolean;
  suspensionReason?: {
    card?: string;
    invoiceId?: string;
    amount?: string;
  };
  plan: {
    name: string;
    rate: string;
    rateValue: number;
    seatLimit: number;
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
  renewalDateRaw?: string;
  autoRenew: boolean;
  amountDue: {
    current: string;
    next: string;
    unusedSeats: number;
  };
  lastPayment?: {
    amount: string;
    date: string;
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
  scheduledChange?: {
    planName: string;
    planRate: string;
    effectiveAt: string;
    daysRemaining: number;
  } | null;
  invoices: Array<{
    id: string;
    date: string;
    description: string;
    seats: number;
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

  const { data: pendingSwitch } = await supabase
    .from("subscription_switches")
    .select(
      "plan_id, effective_at, status, plans!subscription_switches_plan_id_fkey(name, price_month)",
    )
    .eq("tenant_id", tenant.id)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let scheduledChange: BillingDashboardData["scheduledChange"] = null;
  if (pendingSwitch?.effective_at && pendingSwitch.plans) {
    const switchPlan = Array.isArray(pendingSwitch.plans)
      ? pendingSwitch.plans[0]
      : pendingSwitch.plans;
    const effectiveAt = new Date(pendingSwitch.effective_at);
    const daysRemaining = Math.max(
      0,
      Math.ceil((effectiveAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    const rate = Number(switchPlan?.price_month ?? 0);
    scheduledChange = {
      planName: switchPlan?.name ?? "Free",
      planRate: rate > 0 ? `$${rate.toFixed(0)}/mo` : "$0/mo",
      effectiveAt: pendingSwitch.effective_at,
      daysRemaining,
    };
  }

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

  let planSeatLimit: number | undefined = plan?.seat_limit;

  // No active subscription: fall back to the tenant's assigned plan rather
  // than guessing a seat count, so limits always match the plans config.
  if (!sub && tenant.plan_id) {
    const { data: tenantPlan } = await supabase
      .from("plans")
      .select("seat_limit")
      .eq("id", tenant.plan_id)
      .single();
    planSeatLimit = tenantPlan?.seat_limit;
  }

  const totalSeats = sub?.seats ?? planSeatLimit ?? 0;
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

      const description = `${plan?.name ?? "Pro"} · Monthly`;

      return {
        id: inv.invoice_number || inv.id.slice(0, 8).toUpperCase(),
        date: new Date(inv.period_start).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        description,
        seats: totalSeats > 0 ? totalSeats : 0,
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
    const expiry =
      expiryMonth && expiryYear
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

  const latestInvoice = invoiceRows?.[0];
  const latestInvoicePaid = latestInvoice?.status === "paid";

  let billingStatus: BillingDashboardData["billingStatus"] = "active";
  if (sub?.status === "trialing") {
    billingStatus = "trialing";
  } else if (sub?.status === "suspended" || sub?.status === "past_due") {
    billingStatus = "past_due";
  } else if (sub?.status === "cancelled") {
    billingStatus = "cancelled";
  }

  const renewalRaw =
    sub?.current_period_end && !paypalSubId.startsWith("FREE-")
      ? sub.current_period_end
      : undefined;

  return {
    accountName: tenant.name,
    accountId: tenant.slug.toUpperCase(),
    billingStatus,
    isSuspended: billingStatus === "past_due",
    plan: {
      name: plan?.name ?? "Free",
      rate: isFreePlan ? "$0/mo" : `$${monthlyRate}/mo`,
      rateValue: monthlyRate,
      seatLimit: totalSeats,
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
      renewalRaw
        ? new Date(renewalRaw).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "N/A",
    renewalDateRaw: renewalRaw,
    autoRenew: !isFreePlan && !(sub?.status === "cancelled"),
    amountDue: {
      current: latestInvoicePaid ? "$0.00" : `$${totalAmount}`,
      next: isFreePlan ? "$0.00" : `$${totalAmount}`,
      unusedSeats: unusedSeats,
    },
    lastPayment:
      invoices.length > 0 && invoices[0].status === "Paid"
        ? { amount: invoices[0].amount, date: invoices[0].date }
        : undefined,
    paymentMethod: paymentMethodData,
    scheduledChange,
    invoices,
  };
}
