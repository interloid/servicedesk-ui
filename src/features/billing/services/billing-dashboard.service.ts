import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  canManageTenantBilling,
  getTenantIdBySlug,
} from "@/features/tenancy/services/tenant-resolver";
import { describePlan } from "./billing.service";

export interface BillingDashboardData {
  accountName: string;
  accountId: string;
  /** tenants.id, printed as "Tenant ID" on invoices. */
  tenantId: string;
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
    /** The plan's tagline (plans.description, or the per-tier default). */
    description: string;
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
    sourceType: "card" | "paypal" | "none";
    type: string;
    last4: string;
    expiry: string;
    email?: string;
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

  pendingUpgrade?: {
    planName: string;
    planRate: number;
    /** The upgrade difference: target rate minus the current plan's rate. */
    amountDue: number;
    /**
     * The difference is PAID and only PayPal's confirmation of the new
     * monthly rate is outstanding. A price increase always needs the buyer to
     * approve it, so this is a normal stop on the way -- not a failure -- but
     * the plan does not move until they do.
     */
    awaitingConfirmation: boolean;
  } | null;
  invoices: Array<{
    id: string;
    date: string;
    description: string;
    seats: number;
    amount: string;
    status: string;
    pdfUrl?: string;
    /** "one_time" for an upgrade charge, "recurring" for a monthly charge. */
    invoiceType: "one_time" | "recurring";
    planName: string;
    periodStart: string;
    periodEnd: string;
    paidAt?: string;
    paymentMethod: string;
    transactionId?: string;
    billingEmail?: string;
    subtotal: string;
    tax: string;
    taxRate: string;
  }>;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

// period_start / period_end are calendar dates. Formatting them in the server's
// time zone would show the previous day on a server west of UTC.
function formatCalendarDate(value: string): string {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { ...DATE_FORMAT, timeZone: "UTC" },
  );
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleDateString("en-US", DATE_FORMAT);
}

