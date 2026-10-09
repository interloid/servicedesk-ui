import { PolicyStatus, SlaAppliesTo } from "./types/types";

/**
 * Which tickets each active policy claims, so a ticket never has two:
 *
 *  - at most one active "All customers" policy per tenant — the fallback;
 *  - a customer belongs to at most one active "Selected customers" policy,
 *    which wins over the fallback for that customer's tickets.
 *
 * Inactive and draft policies may overlap freely; the rules bite when a
 * policy is saved as active or switched on. Shared by the server (which
 * enforces it) and the editor (which warns before saving).
 */

/** Another policy's claim, as the rules need it. */
export interface PolicyScope {
  id: string;
  name: string;
  isDefault: boolean;
  status: PolicyStatus;
  appliesTo: SlaAppliesTo;
  customerIds: string[];
}

export interface ScopeCandidate {
  /** Undefined for a policy that isn't saved yet. */
  id?: string;
  /**
   * Being saved as the default SLA. The current default is set inactive by
   * that same save, so it doesn't count as a clash.
   */
  isDefault?: boolean;
  status: PolicyStatus;
  appliesTo: SlaAppliesTo;
  customerIds: string[];
}

export type ScopeConflict =
  | { kind: "fallback"; policy: PolicyScope }
  | {
      kind: "customers";
      /** Customer id → the active policy that already has them. */
      taken: Map<string, PolicyScope>;
    };

/** Null when `candidate` can be active alongside `others`. */
export function findScopeConflict(
  candidate: ScopeCandidate,
  others: PolicyScope[],
): ScopeConflict | null {
  if (candidate.status !== "active") return null;

  const active = others.filter(
    (p) =>
      p.status === "active" &&
      p.id !== candidate.id &&
      !(candidate.isDefault && p.isDefault),
  );

  if (candidate.appliesTo === "All customers") {
    const fallback = active.find((p) => p.appliesTo === "All customers");
    return fallback ? { kind: "fallback", policy: fallback } : null;
  }

  const taken = customersInActivePolicies(active, candidate.id);
  const clashes = new Map<string, PolicyScope>();
  for (const id of candidate.customerIds) {
    const owner = taken.get(id);
    if (owner) clashes.set(id, owner);
  }
  return clashes.size > 0 ? { kind: "customers", taken: clashes } : null;
}

/** Customer id → the active "Selected customers" policy that has them. */
export function customersInActivePolicies(
  others: PolicyScope[],
  excludeId?: string,
): Map<string, PolicyScope> {
  const taken = new Map<string, PolicyScope>();
  for (const p of others) {
    if (
      p.id === excludeId ||
      p.status !== "active" ||
      p.appliesTo !== "Selected customers"
    ) {
      continue;
    }
    for (const id of p.customerIds) taken.set(id, p);
  }
  return taken;
}

/** One sentence for a toast or the form error. */
export function describeScopeConflict(
  conflict: ScopeConflict,
  customerName: (id: string) => string | undefined = () => undefined,
): string {
  if (conflict.kind === "fallback") {
    const name = conflict.policy.name;
    // The default can't be switched off, only replaced.
    return conflict.policy.isDefault
      ? `“${name}” is currently the default SLA for all customers. Enable “Default SLA” to replace it, or assign this SLA to selected customers instead.`
      : `“${name}” is already the active policy for all customers. Make this one Inactive, or deactivate “${name}” first.`;
  }

  const entries = [...conflict.taken.entries()];
  const [firstId, firstPolicy] = entries[0];
  const who = customerName(firstId) ?? "A selected customer";
  const more =
    entries.length > 1
      ? ` (and ${entries.length - 1} more customer${entries.length === 2 ? "" : "s"})`
      : "";
  return `${who}${more} already ${entries.length > 1 ? "have" : "has"} an active policy, “${firstPolicy.name}”. A customer can only be in one active policy.`;
}
