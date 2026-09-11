import type { RemediationDeduplicationKeyV1, RemediationTaskStatus } from "../../../contracts/remediation.js";

/** Pure: the only statuses that keep the dedup key "occupied" (at most ONE effective task). */
export function remediationTaskOccupiesDedupKey(status: RemediationTaskStatus): boolean {
  return status === "pending" || status === "writing" || status === "verifying";
}

/**
 * 漂移预算的“周期”身份（PURE）：dedupKey 除 findingId 之外的全部范围 ——
 * project / workspace / policyRevision / workspaceRevision。
 *
 * 理由：driftBudget.maxRemediationsPerCycle 约束的是“同一政策修订 + 同一工作区版本下
 * 一共能放行多少次返工”，因此同一 cycle 内不同 Finding 必须共享同一份额度；
 * 若把 findingId 也算进周期，额度会退化成“每个 Finding 一份”，预算形同不存在。
 * 这与 dedupKey 自身的构造（policyPin.ref.revision + workspaceRevision）保持一致：
 * 返工一旦落地，workspaceRevision 前进即进入新的 cycle。
 */
export type RemediationDriftCycleV1 = {
  projectId: string;
  workspaceId: string;
  policyRevision: number;
  workspaceRevision: number;
};

export function remediationDriftCycleOf(key: RemediationDeduplicationKeyV1): RemediationDriftCycleV1 {
  return {
    projectId: key.projectId,
    workspaceId: key.workspaceId,
    policyRevision: key.policyRevision,
    workspaceRevision: key.workspaceRevision,
  };
}

export function sameRemediationDriftCycle(a: RemediationDriftCycleV1, b: RemediationDriftCycleV1): boolean {
  return (
    a.projectId === b.projectId &&
    a.workspaceId === b.workspaceId &&
    a.policyRevision === b.policyRevision &&
    a.workspaceRevision === b.workspaceRevision
  );
}
