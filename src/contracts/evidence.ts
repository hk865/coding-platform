/**
 * P1-04 Evidence contracts — "CompletionClaim -> Evidence -> Task/Gate SATISFIED".
 *
 * Authority:
 *   - dev_docs/interfaces/completion-policy.md  (§5 Evidence/Binding/
 *     EffectiveEvidenceSet, §6 acceptance, §10 permission boundary)
 *   - dev_docs/interfaces/runtime-collaboration.md (CompletionClaim/verdict
 *     only prove "something was reported"; body-first in ArtifactVault)
 *   - dev_docs/planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md
 *   - IMPLEMENTATION-HANDOFF.md "P1-04 契约与存储语义（冻结）"
 *
 * FROZEN semantics (integrator rulings, recorded in the handoff):
 *   - Evidence is an IMMUTABLE, append-only record. It is created ONCE
 *     (Evidence aggregate revision 1); a replay of the same CommandIdentity+
 *     fingerprint returns committed(replayed); the same evidenceId under a
 *     different identity is a revision_conflict (zero-write).
 *   - Claim/observation/verdict are three evidence kinds. A CompletionClaim is
 *     FORCED to outcome=INCONCLUSIVE (a self-report is never evidence PASS).
 *   - EvidenceBinding is a DERIVED view: the binding anchor (EffectivityAnchorV1)
 *     is recorded immutably with the evidence, while applicability
 *     (APPLICABLE/STALE/OUT_OF_SCOPE) is recomputed PURELY from the anchor +
 *     the current plan/effectivity tuple — never written back.
 *   - EffectivityAnchor covers ONLY the revision tuple (planRef, planRevision,
 *     workspaceRevision, pinned policy, pinned baseline). The verificationPlanRef
 *     is AUDIT association, NOT an applicability input (per-claim changeScope/
 *     check sets legitimately differ within the same revision tuple).
 *   - Late/old-source verdicts ARE admitted (a report is a fact) but their
 *     applicability makes them STALE/OUT_OF_SCOPE so they never wrongly satisfy.
 *   - Every Evidence is body-first: the body lives in the ArtifactVault; the
 *     Evidence record carries only the ArtifactRef (+ bounded summary).
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { TaskTriple } from "./dispatch.js";
import type { PlanRevisionRef, PlanRevisionSnapshot } from "./plan.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "./governance.js";
import type { ArtifactRef } from "./artifact.js";
import type { RunRef } from "./dispatch.js";

// ------------------------------------------------------------------------ //
// Limits                                                                    //
// ------------------------------------------------------------------------ //

/** Hard per-task evidence cap — the reducer/index stay bounded by design. */
export const MAX_EVIDENCE_PER_TASK = 512;
/** Bounded summary text cap (full body goes to the vault). */
export const EVIDENCE_SUMMARY_MAX_BYTES = 4096;

// ------------------------------------------------------------------------ //
// Effectivity anchor                                                        //
// ------------------------------------------------------------------------ //

/**
 * The revision tuple evidence was produced under. It is IMMUTABLE with the
 * evidence. Applicability compares it against the current tuple — nothing is
 * ever written back into history.
 */
export type EffectivityAnchorV1 = {
  schemaVersion: 1;
  planRef: PlanRevisionRef;
  planRevision: number;
  workspaceRevision: number;
  pinnedCompletionPolicy: CompletionPolicyPin;
  pinnedArchitectureBaseline: ArchitectureBaselinePin;
};

/** Audit association to the VerificationPlan that produced/justified the evidence. */
export type VerificationPlanRefV1 = {
  planId: string;
  planDigest: string;
};

// ------------------------------------------------------------------------ //
// Evidence                                                                   //
// ------------------------------------------------------------------------ //

export type EvidenceKind = "claim" | "observation" | "verdict";
export type EvidenceOutcome = "PASS" | "FAIL" | "INCONCLUSIVE";

export const EVIDENCE_KINDS: readonly EvidenceKind[] = ["claim", "observation", "verdict"];
export const EVIDENCE_OUTCOMES: readonly EvidenceOutcome[] = ["PASS", "FAIL", "INCONCLUSIVE"];

export type EvidenceCoverageV1 = {
  obligationId: string;
  requirementId: string;
};

export type EvidenceSourceV1 = {
  actor: ActorRef;
  /** The run that produced the report (null for system/mechanical checks). */
  runRef: RunRef | null;
  /** The check/tool id that produced an observation (null otherwise). */
  checkId: string | null;
};

export type EvidenceSummaryV1 = {
  /** Bounded summary (utf-8 bytes <= EVIDENCE_SUMMARY_MAX_BYTES). */
  text: string;
  /** Vault body ref — the authoritative full material (body-first rule). */
  artifactRef: ArtifactRef | null;
};

