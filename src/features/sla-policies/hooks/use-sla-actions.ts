import { useState } from "react";
import { CreateSlaPolicyDto, SlaPolicy } from "../types/types";
import {
  createSlaPolicyAction,
  deleteSlaPolicyAction,
  toggleSlaPolicyAction,
} from "../action/sla.actions";

export const useSlaActions = (tenant: string, initialPolicies: SlaPolicy[]) => {
  const [policies, setPolicies] = useState<SlaPolicy[]>(initialPolicies);

  const handleToggleStatus = async (id: string) => {
    const previous = policies;
    setPolicies((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              status: p.status === "active" ? "paused" : "active",
            }
          : p,
      ),
    );

    const result = await toggleSlaPolicyAction(tenant, id);
    if (!result.success) {
      setPolicies(previous);
    }
    return result;
  };

  const handleCreatePolicy = async (dto: CreateSlaPolicyDto) => {
    const result = await createSlaPolicyAction(tenant, dto);
    if (result.success && "policy" in result && result.policy) {
      const created = result.policy as SlaPolicy;
      setPolicies((prev) => [created, ...prev]);
    }
    return result;
  };

  const handleDeletePolicy = async (id: string) => {
    const previous = policies;
    setPolicies((prev) => prev.filter((p) => p.id !== id));
    const result = await deleteSlaPolicyAction(tenant, id);
    if (!result.success) {
      setPolicies(previous);
    }
    return result;
  };

  return {
    policies,
    handleToggleStatus,
    handleCreatePolicy,
    handleDeletePolicy,
  };
};
