"use server";

import { revalidatePath } from "next/cache";
import {
  fetchTenantTickets,
  createTenantTicket,
  updateTicketDetails,
  bulkUpdateTickets,
  createMessage,
  uploadTicketAttachments,
  getCurrentUserIdentity,
} from "../services/tickets.service";
import {
  CreateTicketPayload,
  MessageVisibility,
  TicketFilters,
  TicketPriority,
  TicketStatus,
} from "../types/tickets.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications.service";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import { extractMentionIds, stripMentions } from "@/lib/mentions";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export async function getTicketsAction(tenant: string, filters: TicketFilters) {
  try {
    return await fetchTenantTickets(tenant, filters);
  } catch (error: unknown) {
    return { error: errorMessage(error) };
  }
}

export async function createTicketAction(tenant: string, formData: FormData) {
  try {
    const subject = formData.get("subject") as string;
    const description = (formData.get("description") as string) || "";
    const requesterCustomerId = formData.get("requesterCustomerId") as string;
    const priority =
      (formData.get("priority") as "urgent" | "high" | "normal" | "low") ||
      "normal";
    const status =
      (formData.get("status") as
        "new" | "open" | "pending" | "solved" | "closed") || "new";

    if (!subject || !requesterCustomerId) {
      return { error: "Subject and Requester Customer ID are required." };
    }

    const newTicket = await createTenantTicket(tenant, {
      subject,
      description,
      requester_customer_id: requesterCustomerId,
      priority: priority.toLowerCase() as CreateTicketPayload["priority"],
      status: status.toLowerCase() as CreateTicketPayload["status"],
    });

    if (description.trim()) {
      await createMessage({
        tenantId: tenant,
        ticketId: newTicket.id,
        authorType: "customer",
        authorId: requesterCustomerId,
        body: description,
        visibility: "public",
      });
    }

    const files = (formData.getAll("files") as File[]).filter(
      (f) => f.size > 0,
    );
    if (files.length > 0 && newTicket) {
      await uploadTicketAttachments({
        tenant,
        ticketId: newTicket.id,
        files,
      });
    }

    revalidatePath(`/${tenant}/tickets`);
    return { success: true, ticket: newTicket };
  } catch (error: unknown) {
    return { error: errorMessage(error) };
  }
}

