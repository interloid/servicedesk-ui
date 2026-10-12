"use server";

import { revalidatePath } from "next/cache";
import {
  createTenantTicket,
  updateTicketDetails,
  bulkUpdateTickets,
  changeTicketPriority,
  createMessage,
  uploadTicketAttachments,
  stageTicketAttachments,
  recordStagedAttachments,
  discardStagedAttachments,
  fetchTicketSlaPolicy,
  searchTenantCustomers,
  getCurrentUserIdentity,
  fetchAssignableAgents,
  ASSIGNEE_ROLES,
  setTicketTags,
  fetchTicketSlaEvents,
} from "../services/tickets.service";
import {
  MessageVisibility,
  PRIORITY_REASON_MAX,
  PriorityChangeResult,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TicketPriority,
  TicketStatus,
  isTicketStatus,
} from "../types/tickets.types";
import { closedReason } from "../lib/sla-calendar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications.service";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import { extractMentionIds, stripMentions } from "@/lib/mentions";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const PRIORITIES = TICKET_PRIORITIES;
const STATUSES = TICKET_STATUSES;

/** A FormData value as one of `allowed`, else `fallback`. */
function pick<T extends string>(
  value: FormDataEntryValue | null,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export async function createTicketAction(
  tenantSlug: string,
  formData: FormData,
) {
  try {
    const subject = String(formData.get("subject") ?? "");
    const description = String(formData.get("description") ?? "");
    const requesterCustomerId = String(
      formData.get("requesterCustomerId") ?? "",
    );
    const priority = pick(formData.get("priority"), PRIORITIES, "normal");
    const status = pick(formData.get("status"), STATUSES, "new");

    if (!subject || !requesterCustomerId) {
      return { error: "Subject and Requester Customer ID are required." };
    }

    // The tickets FK only checks the customer exists somewhere, and the seed
    // message below is written with the admin client: confirm the requester
    // is one of this tenant's customers first.
    const tenantId = await getTenantIdBySlug(tenantSlug);
    if (!tenantId) return { error: "Tenant not found." };
    const supabase = await createSupabaseServerClient();
    const { data: requester } = await supabase
      .from("customers")
      .select("id")
      .eq("id", requesterCustomerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!requester) return { error: "Customer not found." };

    const newTicket = await createTenantTicket(tenantSlug, {
      subject,
      description,
      requester_customer_id: requesterCustomerId,
      priority,
      status,
    });

    // No seeded customer message: the description is the opening post, as
    // for a portal request, and both threads render it from the ticket.

    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > 0) {
      try {
        await uploadTicketAttachments({
          tenant: tenantSlug,
          ticketId: newTicket.id,
          files,
        });
      } catch (uploadError) {
        // Withdraw the ticket (its messages and clocks cascade), so "Create
        // ticket" again doesn't file a duplicate -- as createPortalRequest.
        const { error: cleanupError } = await createSupabaseAdminClient()
          .from("tickets")
          .delete()
          .eq("id", newTicket.id)
          .eq("tenant_id", tenantId);
        if (cleanupError) {
          console.error(
            "[createTicketAction] could not roll back a ticket whose files failed:",
            cleanupError.message,
          );
        }
        throw uploadError;
      }
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: managers } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .in("role", ["manager", "tenant_admin"]);

      const recipients = (managers || [])
        .map((m) => m.user_id)
        .filter((id) => id !== user?.id);

      if (recipients.length > 0) {
        await Promise.all(
          recipients.map((userId) =>
            createNotification({
              tenantId,
              userId,
              type: "ticket_created",
              payload: {
                ticket_id: newTicket.id,
                subject,
                ticket_number: newTicket.number,
              },
            }),
          ),
        );
      }
    } catch (notifError) {
      console.error("[notifications] skipped:", notifError);
    }

    revalidatePath(`/${tenantSlug}/tickets`);
    return { success: true, ticket: newTicket };
  } catch (error: unknown) {
    return { error: errorMessage(error) };
  }
}

