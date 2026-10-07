import Link from "next/link";
import type { ReactNode } from "react";
import {
  Building2,
  Inbox,
  Link2,
  Mail,
  ReceiptText,
  ShieldCheck,
  Star,
  Ticket,
  type LucideIcon,
} from "lucide-react";

import { BackLink } from "@/components/shared/back-link";
import { Pagination } from "@/components/shared/pagination";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  CopyButton,
  CopyScope,
  CopyTrigger,
} from "@/features/customers/components/copy-button";
import { CustomerTabs } from "@/features/customers/components/customer-tabs";
import {
  CUSTOMER_TICKET_PAGE_SIZE,
  customerPath,
  formatCsatScore,
  formatCustomerDate,
  TICKET_STATUS_BADGE,
  TICKET_STATUS_LABEL,
  type CustomerDetail,
  type CustomerPortalStatus,
  type CustomerTicket,
  type CustomerTicketPage,
} from "@/features/customers/types/customers";
import { formatRelativeTime, getInitials } from "@/lib/format";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import { CustomerStatusBadge } from "@/features/customers/components/customer-access";

const CARD = "rounded-2xl border bg-card shadow-xs";

/** How many rows the Overview shows before "View all". */
const RECENT_TICKETS = 5;

const PORTAL_DESCRIPTION =
  "Share this link with customers so they can create their own account and access support.";

/**
 * The profile's header and tab strip. Rendered by the route's layout, which is
 * not re-rendered when only `?tab=` or `&page=` changes, so these stay on
 * screen while the tab body below them loads.
 *
 * Server components throughout: the tabs and the pager are links, so a tab or
 * a page of tickets can be shared, bookmarked and stepped back out of. Only the
 * tab strip (which reads the URL) and the copy buttons are client code.
 */
export function CustomerHeader({
  customer,
  tenant,
  ticketTotal,
}: {
  customer: CustomerDetail;
  tenant: string;
  ticketTotal: number;
}) {
  return (
    <>
      <div>
        <BackLink href={tenantPath(tenant, TENANT_ROUTES.CUSTOMERS)}>
          Customers
        </BackLink>

        <div className="mt-4 flex min-w-0 items-center gap-4 sm:gap-6">
          <div className="relative shrink-0">
            {/* A gap of page colour, then a soft ring in the workspace's
                accent: a bare circular photo has no defined edge and reads as
                a hole. Tinted from brand-accent so it follows branding. */}
            <Avatar className="size-14 overflow-hidden shadow-md ring-[3px] ring-brand-accent/35 ring-offset-[3px] ring-offset-background sm:size-20 sm:ring-4 sm:ring-offset-4">
              {customer.avatarUrl ? (
                <AvatarImage
                  src={customer.avatarUrl}
                  alt=""
                  className="object-cover"
                />
              ) : null}
              {/* AvatarImage only renders once the load succeeds, so the
                  fallback covers no photo and a broken URL alike. */}
              <AvatarFallback className="bg-brand-accent/10 text-xl font-bold text-brand-accent">
                {getInitials(customer.fullName, customer.email)}
              </AvatarFallback>
            </Avatar>
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 text-xl font-bold wrap-break-word tracking-tight text-foreground sm:text-3xl">
              {customer.fullName}
            </h1>
            <p className="mt-1 flex flex-col gap-y-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2.5 sm:text-base">
              <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
                <Mail aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{customer.email}</span>
              </span>
              {customer.company ? (
                <>
                  <span aria-hidden className="hidden sm:inline">
                    ·
                  </span>
                  <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
                    <Building2 aria-hidden className="size-4 shrink-0" />
                    <span className="truncate uppercase">
                      {customer.company}
                    </span>
                  </span>
                </>
              ) : null}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Customer since {formatCustomerDate(customer.createdAt)}
            </p>
          </div>
        </div>
      </div>

      <CustomerTabs
        baseHref={customerPath(tenant, customer.id)}
        ticketTotal={ticketTotal}
      />
    </>
  );
}

/**
 * The Tickets tab. No section heading: the tab strip already says "Tickets"
 * and how many, so the card is the table, with the pager under it when there
 * is more than one page.
 */