export async function sendTicketMessageAction(formData: FormData) {
  try {
    const ticketId = formData.get("ticketId") as string;
    const tenantId = formData.get("tenantId") as string;
    const body = (formData.get("body") as string) || "";
    const visibility = formData.get("visibility") as MessageVisibility;
    const files = (formData.getAll("files") as File[]).filter(
      (f) => f.size > 0,
    );

    if (!ticketId || !tenantId || (!body.trim() && files.length === 0)) {
      return { success: false, error: "Missing message content." };
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("Unauthorized");
    }

    const tenantIdResolved = await getTenantIdBySlug(tenantId);

    let message = null;
    if (body.trim()) {
      message = await createMessage({
        tenantId,
        ticketId,
        authorType: "agent",
        authorId: user.id,
        body,
        visibility,
      });
    }

    if (files.length > 0) {
      await uploadTicketAttachments({
        tenant: tenantId,
        ticketId,
        files,
        messageId: message?.id || null,
      });
    }

    if (visibility === "public" && tenantIdResolved) {
      const { data: ticket } = await supabase
        .from("tickets")
        .select("assignee_user_id, subject, number")
        .eq("id", ticketId)
        .eq("tenant_id", tenantIdResolved)
        .single();

      const notifyUserId =
        ticket?.assignee_user_id && ticket.assignee_user_id !== user.id
          ? ticket.assignee_user_id
          : null;

      if (notifyUserId) {
        await createNotification({
          tenantId: tenantIdResolved,
          userId: notifyUserId,
          type: "ticket_updated",
          payload: {
            ticket_id: ticketId,
            ticket_number: ticket?.number,
            subject: ticket?.subject,
            body: body.slice(0, 200),
          },
        });
      }
    }

    if (tenantIdResolved && body.trim()) {
      const mentionedIds = extractMentionIds(body);
      if (mentionedIds.length > 0) {
        const senderIdentity = await getCurrentUserIdentity(tenantId);
        const { data: ticket } = await supabase
          .from("tickets")
          .select("subject, number")
          .eq("id", ticketId)
          .eq("tenant_id", tenantIdResolved)
          .single();

        await Promise.all(
          mentionedIds
            .filter((id) => id !== user.id)
            .map((id) =>
              createNotification({
                tenantId: tenantIdResolved,
                userId: id,
                type: "mention",
                payload: {
                  ticket_id: ticketId,
                  ticket_number: ticket?.number,
                  subject: ticket?.subject,
                  sender_name: senderIdentity?.email || "Someone",
                  body: stripMentions(body).slice(0, 200),
                },
              }),
            ),
        );
      }
    }

    revalidatePath(`/${tenantId}/tickets/${ticketId}`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function updateTicketDetailsAction(formData: {
  ticketId: string;
  tenantId: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string;
  unassign?: boolean;
}) {
  try {
    const tenantIdResolved = await getTenantIdBySlug(formData.tenantId);

    await updateTicketDetails(formData.ticketId, formData.tenantId, {
      ...(formData.status && { status: formData.status }),
      ...(formData.priority && { priority: formData.priority }),
      ...(formData.unassign
        ? { assignee_user_id: null }
        : formData.assigneeId && { assignee_user_id: formData.assigneeId }),
    });

    if (
      !formData.unassign &&
      formData.assigneeId &&
      formData.assigneeId !== "unassigned" &&
      tenantIdResolved
    ) {
      const supabase = await createSupabaseServerClient();
      const { data: ticket } = await supabase
        .from("tickets")
        .select("subject, number")
        .eq("id", formData.ticketId)
        .eq("tenant_id", tenantIdResolved)
        .single();

      await createNotification({
        tenantId: tenantIdResolved,
        userId: formData.assigneeId,
        type: "ticket_assigned",
        payload: {
          ticket_id: formData.ticketId,
          ticket_number: ticket?.number,
          subject: ticket?.subject,
        },
      });
    }

    revalidatePath(`/${formData.tenantId}/tickets/${formData.ticketId}`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function assignTicketToMeAction(formData: {
  ticketId: string;
  tenantId: string;
}) {
  try {
    const identity = await getCurrentUserIdentity(formData.tenantId);
    if (!identity || !identity.id) {
      return { success: false, error: "Unauthorized" };
    }

    await updateTicketDetails(formData.ticketId, formData.tenantId, {
      assignee_user_id: identity.id,
    });

    revalidatePath(`/${formData.tenantId}/tickets/${formData.ticketId}`);
    return { success: true, assigneeId: identity.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function bulkAssignToMeAction(payload: {
  tenantId: string;
  ticketIds: string[];
}) {
  try {
    if (!payload.ticketIds?.length) {
      return { success: false, error: "No tickets selected." };
    }
    const identity = await getCurrentUserIdentity(payload.tenantId);
    if (!identity?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const count = await bulkUpdateTickets(payload.tenantId, payload.ticketIds, {
      assignee_user_id: identity.id,
    });

    revalidatePath(`/${payload.tenantId}/tickets`);
    return { success: true, count };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function bulkSetPriorityAction(payload: {
  tenantId: string;
  ticketIds: string[];
  priority: TicketPriority;
}) {
  try {
    if (!payload.ticketIds?.length) {
      return { success: false, error: "No tickets selected." };
    }
    if (!payload.priority) {
      return { success: false, error: "Priority is required." };
    }

    const count = await bulkUpdateTickets(payload.tenantId, payload.ticketIds, {
      priority: payload.priority,
    });

    revalidatePath(`/${payload.tenantId}/tickets`);
    return { success: true, count };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function bulkMarkSolvedAction(payload: {
  tenantId: string;
  ticketIds: string[];
}) {
  try {
    if (!payload.ticketIds?.length) {
      return { success: false, error: "No tickets selected." };
    }

    const count = await bulkUpdateTickets(payload.tenantId, payload.ticketIds, {
      status: "resolved",
      resolved_at: new Date().toISOString(),
    });

    revalidatePath(`/${payload.tenantId}/tickets`);
    return { success: true, count };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}
