import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Link2,
  Mail,
  ReceiptText,
  ShieldCheck,
  Star,
  Ticket,
  type LucideIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { CopyButton } from "@/features/customers/components/copy-button";
import {
  CUSTOMER_TICKET_PAGE_SIZE,
  customerInitials,
  formatCsatScore,
  formatCustomerDate,
  formatCustomerRelative,
  PORTAL_STATUS_BADGE,
  PORTAL_STATUS_LABEL,
  TICKET_STATUS_BADGE,
  TICKET_STATUS_LABEL,
  type CustomerDetail,
  type CustomerTab,
  type CustomerTicket,
  type CustomerTicketPage,
  type PortalInvite,
  type PortalInviteStatus,
} from "@/features/customers/types/customers";
import { pageWindow } from "@/lib/pagination";
import { TENANT_ROUTES } from "@/lib/tenancy";
import { cn } from "@/lib/utils";

const CARD = "rounded-2xl border bg-card shadow-xs";

/** How many rows the Overview shows before "View all". */
const RECENT_TICKETS = 5;

const PORTAL_DESCRIPTION =
  "Share this link with customers so they can create their own account and access support.";

/**
 * A server component: the tabs are links (`?tab=`), so the page renders with
 * no client state, a tab can be shared or bookmarked, and the back button
 * steps between tabs. Only the copy buttons are client code.
 *
 * The pager follows the same rule rather than reaching for `useState`. A page
 * of a customer's tickets is somewhere an agent may well want to be able to
 * come back to, hand to a colleague, or step back out of -- which client state
 * cannot offer, and which a reload would throw away.
 */