// Amounts in the invoice's own currency. A code Intl rejects falls back to
// "<code> 0.00" instead of throwing while the page renders.
function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export async function fetchTenantBillingData(
  tenantSlug: string,
): Promise<BillingDashboardData | null> {
  const supabase = await createSupabaseServerClient();
  const sanitizedSlug = (tenantSlug || "").trim();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const callerTenantId = await getTenantIdBySlug(sanitizedSlug);

  if (!callerTenantId) return null;

  if (!(await canManageTenantBilling(user.id, callerTenantId))) return null;

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name, slug, plan_id")
    .eq("slug", sanitizedSlug)
    .single();

  if (tenantError || !tenant) return null;

  const { data: sub } = await supabase
    .from("subscriptions")
    // subscriptions has three FKs to plans (plan_id, next_plan_id,
    // pending_plan_id); the embed must name the one it means, or PostgREST
    // rejects the whole query as ambiguous (PGRST201).
    .select("*, plans!subscriptions_plan_id_fkey(*)")
    .eq("tenant_id", tenant.id)
    .in("status", ["active", "trialing"])
    .order("created_at", { ascending: false })
    .maybeSingle();

  // Both a scheduled change and an unfinished checkout live on the
  // subscription itself: next_plan_* is committed for the end of the paid
  // period, pending_* is a checkout the buyer has not completed. Their plans
  // are read by id rather than joined, so a missing one cannot break the page.
  type SwitchPlan = { name: string; price_month: number | string } | null;

  const readPlan = async (planId: string | null | undefined) => {
    if (!planId) return null;

    const { data } = await supabase
      .from("plans")
      .select("name, price_month")
      .eq("id", planId)
      .maybeSingle();

    return (data as SwitchPlan) ?? null;
  };

  const nextPlan = await readPlan(sub?.next_plan_id);
  const pendingPlan = await readPlan(sub?.pending_plan_id);

  let scheduledChange: BillingDashboardData["scheduledChange"] = null;

  if (sub?.next_plan_effective_at && nextPlan) {
    const effectiveAt = new Date(sub.next_plan_effective_at);
    const daysRemaining = Math.max(
      0,
      Math.ceil((effectiveAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    const rate = Number(nextPlan.price_month ?? 0);
    scheduledChange = {
      planName: nextPlan.name ?? "Free",
      planRate: rate > 0 ? `$${rate.toFixed(2)}/mo` : "$0.00/mo",
      effectiveAt: sub.next_plan_effective_at,
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

  type PlanFacts = {
    name?: string | null;
    price_month?: string | number | null;
    seat_limit?: number | null;
    description?: string | null;
  };

  let plan: PlanFacts | null = (sub?.plans as PlanFacts | null) ?? null;

  // No active subscription row (upgrade awaiting approval, agreement between
  // cancel and replacement): the plan card must still reflect the tenant's
  // actual plan, not fall back to "Free". The assignment on the tenants row
  // is the same source the plans page uses.
  if (!plan && tenant.plan_id) {
    const { data: tenantPlan } = await supabase
      .from("plans")
      .select("name, price_month, seat_limit, description")
      .eq("id", tenant.plan_id)
      .single();

    if (tenantPlan) {
      plan = tenantPlan;
    }
  }

  const planSeatLimit: number | undefined = plan?.seat_limit ?? undefined;

  const totalSeats = sub?.seats ?? planSeatLimit ?? 0;
  const unusedSeats = Math.max(0, totalSeats - usedSeats);

  const monthlyRate = Number(plan?.price_month ?? 0);

  // A committed next plan: the tenant keeps the current plan (and its charges)
  // until next_plan_effective_at, then moves. A scheduled move to Free is a
  // cancellation -- no further charges are made -- so the dashboard must stop
  // advertising auto-renewal and the full-rate next payment.
  const switchPlanRate = Number(nextPlan?.price_month ?? 0);
  const hasScheduledSwitch = !!sub?.next_plan_effective_at && nextPlan !== null;
  const isScheduledFree =
    hasScheduledSwitch &&
    (switchPlanRate === 0 || sub?.cancel_at_period_end === true);

  // An upgrade waiting on its one-time PayPal order. Surfaced so the "Next
  // payment" card can explain the one-off difference due now and the full rate
  // that follows.
  //
  // Only while it is genuinely in progress: capturing the order moves plan_id
  // onto the target and clears pending_order_id, so the one-time display
  // disappears and the card falls back to the normal next payment.
  let pendingUpgrade: BillingDashboardData["pendingUpgrade"] = null;
  if (
    sub?.pending_order_id &&
    pendingPlan &&
    sub.plan_id !== sub.pending_plan_id
  ) {
    const newPlanRate = Number(pendingPlan.price_month ?? 0);

    if (newPlanRate > monthlyRate) {
      pendingUpgrade = {
        planName: pendingPlan.name ?? "new plan",
        planRate: newPlanRate,
        // The difference, not a prorated share: they already paid for this
        // period on the cheaper plan.
        amountDue: Math.round((newPlanRate - monthlyRate) * 100) / 100,
        // Set below, once the invoices are in hand.
        awaitingConfirmation: false,
      };
    }
  }

  const totalAmount = monthlyRate.toFixed(2);

  // An upgrade difference is charged once, as its own order, and never
  // touches the recurring amount: the next due amount is simply the current
  // monthly rate -- unless a change is scheduled, in which case it is the
  // target plan's rate (Free = nothing further is charged).
  const nextDueAmount = hasScheduledSwitch ? switchPlanRate : monthlyRate;
  const nextDueAmountFormatted = nextDueAmount.toFixed(2);

  // A tenant with no PayPal agreement has paypal_subscription_id NULL; there
  // are no synthetic "FREE-" ids any more.
  const hasAgreement = Boolean(sub?.paypal_subscription_id);
  const isFreePlan = !hasAgreement || monthlyRate === 0;

  const { data: invoiceRows } = await supabase
    .from("invoices")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("period_start", { ascending: false })
    .order("invoice_number", { ascending: true });

  // A paid one-time invoice for the pending plan means the capture went
  // through and the upgrade is waiting on the buyer's PayPal confirmation
  // rather than on their payment. Read locally: the capture writes this
  // invoice, so there is no need to ask PayPal on every dashboard load.
  if (pendingUpgrade) {
    pendingUpgrade.awaitingConfirmation = (invoiceRows || []).some(
      (inv) =>
        inv.invoice_type === "one_time" &&
        inv.status === "paid" &&
        inv.plan_name === pendingUpgrade.planName,
    );
  }

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
      const planName: string = inv.plan_name ?? plan?.name ?? "ServiceDesk";
      const description = `${planName} · ${
        isOneTime ? "One-time upgrade" : "Monthly"
      }`;
      const statusLabel =
        inv.status === "paid"
          ? "Paid"
          : inv.status === "failed"
            ? "Failed"
            : inv.status === "refunded"
              ? "Refunded"
              : "Unpaid";
      const currency = inv.currency || "USD";
      const subtotalNum = Number(inv.subtotal ?? amountNum);
      const taxNum = Number(inv.tax ?? 0);

      return {
        id: inv.invoice_number || `INV-${inv.id.slice(0, 8).toUpperCase()}`,
        date: formatCalendarDate(inv.period_start),
        description,
        seats: inv.seats ?? (totalSeats > 0 ? totalSeats : 0),
        amount: formatMoney(amountNum, currency),
        status: statusLabel,
        pdfUrl,
        invoiceType: isOneTime ? ("one_time" as const) : ("recurring" as const),
        planName,
        periodStart: formatCalendarDate(inv.period_start),
        periodEnd: formatCalendarDate(inv.period_end),
        paidAt: inv.paid_at ? formatTimestamp(inv.paid_at) : undefined,
        paymentMethod: inv.payment_method || "PayPal",
        transactionId: inv.paypal_txn_id || undefined,
        billingEmail: inv.billing_email || undefined,
        subtotal: formatMoney(subtotalNum, currency),
        tax: formatMoney(taxNum, currency),
        taxRate:
          subtotalNum > 0
            ? `${Number(((taxNum / subtotalNum) * 100).toFixed(2))}%`
            : "0%",
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

  const latestInvoice =
    (invoiceRows || [])
      .filter((inv) => inv.status === "paid")
      .sort((a, b) => {
        const paidAt = (v: string | null | undefined) =>
          new Date(v ?? "").getTime() || 0;
        return (
          paidAt(b.paid_at ?? b.created_at) - paidAt(a.paid_at ?? a.created_at)
        );
      })[0] ?? null;
  const latestInvoicePaid = latestInvoice !== null;

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
    sub?.current_period_end && hasAgreement
      ? sub.current_period_end
      : undefined;

  return {
    accountName: tenant.name,
    accountId: tenant.slug.toUpperCase(),
    tenantId: tenant.id,
    billingStatus,
    isSuspended: billingStatus === "past_due",
    plan: {
      name: plan?.name ?? "Free",
      rate: isFreePlan ? "$0.00/mo" : `$${monthlyRate.toFixed(2)}/mo`,
      rateValue: monthlyRate,
      seatLimit: totalSeats,
      description: describePlan(plan?.name ?? "Free", plan?.description),
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
    lastPayment: latestInvoice
      ? {
          amount: `$${Number(latestInvoice.amount ?? 0).toFixed(2)}`,
          date: new Date(
            latestInvoice.paid_at ??
              latestInvoice.created_at ??
              latestInvoice.period_start,
          ).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
        }
      : undefined,
    paymentMethod: paymentMethodData,
    scheduledChange,
    pendingUpgrade,
    invoices,
  };
}
