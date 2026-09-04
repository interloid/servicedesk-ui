import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import TicketDetailView from "@/features/tickets/components/ticket-detail-view";
import {
  fetchTicketAttachments,
  fetchAssignableAgents,
  fetchMentionableMembers,
  fetchTicketSlaEvents,
  getCurrentUserIdentity,
  getTicketMessages,
  withVisibleAssignee,
} from "@/features/tickets/services/tickets.service";

interface TicketDetailPageProps {
  params: Promise<{ tenantSlug: string; ticketId: string }>;
}

export default async function TicketDetailPage({
  params,
}: TicketDetailPageProps) {
  const { tenantSlug, ticketId } = await params;
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenantSlug);
  const { data: ticket, error } = await supabase
    .from("tickets")
    .select(
      `
        *,
        customers:requester_customer_id (
          full_name,
          company,
          email
        ),
        assignee:assignee_user_id (
          full_name
        )
      `,
    )
    .eq("id", ticketId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching single ticket:", error.message);
  }

  if (!ticket) {
    notFound();
  }

  const cust = ticket.customers;
  const [formattedTicket] = await withVisibleAssignee(
    supabase,
    [
      {
        ...ticket,
        requester_name: cust
          ? cust.full_name || cust.email
          : "Unknown Customer",
        requester_company: cust?.company || "N/A",
      },
    ],
    tenantId!,
  );

  const [messages, attachments, slaEvents, agents, mentionable, currentUser] =
    await Promise.all([
      getTicketMessages(ticketId, tenantId!),
      fetchTicketAttachments(ticketId, tenantId!),
      fetchTicketSlaEvents(ticketId, tenantId!),
      fetchAssignableAgents(tenantSlug),
      fetchMentionableMembers(tenantSlug),
      getCurrentUserIdentity(tenantSlug),
    ]);

  return (
    <TicketDetailView
      key={ticket.id}
      messages={messages}
      ticket={formattedTicket}
      attachments={attachments}
      slaEvents={slaEvents}
      tenantslug={tenantSlug}
      agents={agents}
      mentionableMembers={mentionable}
      currentUserId={currentUser?.id ?? null}
    />
  );
}