export default function CustomerDetailPage({
  customer,
  tickets,
  tenant,
  tab,
  now,
  portalUrl,
}: {
  customer: CustomerDetail;
  /** The page of tickets to draw, and the totals the pager reads. */
  tickets: CustomerTicketPage;
  tenant: string;
  tab: CustomerTab;
  /** Server clock, for relative times that render the same on both sides. */
  now: number;
  /** Absolute URL of this workspace's portal, for pasting into an email. */
  portalUrl: string;
}) {
  const base = `/${tenant}/customers/${customer.id}`;
  const tabHref = (value: CustomerTab) =>
    value === "overview" ? base : `${base}?tab=${value}`;
  const ticketsRouteHref = `/${tenant}${TENANT_ROUTES.TICKETS}`;

  // Page 1 is left as the bare `?tab=tickets`, so a pager link back to the
  // start lands on the same address the tab itself does.
  const ticketPageHref = (value: number) =>
    value === 1 ? tabHref("tickets") : `${base}?tab=tickets&page=${value}`;

  return (
    <div className="h-full overflow-y-auto p-4 font-sans sm:p-6 lg:p-8">
      <div className="@container mx-auto flex w-full flex-col gap-6">
        <div>
          <Link
            href={`/${tenant}/customers`}
            className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-brand-ink hover:text-brand-ink hover:underline"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Customers
          </Link>

          <div className="mt-4 flex min-w-0 items-center gap-3.5 sm:gap-5">
            <div className="relative shrink-0">
              {/* White edge plus a hairline green ring: on the page's white
                  card a bare circular photo has no defined edge and reads as a
                  hole, and at 56px on a phone the 2px border is most of what
                  tells you where the photo ends. */}
              <Avatar className="size-14 overflow-hidden border-2 border-white shadow-sm ring-1 ring-gray-400 sm:size-20 dark:ring-emerald-800">
                {customer.avatarUrl ? (
                  <AvatarImage
                    src={customer.avatarUrl}
                    alt=""
                    className="object-cover"
                  />
                ) : null}
                {/* Still here because AvatarImage only renders once the load
                    succeeds: without a fallback a customer with no photo, or
                    with a broken URL, shows an empty circle. */}
                <AvatarFallback className="bg-brand-accent/10 text-xl font-bold text-brand-accent">
                  {customerInitials(customer.fullName, customer.email)}
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

        <nav aria-label="Customer sections" className="-mb-2 border-b">
          <ul className="-mb-px flex gap-6">
            {(
              [
                ["overview", "Overview"],
                ["tickets", `Tickets`],
              ] as const
            ).map(([value, label]) => {
              const active = value === tab;

              return (
                <li key={value}>
                  <Link
                    href={tabHref(value)}
                    aria-current={active ? "page" : undefined}
                    scroll={false}
                    className={cn(
                      "inline-flex items-center gap-1.5 border-b-2 pb-3 text-sm font-semibold transition-colors",
                      // The underline and the label are the same token, so
                      // the active state reads as one colour rather than a
                      // teal label sitting over a green rule.
                      active
                        ? "border-brand-strong! text-brand-strong hover:text-brand-strong"
                        : "border-transparent! text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                    {value === "tickets" && tickets.total > 0 ? (
                      <span className="rounded-md bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                        {tickets.total}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {tab === "overview" ? (
          <Overview
            customer={customer}
            ticketPage={tickets}
            now={now}
            ticketsHref={tabHref("tickets")}
            ticketsRouteHref={ticketsRouteHref}
            portalUrl={portalUrl}
          />
        ) : null}

        {tab === "tickets" ? (
          /*
           * No section heading here. The tab strip already says "Tickets" and
           * says how many, and a heading repeating both above the table only
           * pushed the first row down by 68px -- so the card is the table, with
           * the pager under it when there is more than one page.
           */
          <section className={cn(CARD, "overflow-hidden")}>
            <TicketTable
              tickets={tickets.tickets}
              now={now}
              href={ticketsRouteHref}
            />
            {tickets.pageCount > 1 ? (
              <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:px-6">
                <span>
                  Showing {(tickets.page - 1) * CUSTOMER_TICKET_PAGE_SIZE + 1}–
                  {Math.min(
                    tickets.page * CUSTOMER_TICKET_PAGE_SIZE,
                    tickets.total,
                  )}{" "}
                  of {tickets.total} tickets
                </span>

                <Pagination
                  page={tickets.page}
                  pageCount={tickets.pageCount}
                  hrefFor={ticketPageHref}
                />
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Overview({
  customer,
  ticketPage,
  now,
  ticketsHref,
  ticketsRouteHref,
  portalUrl,
}: {
  customer: CustomerDetail;
  /** The page of tickets this request read, and the totals behind the cards. */
  ticketPage: CustomerTicketPage;
  now: number;
  ticketsHref: string;
  /** Where a ticket row goes; the agent app's ticket list. */
  ticketsRouteHref: string;
  /** Absolute URL of this workspace's portal. */
  portalUrl: string;
}) {
  // This customer plus everyone else recorded against the same company.
  const companyContacts = customer.contacts.length + 1;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 @2xl:gap-4 @5xl:grid-cols-4">
        <StatCard
          icon={Inbox}
          tone="bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300"
          label="Open tickets"
          value={customer.openTicketsCount}
          hint={`${customer.openTicketsCount} active`}
        />
        <StatCard
          icon={Ticket}
          tone="bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
          label="Total tickets"
          value={ticketPage.total}
          hint="All time"
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
              <span className="text-muted-foreground">—</span>
            )
          }
          hint={
            customer.company
              ? `${companyContacts} ${companyContacts === 1 ? "contact" : "contacts"}`
              : "No company added yet"
          }
        />
        <StatCard
          icon={Star}
          tone="bg-amber-50 text-amber-500 dark:bg-amber-950/50 dark:text-amber-300"
          label="CSAT"
          value={
            customer.csatScore === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="flex items-baseline gap-1">
                {formatCsatScore(customer.csatScore)}
                <span className="text-base font-medium text-muted-foreground">
                  / 5
                </span>
              </span>
            )
          }
          hint={
            customer.csatCount === 0
              ? "No ratings yet"
              : `${customer.csatCount} ${customer.csatCount === 1 ? "rating" : "ratings"}`
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
                portalActive={customer.portalActive}
                invite={customer.invite}
                avatarUrl={customer.avatarUrl}
                now={now}
                primary
              />

              {customer.contacts.map((contact) => (
                <ContactRow
                  key={contact.id}
                  name={contact.name}
                  email={contact.email}
                  portalActive={contact.portalActive}
                  invite={contact.invite}
                  avatarUrl={contact.avatarUrl}
                  now={now}
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
                  copy={{ value: customer.company, label: "Company" }}
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
                    from a cut-off host. */}
                <span className="block font-semibold break-all text-brand-ink">
                  {portalUrl}
                </span>
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
  hint,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    // Its own container: a narrow card (two up on a phone) stacks the icon
    // over the text so the label and value keep the width.
    <div className={cn(CARD, "@container min-w-0 p-3.5 @2xl:p-5")}>
      <div className="flex flex-col gap-3 @[15rem]:flex-row @[15rem]:items-start @[15rem]:gap-4">
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
          <p className="truncate text-sm font-medium text-muted-foreground">
            {label}
          </p>
          <div className="mt-1 min-w-0 text-xl leading-tight font-bold text-foreground tabular-nums @[15rem]:text-2xl">
            {value}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">{hint}</p>
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
  copy: { value: string; label: string };
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3.5 py-3.5">
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", tone)} />
      <div className="min-w-0 flex-1">
        <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-sm">{children}</dd>
      </div>
      <CopyButton value={copy.value} label={copy.label} />
    </div>
  );
}

/**
 * One person at the company and where they stand with the portal. The
 * customer this page is about comes first, larger, as the primary contact;
 * anyone else recorded against the same company follows in a compact row.
 */
function ContactRow({
  name,
  email,
  portalActive,
  invite,
  avatarUrl,
  now,
  primary = false,
}: {
  name: string;
  email: string;
  portalActive: boolean;
  invite: PortalInvite;
  avatarUrl: string | null;
  /** Server clock, so "invited 2 days ago" reads the same on both sides. */
  now: number;
  primary?: boolean;
}) {
  // A signed-in customer is "Portal active" whatever their membership says:
  // portal_user_id is stamped by the sign-in itself, and a customer who
  // onboarded before invites existed has an active row too.
  const status: PortalInviteStatus = portalActive ? "active" : invite.status;

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
          {customerInitials(name, email)}
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
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
            PORTAL_STATUS_BADGE[status],
          )}
          title={
            status === "invited" && invite.invitedAt
              ? `Invited ${formatCustomerRelative(invite.invitedAt, now)} — they haven't signed in yet.`
              : undefined
          }
        >
          {PORTAL_STATUS_LABEL[status]}
        </span>
      </div>
    </div>
  );
}

/**
 * Numbered pages as links, with arrows either side.
 *
 * Not buttons: the page is a server component whose tabs are already links,
 * and a page of results is a place worth being able to return to, hand to a
 * colleague, or step back out of with the browser's back button. Client state
 * would give all three of those away, and would have to re-fetch on reload to
 * be worth anything.
 *
 * The window itself is shared with the billing history and the customers list
 * -- first page, last page, the current one with a neighbour either side, and
 * an ellipsis for each gap -- so the control is the same width and the same
 * rhythm wherever in the app an agent meets it.
 */
function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  return (
    <nav
      aria-label="Ticket pages"
      className="flex flex-wrap items-center justify-center gap-1.5"
    >
      <PageLink
        href={hrefFor(page - 1)}
        label="Previous page"
        disabled={page <= 1}
      >
        <ChevronLeft />
      </PageLink>

      {pageWindow(page, pageCount).map((value, index) =>
        value === "gap" ? (
          <span
            key={`gap-${index}`}
            aria-hidden
            className="px-1 text-muted-foreground"
          >
            …
          </span>
        ) : (
          <PageLink key={value} href={hrefFor(value)} current={value === page}>
            {value}
          </PageLink>
        ),
      )}

      <PageLink
        href={hrefFor(page + 1)}
        label="Next page"
        disabled={page >= pageCount}
      >
        <ChevronRight />
      </PageLink>
    </nav>
  );
}

/**
 * One page number or arrow. A link styled as the button beside it, so the
 * control reads as one row rather than as links pretending to be something
 * else.
 *
 * The ends of the range are drawn as disabled rather than omitted: a pager
 * that loses its arrows at the first and last page changes width as you move
 * through it, and the eye has to find them again every time.
 */
function PageLink({
  href,
  label,
  children,
  current = false,
  disabled = false,
}: {
  href: string;
  /** For the arrows; a numbered page is named by its own number. */
  label?: string;
  children: ReactNode;
  current?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      asChild
      variant={current ? "default" : "outline"}
      size="icon"
      className={cn(
        "size-9 tabular-nums",
        // A link cannot be :disabled, so the button's own disabled styling --
        // which is variant-scoped to the attribute -- never fires here.
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Link
        href={href}
        aria-label={label}
        aria-current={current ? "page" : undefined}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
      >
        {children}
      </Link>
    </Button>
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
        <p className="text-sm text-muted-foreground">
          No tickets raised by this customer yet.
        </p>
      </div>
    );
  }

  // The same look as Billing history: a tinted uppercase header, no column
  // rules, a mono ID and pill badges.
  //
  // Columns go before the table scrolls: sized against its own card, Updated
  // appears from @lg and Created from @2xl. Below @lg the update time rides
  // under the subject instead, so a phone still sees it.
  const head =
    "h-10 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:px-6 dark:text-muted-foreground";
  const cell = "px-4 py-3.5 sm:px-6 sm:py-4";

  return (
    <div className={cn("@container", className)}>
      <Table className="table-fixed text-sm">
        <TableHeader>
          <TableRow className="border-slate-100 bg-slate-50 hover:bg-slate-50 dark:border-border dark:bg-muted/40 dark:hover:bg-muted/40">
            <TableHead className={cn(head, "w-24 @lg:w-28")}>
              Ticket ID
            </TableHead>
            <TableHead className={head}>Subject</TableHead>
            <TableHead className={cn(head, "w-28 @lg:w-32")}>Status</TableHead>
            <TableHead className={cn(head, "hidden w-36 @2xl:table-cell")}>
              Created
            </TableHead>
            <TableHead className={cn(head, "hidden w-36 @lg:table-cell")}>
              Updated
            </TableHead>
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
                #{ticket.number ?? "—"}
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
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-muted-foreground @lg:hidden">
                  Updated {formatCustomerRelative(ticket.updatedAt, now)}
                </p>
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
                  "hidden whitespace-nowrap text-slate-600 dark:text-muted-foreground @2xl:table-cell",
                )}
              >
                {formatCustomerDate(ticket.createdAt)}
              </TableCell>
              <TableCell
                className={cn(
                  cell,
                  "hidden whitespace-nowrap text-slate-600 dark:text-muted-foreground @lg:table-cell",
                )}
              >
                {formatCustomerRelative(ticket.updatedAt, now)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