export function CustomerTicketsTab({
  customerId,
  tickets,
  tenant,
  now,
}: {
  customerId: string;
  tickets: CustomerTicketPage;
  tenant: string;
  now: number;
}) {
  const base = customerPath(tenant, customerId);

  // Page 1 is left as the bare `?tab=tickets`, so a pager link back to the
  // start lands on the same address the tab itself does.
  const ticketPageHref = (value: number) =>
    value === 1 ? `${base}?tab=tickets` : `${base}?tab=tickets&page=${value}`;

  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <TicketTable
        tickets={tickets.tickets}
        now={now}
        href={tenantPath(tenant, TENANT_ROUTES.TICKETS)}
      />
      {tickets.pageCount > 1 ? (
        <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span>
            Showing {(tickets.page - 1) * CUSTOMER_TICKET_PAGE_SIZE + 1}–
            {Math.min(tickets.page * CUSTOMER_TICKET_PAGE_SIZE, tickets.total)}{" "}
            of {tickets.total} tickets
          </span>

          <Pagination
            label="Ticket pages"
            page={tickets.page}
            pageCount={tickets.pageCount}
            hrefFor={ticketPageHref}
          />
        </div>
      ) : null}
    </section>
  );
}

export function CustomerOverview({
  customer,
  ticketPage,
  tenant,
  now,
  portalUrl,
}: {
  customer: CustomerDetail;
  /** The first page of tickets, and the totals behind the cards. */
  ticketPage: CustomerTicketPage;
  tenant: string;
  /** Server clock, for relative times that render the same on both sides. */
  now: number;
  /** Absolute URL of this workspace's portal. */
  portalUrl: string;
}) {
  const ticketsHref = `${customerPath(tenant, customer.id)}?tab=tickets`;
  const ticketsRouteHref = tenantPath(tenant, TENANT_ROUTES.TICKETS);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 @2xl:gap-4 @5xl:grid-cols-4">
        <StatCard
          icon={Inbox}
          tone="bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300"
          label="Open tickets"
          value={customer.openTicketsCount}
        />
        <StatCard
          icon={Ticket}
          tone="bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
          label="Total tickets"
          value={ticketPage.total}
        />
        <StatCard
          icon={Building2}
          tone="bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-300"
          label="Company"
          value={
            customer.company ? (
              /* Shouting, because a company name here is a label rather than a
                 sentence: it is the one stat card whose value is a word, and
                 mixed case read as a sentence fragment next to three numbers. */
              <span className="block truncate uppercase">
                {customer.company}
              </span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )
          }
        />
        <StatCard
          icon={Star}
          tone="bg-amber-50 text-amber-500 dark:bg-amber-950/50 dark:text-amber-300"
          label="CSAT"
          value={
            customer.csatScore === null ? (
              <span>0</span>
            ) : (
              <span className="flex items-baseline gap-1">
                {formatCsatScore(customer.csatScore)}
                <span className="text-base font-medium text-muted-foreground">
                  / 5
                </span>
              </span>
            )
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)]">
        <section className={cn(CARD, "@container flex min-w-0 flex-col")}>
          <SectionHeader icon={ShieldCheck} title="Contact & portal access" />
          <div className="flex flex-1 flex-col px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="flex flex-col gap-2.5">
              <ContactRow
                name={customer.fullName}
                email={customer.email}
                avatarUrl={customer.avatarUrl}
                status={customer.portalStatus}
                primary
              />

              {customer.contacts.map((contact) => (
                <ContactRow
                  key={contact.id}
                  name={contact.name}
                  email={contact.email}
                  avatarUrl={contact.avatarUrl}
                />
              ))}
            </div>

            <dl className="mt-2 divide-y">
              <DetailRow
                icon={Mail}
                tone="text-sky-600 dark:text-sky-300"
                label="Email"
                copy={{ value: customer.email, label: "Email" }}
              >
                <span className="block truncate font-semibold text-foreground">
                  {customer.email}
                </span>
              </DetailRow>

              {customer.company ? (
                <DetailRow
                  icon={Building2}
                  tone="text-teal-600 dark:text-teal-300"
                  label="Company"
                >
                  <span className="block truncate font-semibold text-foreground">
                    {customer.company}
                  </span>
                </DetailRow>
              ) : null}

              {/* The public address belongs to the workspace rather than to
                  any one contact, but it is the other half of the same
                  question: the rows above say who to send to, this says where
                  to send them. No invite control -- this is the front door,
                  not an invitation. */}
              <DetailRow
                icon={Link2}
                tone="text-brand-accent"
                label="Customer Portal"
                copy={{ value: portalUrl, label: "Portal link" }}
              >
                {/* break-all rather than truncate: there is nothing to infer
                    from a cut-off host. Clicking the link copies it, like the
                    button beside it, and the tick shows on the button either
                    way: the agent is here to hand the address on. */}
                <CopyTrigger className="font-semibold text-brand-ink">
                  {portalUrl}
                </CopyTrigger>
                <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                  {PORTAL_DESCRIPTION}
                </span>
              </DetailRow>
            </dl>
          </div>
        </section>

        <section className={cn(CARD, "min-w-0 overflow-hidden")}>
          <SectionHeader icon={ReceiptText} title="Recent tickets">
            {ticketPage.total > RECENT_TICKETS ? (
              <ViewAll href={ticketsHref} />
            ) : null}
          </SectionHeader>
          <TicketTable
            tickets={ticketPage.tickets.slice(0, RECENT_TICKETS)}
            now={now}
            href={ticketsRouteHref}
            className="border-t"
          />
        </section>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value: ReactNode;
}) {
  return (
    // Its own container: a narrow card (two up on a phone) stacks the icon
    // over the text so the label and value keep the width.
    <div className={cn(CARD, "@container min-w-0 p-3.5 @2xl:p-5")}>
      <div className="flex flex-col gap-3 @[15rem]:flex-row @[15rem]:items-center @[15rem]:gap-4">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl @[15rem]:size-12",
            tone,
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-muted-foreground">
            {label}
          </p>
          <div className="mt-1 min-w-0 text-2xl leading-tight font-bold text-foreground tabular-nums @[15rem]:text-3xl">
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
      <h2 className="flex items-center gap-3 text-base font-bold text-foreground">
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-lg bg-brand-accent/10 text-brand-accent"
        >
          <Icon className="size-4" />
        </span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function ViewAll({ href }: { href: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className="text-sm font-semibold text-brand-ink hover:text-brand-ink hover:underline"
    >
      View all
    </Link>
  );
}

/** One labelled value in the contact card, with a copy button beside it. */
function DetailRow({
  icon: Icon,
  tone,
  label,
  copy,
  children,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  /** Omit for a value nobody needs to paste anywhere. */
  copy?: { value: string; label: string };
  children: ReactNode;
}) {
  const row = (
    <div className="flex items-start gap-3.5 py-3.5">
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", tone)} />
      <div className="min-w-0 flex-1">
        <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-sm">{children}</dd>
      </div>
      {copy ? <CopyButton value={copy.value} label={copy.label} /> : null}
    </div>
  );

  // One copy state per row: a CopyTrigger in the value and the button share it.
  return copy ? (
    <CopyScope value={copy.value} label={copy.label}>
      {row}
    </CopyScope>
  ) : (
    row
  );
}

/**
 * One person at the company. The customer this page is about comes first,
 * larger, as the primary contact; anyone else recorded against the same
 * company follows in a compact row.
 */
function ContactRow({
  name,
  email,
  avatarUrl,
  status,
  primary = false,
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
  /** Portal status badge: under the details on a narrow card, at the right from @md. */
  status?: CustomerPortalStatus;
  primary?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border",
        primary ? "p-3.5" : "px-3.5 py-3",
      )}
    >
      <Avatar
        className={cn("shrink-0", primary ? "size-12 @md:size-14" : "size-9")}
      >
        {avatarUrl ? (
          <AvatarImage src={avatarUrl} alt="" className="object-cover" />
        ) : null}
        <AvatarFallback
          className={cn(
            "bg-muted font-semibold text-muted-foreground",
            primary ? "text-base" : "text-[11px]",
          )}
        >
          {getInitials(name, email)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2 self-center @md:flex-row @md:justify-between">
        <div className="w-full min-w-0 @md:w-auto @md:flex-1">
          <p
            className={cn(
              "truncate font-semibold text-foreground",
              primary ? "text-base" : "text-sm",
            )}
          >
            {name}
          </p>
          <p className="truncate text-sm text-muted-foreground">{email}</p>
          {primary ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Primary contact
            </p>
          ) : null}
        </div>
        {status ? (
          <CustomerStatusBadge status={status} className="shrink-0" />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Every row is a link to the ticket list, because the agent app has no ticket
 * page of its own yet -- /tickets is still a "coming soon" stub. It is one href
 * for the whole list rather than one per ticket, and when /tickets/[id] exists
 * this becomes `/${tenant}/tickets/${ticket.id}` per row with nothing else to
 * change here.
 *
 * The link is the subject, stretched over the row with an ::after, so the
 * whole row is clickable while the table keeps its semantics and there is one
 * tab stop per ticket rather than one per cell.
 */
function TicketTable({
  tickets,
  now,
  href,
  className,
}: {
  tickets: CustomerTicket[];
  now: number;
  href: string;
  /** The rule under a section heading. Only passed where one is drawn. */
  className?: string;
}) {
  if (tickets.length === 0) {
    return (
      // pt-6 rather than the pt-2 a heading would want: the Tickets tab draws
      // no heading, and a message 8px under the card's top edge reads as a
      // mistake.
      <div className="flex flex-col items-center px-5 pt-6 pb-10 text-center">
        <span
          aria-hidden
          className="flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-300"
        >
          <Ticket className="size-5" />
        </span>
        <p className="mt-4 text-sm font-semibold text-foreground">
          No tickets raised yet
        </p>
        <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
          This customer hasn&rsquo;t raised any support requests yet. Tickets
          will appear here when the customer submits a request through the
          portal.
        </p>
      </div>
    );
  }

  // The same look as Billing history: a tinted uppercase header, no column
  // rules, a mono ID and pill badges.
  //
  // Every column is always drawn and the table scrolls sideways when the card
  // is narrower than the columns need -- the same trade as the customers list
  // and the billing history. Dropping a column and moving its value under the
  // subject was what this used to do below @lg/@2xl: the subject column is
  // table-fixed, so on a phone it was squeezed to the width of a badge and the
  // title -- the thing being scanned for -- became three words and an
  // ellipsis. min-w-190 is the point where ID, Subject, Status, Created and
  // Updated all still fit; narrower than that and the reader scrolls rather
  // than loses data.
  const head =
    "h-10 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:px-6 dark:text-muted-foreground";
  const cell = "px-4 py-3.5 sm:px-6 sm:py-4";

  return (
    <div className={className}>
      <Table className="min-w-190 table-fixed text-sm">
        <TableHeader>
          <TableRow className="border-slate-100 bg-slate-50 hover:bg-slate-50 dark:border-border dark:bg-muted/40 dark:hover:bg-muted/40">
            <TableHead className={cn(head, "w-24")}>Ticket ID</TableHead>
            <TableHead className={head}>Subject</TableHead>
            <TableHead className={cn(head, "w-28")}>Status</TableHead>
            <TableHead className={cn(head, "w-36")}>Created</TableHead>
            <TableHead className={cn(head, "w-36")}>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((ticket) => (
            <TableRow
              key={ticket.id}
              className="relative border-slate-100 hover:bg-slate-50/60 has-focus-visible:bg-slate-50 dark:border-border dark:hover:bg-muted/30"
            >
              <TableCell
                className={cn(
                  cell,
                  "whitespace-nowrap font-mono text-xs font-semibold tracking-tight text-slate-900 dark:text-foreground",
                )}
              >
                #{ticket.number ?? "-"}
              </TableCell>
              <TableCell className={cell}>
                {/* One line, ellipsised: the subject only has to be
                    recognisable here, not readable, and title carries the rest
                    on hover. A wrapping subject would make one row taller than
                    the rest and the row would stop reading as a row. */}
                <Link
                  href={href}
                  title={ticket.subject}
                  className="block truncate font-medium text-slate-900 after:absolute after:inset-0 focus-visible:outline-none dark:text-foreground"
                >
                  {ticket.subject}
                </Link>
              </TableCell>
              <TableCell className={cn(cell, "whitespace-nowrap")}>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold leading-5",
                    TICKET_STATUS_BADGE[ticket.status],
                  )}
                >
                  {TICKET_STATUS_LABEL[ticket.status]}
                </span>
              </TableCell>
              <TableCell
                className={cn(
                  cell,
                  "whitespace-nowrap text-slate-600 dark:text-muted-foreground",
                )}
              >
                {formatCustomerDate(ticket.createdAt)}
              </TableCell>
              <TableCell
                className={cn(
                  cell,
                  "whitespace-nowrap text-slate-600 dark:text-muted-foreground",
                )}
              >
                {formatRelativeTime(ticket.updatedAt, now) ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
