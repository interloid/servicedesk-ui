import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import TicketDetailView from "@/features/tickets/components/ticket-detail-view";
import {
  fetchTicketAttachments,
  ASSIGNEE_ROLES,
  fetchTenantStaff,
  fetchTicketById,
  fetchTicketSlaEvents,
  fetchTicketSlaPolicy,
  fetchTicketTags,
  fetchTenantTags,
  fetchAutoCloseDays,
  getCurrentUserIdentity,
  getTicketMessages,
} from "@/features/tickets/services/tickets.service";
import { isUuid } from "@/lib/uuid";

interface TicketDetailPageProps {
  params: Promise<{ tenantSlug: string; ticketId: string }>;
}

export async function generateMetadata({
  params,
}: TicketDetailPageProps): Promise<Metadata> {
  const { tenantSlug, ticketId } = await params;
  const ticket = isUuid(ticketId)
    ? await fetchTicketById(tenantSlug, ticketId)
    : null;
  return {
    title: ticket ? `#${ticket.number} · ${ticket.subject}` : "Ticket",
  };
}

export default async function TicketDetailPage({
  params,
}: TicketDetailPageProps) {
  const { tenantSlug, ticketId } = await params;
  // A malformed id would reach Postgres as a 22P02 error; it is just a 404.
  if (!isUuid(ticketId)) notFound();

  const tenantId = await getTenantIdBySlug(tenantSlug);
  const ticket = tenantId ? await fetchTicketById(tenantSlug, ticketId) : null;

  if (!tenantId || !ticket) {
    notFound();
  }

  const [
    messages,
    attachments,
    slaEvents,
    staff,
    currentUser,
    slaPolicy,
    tags,
    tenantTags,
    autoCloseDays,
  ] = await Promise.all([
    getTicketMessages(ticketId, tenantId),
    fetchTicketAttachments(ticketId, tenantId),
    fetchTicketSlaEvents(ticketId, tenantId),
    fetchTenantStaff(tenantSlug),
    getCurrentUserIdentity(tenantSlug),
    fetchTicketSlaPolicy(ticket.sla_policy_id),
    fetchTicketTags(ticketId),
    fetchTenantTags(tenantSlug),
    fetchAutoCloseDays(tenantId),
  ]);

  // Tickets go to agents and managers; tenant admins can still be @mentioned.
  const agents = staff.filter((m) => ASSIGNEE_ROLES.includes(m.role));
  const canTakeTickets =
    !!currentUser?.role && ASSIGNEE_ROLES.includes(currentUser.role);

  return (
    <TicketDetailView
      key={ticket.id}
      messages={messages}
      ticket={ticket}
      attachments={attachments}
      slaEvents={slaEvents}
      tenantslug={tenantSlug}
      agents={agents}
      mentionableMembers={staff}
      currentUserId={currentUser?.id ?? null}
      canAssignToSelf={canTakeTickets}
      slaPolicy={slaPolicy}
      tags={tags}
      tenantTags={tenantTags}
      autoCloseDays={autoCloseDays}
    />
  );
}