export async function sendTicketMessageAction(formData: FormData) {
  try {
    const ticketId = String(formData.get("ticketId") ?? "");
    const tenantSlug = String(formData.get("tenantSlug") ?? "");
    const body = String(formData.get("body") ?? "");
    const visibility: MessageVisibility =
      formData.get("visibility") === "internal" ? "internal" : "public";
    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);

    if (!ticketId || !tenantSlug || (!body.trim() && files.length === 0)) {
      return { success: false, error: "Missing message content." };
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("Unauthorized");
    }

    const tenantIdResolved = await getTenantIdBySlug(tenantSlug);
    if (!tenantIdResolved) {
      return { success: false, error: "Tenant not found." };
    }

    const { data: ticket } = await supabase
      .from("tickets")
      .select("assignee_user_id, subject, number, sla_policy_id")
      .eq("id", ticketId)
      .eq("tenant_id", tenantIdResolved)
      .maybeSingle();
    if (!ticket) {
      return { success: false, error: "Ticket not found." };
    }

    // The composer locks while the ticket's business hours are closed; the
    // same rule here, so a tab left open past closing (it re-checks once a
    // minute) or a direct call can't get round it.
    const policy = await fetchTicketSlaPolicy(ticket.sla_policy_id);
    if (closedReason(Date.now(), policy?.calendar ?? null)) {
      return {
        success: false,
        error:
          "Support is closed right now. Replies open again at the next business opening.",
      };
    }

    // Files go to storage first, the message second and the attachments rows
    // last: if an upload fails nothing was sent, so sending again can't post
    // the reply twice (it also started the first-response clock's finish).
    const staged =
      files.length > 0
        ? await stageTicketAttachments({ tenant: tenantSlug, ticketId, files })
        : null;

    // Every file belongs to a message, even with no text: a message-less file
    // counts as the customer's opening file and shows on the portal, which
    // for an internal note would leak it.
    const text =
      body.trim() ||
      `Attached ${files.length} file${files.length === 1 ? "" : "s"}.`;

    let message;
    try {
      message = await createMessage({
        tenantSlug,
        ticketId,
        authorType: "agent",
        authorId: user.id,
        body: text,
        visibility,
      });
    } catch (messageError) {
      if (staged) await discardStagedAttachments(staged);
      throw messageError;
    }

    if (staged) {
      try {
        await recordStagedAttachments(staged, message.id);
      } catch (recordError) {
        // The reply is already saved; say so rather than invite a resend.
        console.error(
          "[sendTicketMessageAction] files not linked:",
          recordError,
        );
        revalidatePath(`/${tenantSlug}/tickets/${ticketId}`);
        return {
          success: true,
          message,
          warning: "Reply sent, but the files couldn't be attached.",
        };
      }
    }

    if (visibility === "public") {
      try {
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
              body: stripMentions(text).slice(0, 200),
            },
          });
        }
      } catch (notifError) {
        console.error("[notifications] skipped:", notifError);
      }
    }

    if (body.trim()) {
      const mentionedIds = extractMentionIds(body);
      if (mentionedIds.length > 0) {
        try {
          const senderIdentity = await getCurrentUserIdentity(tenantSlug);

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
                    sender_name:
                      senderIdentity?.full_name ||
                      senderIdentity?.email ||
                      "Someone",
                    body: stripMentions(body).slice(0, 200),
                  },
                }),
              ),
          );
        } catch (notifError) {
          console.error("[notifications] skipped:", notifError);
        }
      }
    }

    revalidatePath(`/${tenantSlug}/tickets/${ticketId}`);
    return { success: true, message };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function updateTicketDetailsAction(formData: {
  ticketId: string;
  tenantSlug: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  /** Required when `priority` lowers the ticket. */
  priorityReason?: string;
  assigneeId?: string;
  unassign?: boolean;
}) {
  try {
    const tenantIdResolved = await getTenantIdBySlug(formData.tenantSlug);

    if (formData.priority && !PRIORITIES.includes(formData.priority)) {
      return { success: false, error: "Priority is required." };
    }
    if (formData.status && !isTicketStatus(formData.status)) {
      return { success: false, error: "That status doesn't exist." };
    }
    if ((formData.priorityReason?.length ?? 0) > PRIORITY_REASON_MAX) {
      return {
        success: false,
        error: `Keep the reason under ${PRIORITY_REASON_MAX} characters.`,
      };
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let previousAssignee: string | null = null;
    if (formData.assigneeId && !formData.unassign) {
      // RLS checks who is editing, not who is assigned: only this tenant's
      // active staff may be given the ticket (and its notification).
      const agents = await fetchAssignableAgents(formData.tenantSlug);
      if (!agents.some((a) => a.id === formData.assigneeId)) {
        return {
          success: false,
          error: "Tickets can only be assigned to agents and managers.",
        };
      }

      const { data: existing } = await supabase
        .from("tickets")
        .select("assignee_user_id")
        .eq("id", formData.ticketId)
        .eq("tenant_id", tenantIdResolved)
        .maybeSingle();
      previousAssignee = existing?.assignee_user_id ?? null;
    }

    // Priority has its own rules (reason to lower, due-soon deadlines kept,
    // audit), so it goes through change_ticket_priority, not a plain update.
    let priorityChange: PriorityChangeResult | undefined;
    if (formData.priority && tenantIdResolved) {
      priorityChange = await changeTicketPriority(
        formData.ticketId,
        formData.priority,
        formData.priorityReason,
      );
    }

    if (formData.status || formData.unassign || formData.assigneeId) {
      await updateTicketDetails(formData.ticketId, formData.tenantSlug, {
        ...(formData.status && { status: formData.status }),
        ...(formData.unassign
          ? { assignee_user_id: null }
          : formData.assigneeId && { assignee_user_id: formData.assigneeId }),
      });
    }

    const assigneeChanged =
      !formData.unassign &&
      formData.assigneeId &&
      tenantIdResolved &&
      formData.assigneeId !== previousAssignee &&
      formData.assigneeId !== user?.id;

    if (assigneeChanged && formData.assigneeId) {
      try {
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
      } catch (notifError) {
        console.error("[notifications] skipped:", notifError);
      }
    }

    // Priority and status move the SLA clocks (re-target, pause, resume,
    // finish) in the same transaction, so hand back what they are now.
    const slaEvents =
      (formData.priority || formData.status) && tenantIdResolved
        ? await fetchTicketSlaEvents(formData.ticketId, tenantIdResolved)
        : undefined;

    revalidatePath(`/${formData.tenantSlug}/tickets/${formData.ticketId}`);
    return { success: true, slaEvents, priorityChange };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function assignTicketToMeAction(formData: {
  ticketId: string;
  tenantSlug: string;
}) {
  try {
    const identity = await getCurrentUserIdentity(formData.tenantSlug);
    if (!identity || !identity.id) {
      return { success: false, error: "Unauthorized" };
    }
    if (!identity.role || !ASSIGNEE_ROLES.includes(identity.role)) {
      return {
        success: false,
        error: "Only agents and managers can take tickets.",
      };
    }

    await updateTicketDetails(formData.ticketId, formData.tenantSlug, {
      assignee_user_id: identity.id,
    });

    revalidatePath(`/${formData.tenantSlug}/tickets/${formData.ticketId}`);
    return { success: true, assigneeId: identity.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function bulkAssignToMeAction(payload: {
  tenantSlug: string;
  ticketIds: string[];
}) {
  try {
    if (!payload.ticketIds?.length) {
      return { success: false, error: "No tickets selected." };
    }
    const identity = await getCurrentUserIdentity(payload.tenantSlug);
    if (!identity?.id) {
      return { success: false, error: "Unauthorized" };
    }
    if (!identity.role || !ASSIGNEE_ROLES.includes(identity.role)) {
      return {
        success: false,
        error: "Only agents and managers can take tickets.",
      };
    }

    const count = await bulkUpdateTickets(
      payload.tenantSlug,
      payload.ticketIds,
      { assignee_user_id: identity.id },
    );
    if (count === 0) {
      return { success: false, error: "No tickets were updated." };
    }

    revalidatePath(`/${payload.tenantSlug}/tickets`);
    return { success: true, count };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function bulkSetPriorityAction(payload: {
  tenantSlug: string;
  ticketIds: string[];
  priority: TicketPriority;
  /** Required when any selected ticket would be lowered. */
  reason?: string;
}) {
  try {
    if (!payload.ticketIds?.length) {
      return { success: false, error: "No tickets selected." };
    }
    if (!PRIORITIES.includes(payload.priority)) {
      return { success: false, error: "Priority is required." };
    }
    if ((payload.reason?.length ?? 0) > PRIORITY_REASON_MAX) {
      return {
        success: false,
        error: `Keep the reason under ${PRIORITY_REASON_MAX} characters.`,
      };
    }
    const tenantId = await getTenantIdBySlug(payload.tenantSlug);
    if (!tenantId) return { success: false, error: "Tenant not found." };

    // One at a time through change_ticket_priority, so each ticket gets the
    // same rules and its own audit entry as a change from the ticket page.
    // A failure on one (deleted meanwhile, a reason missing) doesn't stop the
    // rest, and the list is refreshed either way so it shows what changed.
    let count = 0;
    let slaKept = 0;
    let failed = 0;
    let firstError: string | undefined;
    for (const ticketId of payload.ticketIds) {
      try {
        const result = await changeTicketPriority(
          ticketId,
          payload.priority,
          payload.reason,
        );
        if (result.changed) count += 1;
        if (result.slaKept.length > 0) slaKept += 1;
      } catch (error) {
        failed += 1;
        firstError ??= errorMessage(error);
      }
    }
    revalidatePath(`/${payload.tenantSlug}/tickets`);

    if (count === 0) {
      return {
        success: false,
        error: firstError ?? "No tickets were updated.",
      };
    }
    return { success: true, count, slaKept, failed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function bulkMarkSolvedAction(payload: {
  tenantSlug: string;
  ticketIds: string[];
}) {
  try {
    if (!payload.ticketIds?.length) {
      return { success: false, error: "No tickets selected." };
    }

    // Status only: the stamps trigger sets resolved_at. Tickets already
    // resolved or closed are left alone -- re-resolving them would restamp
    // resolved_at (a second CSAT slot, a restarted auto-close) or pull a
    // closed ticket back with a stale closed_at.
    const count = await bulkUpdateTickets(
      payload.tenantSlug,
      payload.ticketIds,
      { status: "resolved" },
      { skipStatuses: ["resolved", "closed"] },
    );
    if (count === 0) {
      return { success: false, error: "No tickets were updated." };
    }

    revalidatePath(`/${payload.tenantSlug}/tickets`);
    return { success: true, count };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function setTicketTagsAction(payload: {
  tenantSlug: string;
  ticketId: string;
  names: string[];
}) {
  try {
    if (!payload.ticketId) {
      return { success: false as const, error: "Missing ticket." };
    }
    const tags = await setTicketTags(
      payload.tenantSlug,
      payload.ticketId,
      payload.names,
    );
    revalidatePath(`/${payload.tenantSlug}/tickets`);
    return { success: true as const, tags };
  } catch (error) {
    return {
      success: false as const,
      error: errorMessage(error),
    };
  }
}

/**
 * Requesters matching what the agent typed, for the create-ticket picker:
 * at most 50, by name, email or company, from this tenant only.
 */
export async function searchTicketRequestersAction(
  tenantSlug: string,
  query: string,
) {
  try {
    const customers = await searchTenantCustomers(tenantSlug, query);
    return { success: true as const, customers };
  } catch (error) {
    return {
      success: false as const,
      error: errorMessage(error),
      customers: [],
    };
  }
}
