/** Control-owned deterministic domain policy. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import type { PlanRevisionSnapshot } from "../../../contracts/plan.js";
import type { EffectivityAnchorV1, EvidenceV1, EvidenceApplicability, EvidenceBindingV1, EffectiveEvidenceSet } from "../../../contracts/evidence.js";
import { requirementKeyOf } from "../../../contracts/evidence.js";



/** All (obligationId, requirementId) keys of obligations mapped to a task. */
function knownRequirementKeysForTask(
  plan: PlanRevisionSnapshot,
  taskId: string,
): Set<string> {
  const keys = new Set<string>();
  for (const obligation of plan.obligations) {
    if (!obligation.taskIds.includes(taskId)) continue;
    for (const vr of obligation.verificationRequirements) {
      keys.add(obligation.obligationId + "\u0000" + vr.requirementId);
    }
  }
  return keys;
}


/**
 * PURE applicability of ONE evidence against the current plan + tuple
 * (frozen rule):
 *   1. subject task not in the current plan, or NO coverage entry references a
 *      VR of an obligation mapped to that subject task in the current plan ->
 *      OUT_OF_SCOPE (never covered the current requirement);
 *   2. anchor.planRef != current.planRef (a different plan object) ->
 *      OUT_OF_SCOPE;
 *   3. same planRef but any revision component differs (planRevision /
 *      workspaceRevision / pinned policy / pinned baseline) -> STALE (was
 *      applicable under a former revision tuple);
 *   4. otherwise APPLICABLE.
 * Pure function: same inputs -> same state; it NEVER writes history.
 */
export function evidenceApplicability(
  evidence: EvidenceV1,
  currentPlan: PlanRevisionSnapshot,
  currentAnchor: EffectivityAnchorV1,
): EvidenceApplicability {
  const task = currentPlan.tasks.find((t) => t.taskId === evidence.subject.taskId);
  if (task === undefined) return "OUT_OF_SCOPE";
  const knownRequirements = knownRequirementKeysForTask(currentPlan, evidence.subject.taskId);
  const hasValidCoverage = evidence.coverage.some(
    (c) => knownRequirements.has(requirementKeyOf(c)),
  );
  if (!hasValidCoverage) return "OUT_OF_SCOPE";
  const anchor = evidence.anchor;
  if (canonicalJson(anchor.planRef) !== canonicalJson(currentAnchor.planRef)) {
    return "OUT_OF_SCOPE";
  }
  if (
    anchor.planRevision !== currentAnchor.planRevision ||
    anchor.workspaceRevision !== currentAnchor.workspaceRevision ||
    canonicalJson(anchor.pinnedCompletionPolicy) !==
      canonicalJson(currentAnchor.pinnedCompletionPolicy) ||
    canonicalJson(anchor.pinnedArchitectureBaseline) !==
      canonicalJson(currentAnchor.pinnedArchitectureBaseline)
  ) {
    return "STALE";
  }
  return "APPLICABLE";
}


export function evidenceBindingFor(
  evidence: EvidenceV1,
  currentPlan: PlanRevisionSnapshot,
  currentAnchor: EffectivityAnchorV1,
): EvidenceBindingV1 {
  return {
    schemaVersion: 1,
    evidenceId: evidence.evidenceId,
    subject: { ...evidence.subject },
    coverage: evidence.coverage.map((c) => ({ ...c })),
    anchor: { ...evidence.anchor },
    applicability: evidenceApplicability(evidence, currentPlan, currentAnchor),
  };
}


/**
 * PURE EffectiveEvidenceSet computation (completion-policy.md §5):
 *   effective = evidence with applicability APPLICABLE AND not legally
 *   superseded AND coverage satisfying its requirement.
 * Legal supersession: the same (task, obligation, requirement) under the SAME
 * revision tuple; a NEWER (later admission) APPLICABLE PASS takes the effective
 * slot for that requirement. Old FAILs are never deleted — they stay auditable,
 * and an applicable FAIL/INCONCLUSIVE with no later applicable PASS BLOCKS the
 * requirement (and thus satisfaction).
 * A CompletionClaim is NEUTRAL: it is recorded and displayed, but never covers
 * or blocks a requirement (its outcome is forced INCONCLUSIVE).
 * Admission order = the per-task evidence index order (deterministic).
 */
export function selectEffectiveEvidenceSet(
  evidenceList: EvidenceV1[],
  currentPlan: PlanRevisionSnapshot,
  currentAnchor: EffectivityAnchorV1,
): EffectiveEvidenceSet {
  const bindings = evidenceList.map((e) =>
    evidenceBindingFor(e, currentPlan, currentAnchor),
  );
  const stale: string[] = [];
  const outOfScope: string[] = [];
  for (const binding of bindings) {
    if (binding.applicability === "STALE") stale.push(binding.evidenceId);
    else if (binding.applicability === "OUT_OF_SCOPE") outOfScope.push(binding.evidenceId);
  }

  const perRequirement = new Map<string, { index: number; evidence: EvidenceV1 }[]>();
  const indexById = new Map(evidenceList.map((e, i) => [e.evidenceId, i] as const));

  for (const evidence of evidenceList) {
    // A CompletionClaim is a NEUTRAL declaration: it never counts for coverage
    // or blocking (it is forced INCONCLUSIVE and only proves "reported").
    if (evidence.kind === "claim") continue;
    const binding = bindings.find((b) => b.evidenceId === evidence.evidenceId)!;
    if (binding.applicability !== "APPLICABLE") continue;
    for (const coverage of binding.coverage) {
      const key = requirementKeyOf(coverage);
      const list = perRequirement.get(key) ?? [];
      list.push({ index: indexById.get(evidence.evidenceId)!, evidence });
      perRequirement.set(key, list);
    }
  }

  const coverageByRequirement: Record<string, string> = {};
  const blockingByRequirement: Record<string, string[]> = {};
  for (const [key, list] of perRequirement) {
    list.sort((a, b) => a.index - b.index);
    const latest = list[list.length - 1]!;
    if (latest.evidence.outcome === "PASS") {
      coverageByRequirement[key] = latest.evidence.evidenceId;
    } else {
      blockingByRequirement[key] = list
        .filter((entry) => entry.evidence.outcome !== "PASS")
        .map((entry) => entry.evidence.evidenceId);
    }
  }

  const effectiveEvidenceIds = Array.from(
    new Set(Object.values(coverageByRequirement).sort((a, b) => (a < b ? -1 : 1))),
  );
  return {
    effectiveEvidenceIds,
    coverageByRequirement,
    blockingByRequirement,
    staleEvidenceIds: stale,
    outOfScopeEvidenceIds: outOfScope,
  };
}