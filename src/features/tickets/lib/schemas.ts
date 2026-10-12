import { z } from "zod";
import {
  PRIORITY_REASON_MAX,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "../types/tickets.types";

/**
 * Runtime checks for the ticket Server Actions. Actions are plain POST
 * endpoints and TypeScript types don't exist at runtime, so these bound what a
 * hand-made request can send: ids must be ids, lists are capped, text has a
 * ceiling. The caps sit at or above what the UI can produce, so nothing typed
 * or picked in the app is rejected.
 */

/**
 * `z.guid()` rather than `z.uuid()`: Postgres accepts any 8-4-4-4-12 hex id,
 * and seeded rows don't always carry RFC version bits.
 */
export const idField = z.guid("That id isn't valid.");

export const tenantSlugField = z
  .string()
  .trim()
  .min(1, "Workspace is required.")
  .max(100, "That workspace doesn't exist.");

/** The list selects at most a page (25 rows); 100 leaves room. */
export const BULK_TICKETS_MAX = 100;
export const TICKET_SUBJECT_MAX = 200;
export const TICKET_BODY_MAX = 20_000;
/** The tag picker sets no count limit; 50 is far above real use. */
export const TICKET_TAGS_MAX = 50;
/** Raw length before normalizeTagName trims and cuts it to TAG_NAME_MAX. */
const TAG_RAW_MAX = 200;
/** The service cuts the term to 100; this only bounds the payload. */
const SEARCH_QUERY_MAX = 1000;

const priorityField = z.enum(TICKET_PRIORITIES, "Priority is required.");
const statusField = z.enum(TICKET_STATUSES, "That status doesn't exist.");
const reasonField = z
  .string()
  .max(
    PRIORITY_REASON_MAX,
    `Keep the reason under ${PRIORITY_REASON_MAX} characters.`,
  );

const ticketIdsField = z
  .array(idField)
  .min(1, "No tickets selected.")
  .max(BULK_TICKETS_MAX, `Select up to ${BULK_TICKETS_MAX} tickets at a time.`);

export const createTicketSchema = z.object({
  tenantSlug: tenantSlugField,
  subject: z
    .string()
    .max(
      TICKET_SUBJECT_MAX,
      `Keep the subject under ${TICKET_SUBJECT_MAX} characters.`,
    ),
  description: z
    .string()
    .max(TICKET_BODY_MAX, "That description is too long to submit."),
  // Emptiness is checked by the action with its own message.
  requesterCustomerId: z.union([z.literal(""), idField]),
});

export const sendTicketMessageSchema = z.object({
  ticketId: idField,
  tenantSlug: tenantSlugField,
  body: z.string().max(TICKET_BODY_MAX, "That reply is too long to send."),
});

export const updateTicketDetailsSchema = z
  .object({
    ticketId: idField,
    tenantSlug: tenantSlugField,
    status: statusField.optional(),
    priority: priorityField.optional(),
    priorityReason: reasonField.optional(),
    assigneeId: idField.optional(),
    unassign: z.boolean().optional(),
  })
  // Priority runs through its own RPC and the other fields through a plain
  // update; the app never sends both, and refusing the mix keeps a call from
  // half-applying when the second step fails.
  .refine((v) => !v.priority || (!v.status && !v.assigneeId && !v.unassign), {
    message: "Change the priority on its own.",
  });

export const ticketRefSchema = z.object({
  ticketId: idField,
  tenantSlug: tenantSlugField,
});

export const bulkTicketsSchema = z.object({
  tenantSlug: tenantSlugField,
  ticketIds: ticketIdsField,
});

export const bulkSetPrioritySchema = z.object({
  tenantSlug: tenantSlugField,
  ticketIds: ticketIdsField,
  priority: priorityField,
  reason: reasonField.optional(),
});

export const setTicketTagsSchema = z.object({
  tenantSlug: tenantSlugField,
  ticketId: idField,
  names: z
    .array(z.string().max(TAG_RAW_MAX, "That tag is too long."))
    .max(TICKET_TAGS_MAX, `A ticket can have up to ${TICKET_TAGS_MAX} tags.`),
});

export const searchRequestersSchema = z.object({
  tenantSlug: tenantSlugField,
  query: z.string().max(SEARCH_QUERY_MAX),
});

/** The first issue's message, for an action's `{ error }`. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message || "That request isn't valid.";
}
