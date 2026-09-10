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
    /**
     * What PayPal actually reported. "card" only when PayPal returned card
     * metadata; "paypal" for a wallet-funded subscription, where PayPal does
     * not disclose the underlying card; "none" when nothing is on file yet.
     */
    sourceType: "card" | "paypal" | "none";
    /** Display label: the card brand, or "PayPal". */
    type: string;
    last4: string;
    /** "MM/YYYY" for a card, otherwise "N/A". */
    expiry: string;
    email?: string;
    /** Payer name PayPal reported once the buyer approved, if any. */
    payerName?: string;
    payerCountry?: string;
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
  /**
   * An immediate upgrade in progress: a one-time PayPal order was created
   * for `newPlanRate - proratedCredit` and is awaiting the buyer's payment.
   * Once paid, the full-rate subscription begins and the next payment is
   * the full `newPlanRate`.
   */
  pendingUpgrade?: {
    planName: string;
    planRate: number;
    proratedCredit: number;
    amountDue: number;
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
      "plan_id, effective_at, status, old_plan_id, old_current_period_end, plans!subscription_switches_plan_id_fkey(name, price_month)",
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

  // A pending switch with an effective date is a scheduled change: the tenant
  // keeps the current plan (and its charges) until effective_at, then moves to
  // the target plan. A scheduled downgrade to Free means the subscription is
  // effectively cancelled -- no further charges are made -- so the dashboard
  // must stop advertising auto-renewal and the full-rate next payment.
  const switchPlan = pendingSwitch?.plans
    ? Array.isArray(pendingSwitch.plans)
      ? pendingSwitch.plans[0]
      : pendingSwitch.plans
    : null;
  const switchPlanRate = Number(switchPlan?.price_month ?? 0);
  const hasScheduledSwitch =
    !!pendingSwitch?.effective_at && switchPlan !== null;
  const isScheduledFree = hasScheduledSwitch && switchPlanRate === 0;

  // An immediate upgrade awaiting its one-time PayPal order payment shows a
  // pending switch with no effective_at (it takes effect right away once the
  // buyer pays). Surface it so the "Next payment" card can explain the
  // one-time amount due and the subsequent full-rate subscription.
  //
  // Only while the upgrade is genuinely in progress: once the buyer has paid
  // and the subscription was switched, the current subscription's plan_id
  // matches the switch's target, so the one-time display must disappear and
  // the card falls back to the normal full-rate next payment.
  let pendingUpgrade: BillingDashboardData["pendingUpgrade"] = null;
  if (
    pendingSwitch &&
    !pendingSwitch.effective_at &&
    pendingSwitch.plans &&
    ["pending", "approved"].includes(pendingSwitch.status ?? "") &&
    sub?.plan_id !== pendingSwitch.plan_id
  ) {
    const switchPlan = Array.isArray(pendingSwitch.plans)
      ? pendingSwitch.plans[0]
      : pendingSwitch.plans;
    const newPlanRate = Number(switchPlan?.price_month ?? 0);

    if (newPlanRate > monthlyRate) {
      const periodEnd = sub?.current_period_end
        ? new Date(sub.current_period_end)
        : null;
      let credit = 0;
      if (periodEnd && periodEnd.getTime() > Date.now() && monthlyRate > 0) {
        const periodStart = new Date(
          periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000,
        );
        const totalDays = Math.max(
          1,
          Math.ceil(
            (periodEnd.getTime() - periodStart.getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        );
        const remainingDays = Math.max(
          0,
          Math.ceil((periodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        );
        credit =
          Math.round((monthlyRate * remainingDays * 100) / totalDays) / 100;
      }

      pendingUpgrade = {
        planName: switchPlan?.name ?? "new plan",
        planRate: newPlanRate,
        proratedCredit: credit,
        amountDue: Math.round(Math.max(0, newPlanRate - credit) * 100) / 100,
      };
    }
  }

  const totalAmount = monthlyRate.toFixed(2);

  // The prorated credit is a one-time discount applied at upgrade time, not to
  // the running subscription's next renewal, so the next due amount is simply
  // the current monthly rate -- unless a switch is scheduled, in which case it
  // is the target plan's rate (Free = nothing further is charged).
  const nextDueAmount = hasScheduledSwitch ? switchPlanRate : monthlyRate;
  const nextDueAmountFormatted = nextDueAmount.toFixed(2);

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

      const isOneTime = inv.invoice_type === "one_time";
      const description = `${inv.plan_name ?? plan?.name ?? "ServiceDesk"} · ${
        isOneTime ? "One-time upgrade" : "Monthly"
      }`;
      const statusLabel =
        inv.status === "paid"
          ? "Paid"
          : inv.status === "failed"
            ? "Failed"
            : "Unpaid";

      return {
        id: inv.invoice_number || `INV-${inv.id.slice(0, 8).toUpperCase()}`,
        date: new Date(inv.period_start).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        description,
        seats: inv.seats ?? (totalSeats > 0 ? totalSeats : 0),
        amount: `$${amountNum.toFixed(2)}`,
        status: statusLabel,
        pdfUrl,
      };
    }),
  );

  let paymentMethodData: BillingDashboardData["paymentMethod"];

  if (paymentMethod) {
    paymentMethodData = {
      sourceType: "paypal",
      type: "PayPal",
      last4: "N/A",
      expiry: "N/A",
      email: paymentMethod.paypal_email || undefined,
      payerName: paymentMethod.paypal_payer_name || undefined,
      payerCountry: paymentMethod.paypal_payer_country || undefined,
      brand: undefined,
      bin: undefined,
      issuer: undefined,
      country: undefined,
      status: paymentMethod.status || undefined,
    };
  } else {
    paymentMethodData = {
      sourceType: "none",
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
  } else if (isScheduledFree) {
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
    renewalDate: renewalRaw
      ? new Date(renewalRaw).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "N/A",
    renewalDateRaw: renewalRaw,
    autoRenew:
      !isFreePlan && !(sub?.status === "cancelled") && !isScheduledFree,
    amountDue: {
      current: latestInvoicePaid ? "$0.00" : `$${totalAmount}`,
      next: isFreePlan ? "$0.00" : `$${nextDueAmountFormatted}`,
      unusedSeats: unusedSeats,
    },
    lastPayment:
      invoices.length > 0 && invoices[0].status === "Paid"
        ? { amount: invoices[0].amount, date: invoices[0].date }
        : undefined,
    paymentMethod: paymentMethodData,
    scheduledChange,
    pendingUpgrade,
    invoices,
  };
}
