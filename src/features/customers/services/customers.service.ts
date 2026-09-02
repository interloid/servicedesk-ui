import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TicketStatus } from "@/features/tickets/types/tickets.types";

export interface Customer {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  created_at?: string;
}

export interface CustomerContact {
  id: string;
  name: string;
  email: string;
  company?: string | null;
  status: "active" | "invited";
}

export interface CustomerTicket {
  id: string;
  number: number | null;
  subject: string;
  status: TicketStatus;
  created_at: string;
}

export interface CustomerDetail {
  id: string;
  full_name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  created_at?: string;
  openTicketsCount: number;
  lifetimeTicketsCount: number;
  contacts: CustomerContact[];
  recentTickets: CustomerTicket[];
}

const OPEN_STATUSES = ["new", "open", "pending", "on_hold"];

export async function fetchTenantCustomers(
  tenant: string,
): Promise<Customer[]> {
  const supabase = await createSupabaseServerClient();
  const tenantid = await getTenantIdBySlug(tenant);

  if (!tenantid) {
    throw new Error(`Tenant not found for slug: ${tenant}`);
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, tenant_id, full_name, email, company, phone, created_at")
    .eq("tenant_id", tenantid)
    .order("full_name", { ascending: true });

  if (error) {
    console.error("Error fetching customers:", error.message);
    return [];
  }

  return (data as Customer[]) || [];
}

export async function fetchCustomerById(
  tenant: string,
  customerId: string,
): Promise<CustomerDetail | null> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) return null;

  const { data: customer, error } = await supabase
    .from("customers")
    .select("id, tenant_id, full_name, email, company, phone, created_at")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !customer) {
    console.error(
      `Error fetching customer ${customerId}:`,
      error?.message ?? "not found",
    );
    return null;
  }

  const { count: openTicketsCount } = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("requester_customer_id", customerId)
    .in("status", [...OPEN_STATUSES]);

  const { count: lifetimeTicketsCount } = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("requester_customer_id", customerId);

  const { data: recentRows } = await supabase
    .from("tickets")
    .select("id, number, subject, status, created_at")
    .eq("tenant_id", tenantId)
    .eq("requester_customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: companyContacts } = customer.company
    ? await supabase
        .from("customers")
        .select("id, full_name, email, company, portal_user_id")
        .eq("tenant_id", tenantId)
        .eq("company", customer.company)
        .neq("id", customerId)
    : { data: null };

  const contacts: CustomerContact[] = (companyContacts || []).map((c) => ({
    id: c.id,
    name: c.full_name,
    email: c.email,
    company: c.company,
    status: c.portal_user_id ? "active" : "invited",
  }));

  const recentTickets: CustomerTicket[] = (recentRows || []).map((t) => ({
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status as TicketStatus,
    created_at: t.created_at,
  }));

  return {
    id: customer.id,
    full_name: customer.full_name,
    email: customer.email,
    company: customer.company,
    phone: customer.phone,
    created_at: customer.created_at,
    openTicketsCount: openTicketsCount || 0,
    lifetimeTicketsCount: lifetimeTicketsCount || 0,
    contacts,
    recentTickets,
  };
}
