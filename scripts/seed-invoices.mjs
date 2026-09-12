/**
 * Dev-only invoice seeder -- fills billing history so pagination can be tested.
 *
 *   node --env-file=.env.local scripts/seed-invoices.mjs [--count 18] [--tenant <id|slug>]
 *   node --env-file=.env.local scripts/seed-invoices.mjs --clean
 *
 * Every row it writes is tagged with a SEED- paypal_txn_id, so --clean removes
 * exactly what this script created and nothing else. Never run against prod.
 */
import { createClient } from "@supabase/supabase-js";

const SEED_PREFIX = "SEED-";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with: node --env-file=.env.local scripts/seed-invoices.mjs",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

async function resolveTenant() {
  const wanted = flag("tenant");

  if (wanted) {
    const column = /^[0-9a-f-]{36}$/i.test(wanted) === true ? "id" : "slug";
    const { data, error } = await supabase
      .from("tenants")
      .select("id, name, slug")
      .eq(column, wanted)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error(`No tenant matching "${wanted}"`);
    return data;
  }

  // Default to the tenant that already has a subscription, so the seeded
  // invoices line up with the plan the billing page is showing.
  const { data: subs, error: subErr } = await supabase
    .from("subscriptions")
    .select("tenant_id, tenants(id, name, slug)")
    .order("created_at", { ascending: true })
    .limit(1);

  if (subErr) throw subErr;
  if (subs?.[0]?.tenants) return subs[0].tenants;

  const { data: tenants, error } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  if (!tenants?.length) throw new Error("No tenants exist yet.");
  return tenants[0];
}

async function clean(tenant) {
  const { data, error } = await supabase
    .from("invoices")
    .delete()
    .eq("tenant_id", tenant.id)
    .like("paypal_txn_id", `${SEED_PREFIX}%`)
    .select("id");

  if (error) throw error;
  console.log(
    `Removed ${data?.length ?? 0} seeded invoice(s) from ${tenant.name}.`,
  );
}

async function seed(tenant, count) {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, seats, paypal_subscription_id, plans(name, price_month)")
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  const planName = sub?.plans?.name ?? "Pro";
  const seats = sub?.seats ?? 3;
  const monthly = Number(sub?.plans?.price_month ?? 29);
  const rate = monthly > 0 ? monthly : 29;

  const { data: owner } = await supabase
    .from("memberships")
    .select("users(email)")
    .eq("tenant_id", tenant.id)
    .eq("role", "tenant_admin")
    .limit(1)
    .maybeSingle();

  const billingEmail = owner?.users?.email ?? `billing@${tenant.slug}.test`;

  // Continue the per-tenant INV-### sequence instead of letting the insert
  // trigger assign numbers: within one multi-row insert the trigger's max()
  // can't see the rows ahead of it, which would collide on the unique index.
  const { data: existing } = await supabase
    .from("invoices")
    .select("invoice_number")
    .eq("tenant_id", tenant.id)
    .not("invoice_number", "is", null);

  let nextSeq =
    (existing ?? []).reduce((max, row) => {
      const n = Number(String(row.invoice_number).replace(/[^0-9]/g, ""));
      return Number.isFinite(n) && n > max ? n : max;
    }, 0) + 1;

  // Oldest first so the newest seeded invoice carries the highest number,
  // matching how real charges accumulate.
  const rows = [];
  for (let i = count; i >= 1; i--) {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCMonth(start.getUTCMonth() - i);

    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);

    const next = new Date(start);
    next.setUTCMonth(next.getUTCMonth() + 1);

    // A spread of statuses so the badges and the "amount due" column are
    // exercised, not just the happy path.
    const status =
      i === 3 ? "failed" : i === 6 ? "refunded" : i === 9 ? "pending" : "paid";
    const settled = status === "paid" || status === "refunded";

    // Every fourth invoice is a one-time upgrade charge at a different amount.
    const isOneTime = i % 4 === 0;
    const amount = Number((isOneTime ? rate * 0.5 : rate * seats).toFixed(2));
    const seq = nextSeq++;

    rows.push({
      tenant_id: tenant.id,
      paypal_txn_id: `${SEED_PREFIX}${tenant.slug ?? "t"}-${String(seq).padStart(3, "0")}`,
      invoice_number: `INV-${String(seq).padStart(3, "0")}`,
      invoice_type: isOneTime ? "one_time" : "recurring",
      subscription_id: sub?.id ?? null,
      paypal_subscription_id: sub?.paypal_subscription_id ?? null,
      amount,
      subtotal: amount,
      tax: 0,
      amount_paid: settled ? amount : 0,
      balance_due: settled ? 0 : amount,
      currency: "USD",
      status,
      plan_name: planName,
      seats,
      payment_method: "PayPal",
      period_start: start.toISOString().slice(0, 10),
      period_end: end.toISOString().slice(0, 10),
      paid_at: settled ? end.toISOString() : null,
      next_billing_date: next.toISOString(),
      next_billing_amount: Number((rate * seats).toFixed(2)),
      billing_email: billingEmail,
      created_at: end.toISOString(),
    });
  }

  const { data, error } = await supabase
    .from("invoices")
    .insert(rows)
    .select("invoice_number, status, amount, period_start");

  if (error) throw error;

  console.log(
    `Seeded ${data.length} invoice(s) for ${tenant.name} (${planName}, ${seats} seat(s)):`,
  );
  for (const row of data) {
    console.log(
      `  ${row.invoice_number}  ${row.period_start}  ${row.status.padEnd(8)} $${row.amount}`,
    );
  }
  console.log("\nRe-run with --clean to remove them.");
}

const tenant = await resolveTenant();

if (has("clean")) {
  await clean(tenant);
} else {
  const count = Number(flag("count") ?? 18);
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    console.error("--count must be an integer between 1 and 200");
    process.exit(1);
  }
  await seed(tenant, count);
}