export type EvidenceV1 = {
  schemaVersion: 1;
  evidenceId: string;
  kind: EvidenceKind;
  outcome: EvidenceOutcome;
  source: EvidenceSourceV1;
  /** The task this evidence is ABOUT (full-scope triple). */
  subject: TaskTriple;
  /** Non-empty; every entry must reference an obligation/VR of the anchor plan. */
  coverage: EvidenceCoverageV1[];
  anchor: EffectivityAnchorV1;
  verificationPlanRef: VerificationPlanRefV1;
  summary: EvidenceSummaryV1;
};

// ------------------------------------------------------------------------ //
// Aggregate refs / snapshots                                                //
// ------------------------------------------------------------------------ //

export type EvidenceRef = {
  aggregateType: "Evidence";
  projectId: string;
  evidenceId: string;
};

export function evidenceRefFor(projectId: string, evidenceId: string): EvidenceRef {
  return { aggregateType: "Evidence", projectId, evidenceId };
}

export type TaskEvidenceIndexRef = {
  aggregateType: "TaskEvidenceIndex";
  projectId: string;
  goalId: string;
  taskId: string;
};

export function taskEvidenceIndexRefFor(
  projectId: string,
  goalId: string,
  taskId: string,
): TaskEvidenceIndexRef {
  return { aggregateType: "TaskEvidenceIndex", projectId, goalId, taskId };
}

/** Immutable per-evidence aggregate (created once at revision 1 — never mutated). */
export type EvidenceSnapshot = {
  ref: EvidenceRef;
  revision: 1;
  schemaVersion: 1;
  evidence: EvidenceV1;
  admittedAt: string;
};

/** Per-task admission index: evidenceIds in strict admission order (revision == count). */
export type TaskEvidenceIndexSnapshot = {
  ref: TaskEvidenceIndexRef;
  revision: number;
  schemaVersion: 1;
  evidenceIds: string[];
};

// ------------------------------------------------------------------------ //
// EvidenceBinding (DERIVED)                                                  //
// ------------------------------------------------------------------------ //

export type EvidenceApplicability = "APPLICABLE" | "STALE" | "OUT_OF_SCOPE";

export type EvidenceBindingV1 = {
  schemaVersion: 1;
  evidenceId: string;
  subject: TaskTriple;
  coverage: EvidenceCoverageV1[];
  anchor: EffectivityAnchorV1;
  applicability: EvidenceApplicability;
};

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

// ------------------------------------------------------------------------ //
// Effective evidence set (PURE)                                              //
// ------------------------------------------------------------------------ //

export type RequirementKey = { obligationId: string; requirementId: string };

export function requirementKeyOf(c: RequirementKey): string {
  return c.obligationId + "\u0000" + c.requirementId;
}

export type EffectiveEvidenceSet = {
  /** Evidence ids in the effective PASS coverage (ordered by admission). */
  effectiveEvidenceIds: string[];
  /** requirementKey -> the APPLICABLE PASS evidence id that covers it (latest wins). */
  coverageByRequirement: Record<string, string>;
  /**
   * requirementKey -> applicable FAIL/INCONCLUSIVE evidence ids that are NOT
   * legally superseded by a later applicable PASS (they block satisfaction).
   */
  blockingByRequirement: Record<string, string[]>;
  staleEvidenceIds: string[];
  outOfScopeEvidenceIds: string[];
};

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

// ------------------------------------------------------------------------ //
// Command / receipt                                                          //
// ------------------------------------------------------------------------ //

export type SubmitEvidenceCommand = {
  commandId: string;
  commandType: "SubmitEvidence";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** evidenceId — the Evidence aggregate (created once). */
  aggregateId: string;
  /** Always 0: evidence aggregates are created exactly once. */
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { evidence: EvidenceV1 };
};

export type SubmitEvidenceRejectionCode =
  | "invalid"
  | "not_found"
  | "dangling_ref"
  | "evidence_limit_exceeded"
  | "revision_conflict"
  | "idempotency_conflict"
  | "unavailable";

export type SubmitEvidenceReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      evidenceRef: EvidenceRef;
      /** Admission order of this evidence within its task (1-based). */
      evidenceIndex: number;
      evidenceCount: number;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code: SubmitEvidenceRejectionCode;
      issues?: string[];
    };

export function submitEvidenceFingerprint(command: SubmitEvidenceCommand): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: { evidence: command.payload.evidence },
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

// ------------------------------------------------------------------------ //
// Event (P1-04 v1)                                                           //
// ------------------------------------------------------------------------ //

export type EvidenceAdmittedEvent = {
  eventId: string;
  eventType: "EvidenceAdmitted";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "Evidence";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    goalId: string;
    taskId: string;
    evidence: EvidenceV1;
    admittedAt: string;
    /** 1-based admission order in the task evidence index. */
    evidenceIndex: number;
    evidenceCount: number;
  };
};
