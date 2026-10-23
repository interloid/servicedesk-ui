import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AUDIT_RETENTION_DAYS,
  DEFAULT_AUDIT_PAGE_SIZE,
  addDays,
  type AuditActor,
  type AuditEvent,
  type AuditFilters,
  type AuditPageData,
} from "../types/audit";
import { AuditLogView } from "./audit-log-view";

/**
 * Made-up events for the blurred backdrop. A locked workspace's real log is
 * never read: the blur is decoration, and anything under it can still be
 * read from the page source. A fixed clock keeps server and client renders
 * the same.
 */
const SAMPLE_NOW = Date.parse("2026-10-20T12:00:00Z");
const SAMPLE_TODAY = "2026-10-20";
const SAMPLE_TIME_ZONE = "UTC";

const sampleActor = (id: string, name: string, role: string): AuditActor => ({
  id,
  name,
  email: `${id}@example.com`,
  avatarUrl: null,
  role,
});

const ALEX = sampleActor("sample-1", "Alex Morgan", "Tenant Admin");
const SAM = sampleActor("sample-2", "Sam Lee", "Manager");
const JORDAN = sampleActor("sample-3", "Jordan Ray", "Agent");

const sampleEvent = (
  index: number,
  event: Pick<
    AuditEvent,
    "action" | "module" | "result" | "entity" | "summary"
  > & {
    actor: AuditActor | null;
  },
): AuditEvent => ({
  id: `sample-${index}`,
  createdAt: new Date(SAMPLE_NOW - index * 47 * 60_000).toISOString(),
  entityId: null,
  changes: [],
  related: null,
  ip: "203.0.113.10",
  userAgent: null,
  meta: {},
  ...event,
});

const SAMPLE_EVENTS: AuditEvent[] = [
  sampleEvent(1, {
    action: "login",
    module: "authentication",
    result: "success",
    entity: "Session",
    summary: "Signed in",
    actor: ALEX,
  }),
  sampleEvent(2, {
    action: "role_change",
    module: "team",
    result: "success",
    entity: "Member",
    summary: "Changed Jordan Ray's role to Agent",
    actor: ALEX,
  }),
  sampleEvent(3, {
    action: "login_failed",
    module: "security",
    result: "failure",
    entity: "Session",
    summary: "Failed sign-in attempt",
    actor: SAM,
  }),
  sampleEvent(4, {
    action: "update",
    module: "sla",
    result: "success",
    entity: "SLA policy",
    summary: "Updated the Standard SLA policy",
    actor: SAM,
  }),
  sampleEvent(5, {
    action: "invite",
    module: "team",
    result: "success",
    entity: "Member",
    summary: "Invited a new agent",
    actor: ALEX,
  }),
  sampleEvent(6, {
    action: "update",
    module: "billing",
    result: "success",
    entity: "Subscription",
    summary: "Changed the plan",
    actor: null,
  }),
  sampleEvent(7, {
    action: "logout",
    module: "authentication",
    result: "success",
    entity: "Session",
    summary: "Signed out",
    actor: JORDAN,
  }),
];

const SAMPLE_DATA: AuditPageData = {
  events: SAMPLE_EVENTS,
  total: 128,
  tabCounts: {
    all: 128,
    authentication: 54,
    team: 21,
    sla: 12,
    billing: 6,
    security: 9,
  },
  summary: { total: 128, users: 6, modules: 5, security: 9 },
  users: [ALEX, SAM, JORDAN].map(({ id, name, email }) => ({
    id,
    name,
    email,
  })),
};

const SAMPLE_FILTERS: AuditFilters = {
  from: addDays(SAMPLE_TODAY, -6),
  to: SAMPLE_TODAY,
  q: "",
  module: null,
  action: null,
  user: null,
  result: null,
  page: 1,
  pageSize: DEFAULT_AUDIT_PAGE_SIZE,
};

/**
 * What a workspace without the Business plan sees at /settings/audit: the
 * log's shape, blurred, under a lock, like Reports and Branding.
 */
export function AuditLocked({
  plansHref,
  canUpgrade,
}: {
  plansHref: string;
  /** Only a Tenant Admin can open Plans & pricing; a Manager is told who can. */
  canUpgrade: boolean;
}) {
  return (
    <div className="relative h-full min-h-[calc(100svh-4rem)] overflow-hidden">
      <div
        aria-hidden
        inert
        className="pointer-events-none h-full select-none opacity-60 blur-[6px]"
      >
        <AuditLogView
          data={SAMPLE_DATA}
          filters={SAMPLE_FILTERS}
          timeZone={SAMPLE_TIME_ZONE}
          now={SAMPLE_NOW}
          today={SAMPLE_TODAY}
          earliest={addDays(SAMPLE_TODAY, -(AUDIT_RETENTION_DAYS - 1))}
        />
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-background/30 px-4">
        <div className="flex w-full max-w-lg flex-col items-center rounded-2xl bg-white/80 px-6 py-10 text-center shadow-lg ring-1 ring-black/5 backdrop-blur-md sm:px-10">
          <span
            aria-hidden
            className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <Lock className="size-9" />
          </span>
          <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Audit log is available on the Business plan
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            {canUpgrade
              ? "Upgrade to Business to track sign-ins, role changes, SLA and billing changes."
              : "Ask a Tenant Admin to upgrade to Business to view the audit log."}
          </p>
          {canUpgrade && (
            <Button
              asChild
              className="mt-6 h-12 gap-2 rounded-xl px-10 text-base font-semibold"
            >
              <Link href={plansHref}>
                View plans
                <ArrowRight aria-hidden className="size-5" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
