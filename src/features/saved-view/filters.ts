import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  type TicketPriority,
  type TicketStatus,
} from "@/features/tickets/types/tickets.types";

// One source for the enums and their names: the ticket types.
export { TICKET_PRIORITIES, TICKET_STATUSES };
export const STATUS_LABEL = TICKET_STATUS_LABELS;
export const PRIORITY_LABEL = TICKET_PRIORITY_LABELS;

/**
 * Deliberately not a user id.
 *
 * "me" is resolved against whoever is *looking*, not whoever saved the view, so
 * one shared "My open tickets" works for the whole team instead of pinning
 * everyone to its author's queue. Pinning a view to a specific person is a
 * different feature and wants an agent picker.
 */
export const ASSIGNEE_FILTERS = ["any", "unassigned", "me"] as const;

export type AssigneeFilter = (typeof ASSIGNEE_FILTERS)[number];

export const ASSIGNEE_LABEL: Record<AssigneeFilter, string> = {
  any: "Anyone",
  unassigned: "Unassigned",
  me: "Assigned to me",
};

/** A field a condition can test. */
export const FILTER_FIELDS = [
  "status",
  "priority",
  "assignee",
  "search",
] as const;

export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_FIELD_LABEL: Record<FilterField, string> = {
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  search: "Text",
};

/** How a condition joins everything above it. */
export type FilterJoin = "and" | "or";

/**
 * One "Field is Value" condition. `join` links it to the conditions above it
 * and is ignored on the first one.
 */
export type FilterRule = {
  field: FilterField;
  value: string;
  join: FilterJoin;
};

/**
 * The normalised filter every consumer works with.
 *
 * Read top to bottom: each rule's AND / OR joins it to the result of every
 * rule above it, so "Pending OR Open AND Urgent" is (Pending or Open) and
 * Urgent. No rules means every ticket.
 */
export type ViewFilter = { rules: FilterRule[] };

/** Text conditions are capped; the rest are enum values. */
export const SEARCH_MAX = 200;

/**
 * What is actually stored in `saved_views.filter_json`.
 *
 * `rules` is the current shape. The list fields (statuses / priorities /
 * assignee / search, each ANDed, values within a list ORed) and the older
 * comma-joined `status` / `priority` strings are still read so existing rows
 * and the built-in views keep working; nothing writes them.
 */
export type TicketFilterJson = {
  rules?: { field?: string; value?: string; join?: string }[];

  /** @deprecated pre-rules shape, read-only */
  statuses?: string[];
  /** @deprecated pre-rules shape, read-only */
  priorities?: string[];
  /** @deprecated pre-rules shape, read-only */
  assignee?: string;
  /** @deprecated pre-rules shape, read-only */
  search?: string;
  /** @deprecated legacy comma-joined form, read-only */
  status?: string;
  /** @deprecated legacy comma-joined form, read-only */
  priority?: string;
};

const EMPTY_FILTER: ViewFilter = { rules: [] };

function splitLegacy(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** The values a field takes; null for free text. */
export function fieldValues(field: FilterField): readonly string[] | null {
  switch (field) {
    case "status":
      return TICKET_STATUSES;
    case "priority":
      return TICKET_PRIORITIES;
    case "assignee":
      // "Anyone" is no condition at all.
      return ["unassigned", "me"];
    case "search":
      return null;
  }
}

/** A condition's value as shown: "Pending", "Assigned to me", "matching …". */
export function ruleValueLabel(rule: Pick<FilterRule, "field" | "value">) {
  switch (rule.field) {
    case "status":
      return STATUS_LABEL[rule.value as TicketStatus] ?? rule.value;
    case "priority":
      return PRIORITY_LABEL[rule.value as TicketPriority] ?? rule.value;
    case "assignee":
      return ASSIGNEE_LABEL[rule.value as AssigneeFilter] ?? rule.value;
    case "search":
      return `matching "${rule.value}"`;
  }
}

/**
 * A text condition's term as it goes into the query. Commas, parentheses,
 * quotes and backslashes are syntax in a PostgREST logic tree, so they are
 * dropped, as the queue's search box does.
 */
export function searchTerm(value: string): string {
  return value.replace(/[,()"\\]/g, " ").trim();
}

/**
 * A cleaned rule, or null when the field or value isn't one we know. A text
 * condition that is empty once cleaned (only punctuation) is dropped too: it
 * would become `ilike '%%'` and match every ticket.
 */
function cleanRule(raw: {
  field?: string;
  value?: string;
  join?: string;
}): FilterRule | null {
  const field = raw.field as FilterField;
  if (!(FILTER_FIELDS as readonly string[]).includes(field)) return null;

  const allowed = fieldValues(field);
  const value =
    typeof raw.value === "string"
      ? allowed
        ? raw.value.trim().toLowerCase()
        : raw.value.trim()
      : "";
  if (!value || (allowed && !allowed.includes(value))) return null;
  if (field === "search" && !searchTerm(value)) return null;

  return { field, value, join: raw.join === "or" ? "or" : "and" };
}

/**
 * Read whatever is in the column into the current shape. Unknown values are
 * dropped rather than passed through: a stale status name in an old row must
 * not become a query term that silently matches nothing.
 */
export function normalizeFilter(raw: TicketFilterJson | null): ViewFilter {
  if (!raw || typeof raw !== "object") return EMPTY_FILTER;

  if (Array.isArray(raw.rules)) {
    const rules = raw.rules
      .map((rule) =>
        rule && typeof rule === "object" ? cleanRule(rule) : null,
      )
      .filter((rule): rule is FilterRule => rule !== null);
    return { rules };
  }

  // Pre-rules shape: values of one field ORed, fields ANDed. Top to bottom
  // that is exactly "a OR b AND c AND d".
  const rules: FilterRule[] = [];
  const addGroup = (field: FilterField, values: string[]) => {
    values.forEach((value, i) => {
      const rule = cleanRule({ field, value, join: i === 0 ? "and" : "or" });
      if (
        rule &&
        !rules.some((r) => r.field === field && r.value === rule.value)
      ) {
        rules.push(rule);
      }
    });
  };
  addGroup("status", raw.statuses ?? splitLegacy(raw.status));
  addGroup("priority", raw.priorities ?? splitLegacy(raw.priority));
  addGroup("assignee", raw.assignee ? [raw.assignee] : []);
  addGroup("search", raw.search ? [raw.search] : []);

  return { rules };
}

/** The shape written back to the column. */
export function toFilterJson(filter: ViewFilter): TicketFilterJson {
  if (!filter.rules.length) return {};
  return {
    rules: filter.rules.map(({ field, value }, i) => ({
      field,
      value,
      join: i === 0 ? "and" : filter.rules[i].join,
    })),
  };
}

/** A saved view takes between these many conditions; 1–3 reads best. */
export const VIEW_CONDITIONS_MIN = 1;
export const VIEW_CONDITIONS_RECOMMENDED = 3;
export const VIEW_CONDITIONS_MAX = 5;

/** Custom views one person may own on Pro. Built-in and shared-with-you don't count. */
export const CUSTOM_VIEWS_PER_USER_MAX = 10;

export function conditionCount(filter: ViewFilter): number {
  return filter.rules.length;
}

/** Same field and value, whatever the case or spacing of text. */
function ruleKey(rule: Pick<FilterRule, "field" | "value">): string {
  return `${rule.field}:${rule.value.trim().toLowerCase()}`;
}

/** Indexes of rules that repeat a condition above them. */
export function repeatedRuleIndexes(rules: readonly FilterRule[]): number[] {
  const seen = new Set<string>();
  const repeated: number[] = [];
  rules.forEach((rule, i) => {
    const key = ruleKey(rule);
    if (seen.has(key)) repeated.push(i);
    seen.add(key);
  });
  return repeated;
}

/**
 * Fold the rules top to bottom. `leaf` renders one rule and `group` one run of
 * rules under the same join; a run is wrapped when the join changes, which is
 * where the brackets go.
 */
function foldRules<T>(
  rules: readonly FilterRule[],
  leaf: (rule: FilterRule) => T,
  group: (join: FilterJoin, parts: T[]) => T,
): T | null {
  if (!rules.length) return null;

  let join: FilterJoin | null = null;
  let parts: T[] = [leaf(rules[0])];

  for (const rule of rules.slice(1)) {
    if (join !== null && join !== rule.join) {
      parts = [group(join, parts)];
    }
    join = rule.join;
    parts.push(leaf(rule));
  }

  return join === null ? parts[0] : group(join, parts);
}

/**
 * Every way the view's conditions can be true or false together, skipping
 * the impossible ones: a ticket has one status, one priority and one
 * assignee, so two values of one of those can't both hold.
 */
function* truthTable(atoms: FilterRule[]): Generator<Set<string>> {
  const total = 1 << atoms.length;
  outer: for (let mask = 0; mask < total; mask++) {
    const trueKeys = new Set<string>();
    const fieldsHit = new Set<FilterField>();
    for (let i = 0; i < atoms.length; i++) {
      if (!(mask & (1 << i))) continue;
      const atom = atoms[i];
      if (atom.field !== "search") {
        if (fieldsHit.has(atom.field)) continue outer;
        fieldsHit.add(atom.field);
      }
      trueKeys.add(ruleKey(atom));
    }
    yield trueKeys;
  }
}

function uniqueAtoms(rules: readonly FilterRule[]): FilterRule[] {
  const byKey = new Map(rules.map((rule) => [ruleKey(rule), rule]));
  return [...byKey.keys()].sort().map((key) => byKey.get(key)!);
}

function evaluate(rules: readonly FilterRule[], trueKeys: Set<string>) {
  return (
    foldRules(
      rules,
      (rule) => trueKeys.has(ruleKey(rule)),
      (join, parts) =>
        join === "and" ? parts.every(Boolean) : parts.some(Boolean),
    ) ?? true
  );
}

/** False when no ticket could match, like "Status is Pending AND Status is Open". */
export function canMatchAnything(filter: ViewFilter): boolean {
  const atoms = uniqueAtoms(filter.rules);
  if (atoms.length > 12) return true;
  for (const trueKeys of truthTable(atoms)) {
    if (evaluate(filter.rules, trueKeys)) return true;
  }
  return false;
}

/**
 * Two filters with the same key show the same tickets: the order of ANDed or
 * ORed conditions doesn't count, nor does the case of text (ilike). Worked out
 * from the truth table, so "Urgent AND Pending" equals "Pending AND Urgent".
 */
export function filterKey(filter: ViewFilter): string {
  const atoms = uniqueAtoms(filter.rules);
  if (!atoms.length) return "";
  if (atoms.length > 12) return JSON.stringify(toFilterJson(filter));

  let bits = "";
  for (const trueKeys of truthTable(atoms)) {
    bits += evaluate(filter.rules, trueKeys) ? "1" : "0";
  }
  return `${atoms.map(ruleKey).join("|")}#${bits}`;
}

/**
 * The first view, other than `excludeId` (the one being edited), whose filter
 * is the same as `filter`.
 */
export function findSameFilterView<
  T extends { id: string; filter: ViewFilter },
>(
  views: readonly T[],
  filter: ViewFilter,
  excludeId?: string | null,
): T | undefined {
  const key = filterKey(filter);
  return views.find(
    (view) => view.id !== excludeId && filterKey(view.filter) === key,
  );
}

/** A name as compared for duplicates: "My  Queue " and "my queue" are one. */
export function viewNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * The first view, other than `excludeId` (the one being edited), already
 * called `name`. Two views with one name can't be told apart in the list.
 */
export function findSameNameView<T extends { id: string; name: string }>(
  views: readonly T[],
  name: string,
  excludeId?: string | null,
): T | undefined {
  const key = viewNameKey(name);
  if (!key) return undefined;
  return views.find(
    (view) => view.id !== excludeId && viewNameKey(view.name) === key,
  );
}

/**
 * The filter as one PostgREST logic tree, for `query.or(...)`; null when it
 * has no rules. `viewerId` is who "Assigned to me" means.
 */
export function filterToPostgrest(
  filter: ViewFilter,
  viewerId: string,
): string | null {
  return foldRules(
    filter.rules,
    (rule) => {
      switch (rule.field) {
        case "status":
          return `status.eq.${rule.value}`;
        case "priority":
          return `priority.eq.${rule.value}`;
        case "assignee":
          return rule.value === "me"
            ? `assignee_user_id.eq.${viewerId}`
            : "assignee_user_id.is.null";
        case "search": {
          const term = searchTerm(rule.value);
          return `or(subject.ilike."%${term}%",description.ilike."%${term}%")`;
        }
      }
    },
    (join, parts) => `${join}(${parts.join(",")})`,
  );
}

/** One-line summary, so a name like "Triage" is not opaque. */
export function describeFilter(filter: ViewFilter): string {
  type Node = { text: string; grouped: boolean };
  const result = foldRules<Node>(
    filter.rules,
    (rule) => ({ text: ruleValueLabel(rule), grouped: false }),
    (join, parts) => ({
      text: parts
        .map((part) => (part.grouped ? `(${part.text})` : part.text))
        .join(join === "and" ? " and " : " or "),
      grouped: true,
    }),
  );
  return result?.text ?? "All tickets";
}

/**
 * A saved view reduced to what the queue's tab row needs.
 *
 * Built on the server from a SavedView so the client component never imports
 * the (server-only) saved-views service, and never sees owner ids.
 */
export type SavedViewTab = {
  id: string;
  name: string;
  count: number;
  /** The built-in "All tickets" view: active when the queue has no view. */
  isAll: boolean;
};

/**
 * Staff roles a shared view can be shown to. Mirrors the
 * saved_views_visibility_roles_valid constraint; customers never see views.
 */
export const VIEW_ROLES = ["tenant_admin", "manager", "agent"] as const;

export type ViewRole = (typeof VIEW_ROLES)[number];

export const VIEW_ROLE_LABEL: Record<ViewRole, string> = {
  tenant_admin: "Tenant Admin",
  manager: "Manager",
  agent: "Agent",
};

/** What a new shared view defaults to; matches the column default. */
export const DEFAULT_VIEW_ROLES: ViewRole[] = [
  "tenant_admin",
  "manager",
  "agent",
];

export function normalizeViewRoles(
  roles: readonly string[] | null | undefined,
): ViewRole[] {
  const known = new Set<string>(VIEW_ROLES);
  const kept = VIEW_ROLES.filter(
    (role) => (roles ?? []).includes(role) && known.has(role),
  );
  return kept.length ? kept : DEFAULT_VIEW_ROLES;
}

/** The built-in views, in their default order. Keys match saved_views.system_key. */
export const SYSTEM_VIEW_KEYS = ["all", "new", "open", "resolved"] as const;

export type SystemViewKey = (typeof SYSTEM_VIEW_KEYS)[number];

export const VIEW_NAME_MAX = 80;

/** The subtitle under a view's name. Built-in views read as the screenshot of the queue tabs does. */
export function describeView(view: {
  systemKey: SystemViewKey | null;
  filter: ViewFilter;
}): string {
  if (view.systemKey === "all") {
    return "Every ticket in your tenant";
  }

  if (view.systemKey) {
    return `Status: ${describeFilter(view.filter)}`;
  }

  return describeFilter(view.filter);
}
