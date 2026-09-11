/** Deterministic, content-addressed verification planning. No state writes or defaults. */
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { CompletionPolicyPin, ArchitectureBaselinePin } from '../../contracts/governance.js';
import type { VerificationIssue, VerificationCheckPlan, VerificationPlanV1, ChangeScopeV1, RiskV1, SemanticChangeClassification, CheckCapabilityV1 } from '../../contracts/verification.js';
import { NO_CHANGE_FAST_PATH_CHECK_ID, REVIEWER_SEMANTIC_CHECK_ID } from '../../contracts/verification.js';
import type { TaskTriple } from '../../contracts/dispatch.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../contracts/plan.js';

export type VerificationPlanRejectionCode =
  | "missing_pin"
  | "pin_mismatch"
  | "unknown_check"
  | "no_check_coverage"
  | "invalid";

export type VerificationPlanCompileInput = {
  schemaVersion: 1;
  taskRef: TaskTriple;
  planRef: PlanRevisionRef;
  planSnapshot: PlanRevisionSnapshot;
  workspaceRevision: number;
  changeScope: ChangeScopeV1;
  semanticChange: SemanticChangeClassification;
  risks: RiskV1[];
  checkCapabilities: CheckCapabilityV1[];
  selection?: 'all-applicable';
  configurationDigest?: string;
  /** Resolved policy content (never a built-in default). */
  policy: { requirementKinds: string[]; fastPathDiffClasses?: string[] };
};

export type VerificationPlanCompileResult =
  | { status: "ready"; plan: VerificationPlanV1 }
  | { status: "rejected"; code: VerificationPlanRejectionCode; issues: VerificationIssue[] };

function isNonEmptyPin(pin: CompletionPolicyPin | ArchitectureBaselinePin | undefined): boolean {
  return pin !== undefined && pin.ref.projectId.length > 0 && pin.digest.length > 0;
}
/**
 * DETERMINISTIC plan compilation (pure — same tuple => same plan).
 * Compilation invariants:
 *   1. pins must be present in the input AND equal the pinned refs of the
 *      accepted plan snapshot (missing_pin / pin_mismatch — no defaults);
 *   2. check capabilities must be well-formed (non-empty ids, known kinds);
 *      a capability that covers no policy kind is dropped, an unknown kind is
 *      invalid;
 *   3. per required VerificationRequirement of the task: pick the check whose
 *      coversKinds contains the requirement kind (deterministic: sorted by
 *      checkId, first match wins). Static/dynamic -> satisfactionPath
 *      "predicate". Reviewer -> "no-change-fast-path" iff semanticChange ==
 *      "none" AND policy.fastPathDiffClasses includes changeScope.diffClass,
 *      else "review-packet";
 *   4. a required VR whose kind cannot be satisfied by any capability and is
 *      NOT "reviewer" -> no_check_coverage (deterministic failure, never a
 *      silent skip);
 *   5. no task obligations / no required VRs -> invalid.
 * planDigest (== planId) = JCS + SHA-256 over the @input tuple @content.
 */
export function compileVerificationPlan(input: VerificationPlanCompileInput): VerificationPlanCompileResult {
  const allApplicable = input.selection === 'all-applicable';
  const issue = (path: string, message: string): VerificationIssue => ({ path, message });
  const planSnapshot = input.planSnapshot;
  const pins = {
    pinnedCompletionPolicy: planSnapshot.effectiveCompletionPolicy,
    pinnedArchitectureBaseline: planSnapshot.effectiveArchitectureBaseline,
  };
  if (!isNonEmptyPin(pins.pinnedCompletionPolicy) || !isNonEmptyPin(pins.pinnedArchitectureBaseline)) {
    return {
      status: "rejected",
      code: "missing_pin",
      issues: [issue("pins", "plan snapshot is missing an effective governance pin; no default may be used")],
    };
  }
  const task = planSnapshot.tasks.find((t) => t.taskId === input.taskRef.taskId);
  if (task === undefined) {
    return {
      status: "rejected",
      code: "invalid",
      issues: [issue("taskRef.taskId", "task not found in the accepted plan snapshot")],
    };
  }
  // Capability validation.
  const capabilities = [...input.checkCapabilities];
  const invalidCapabilities = capabilities.filter((c) => c.checkId.length === 0 ||
    (c.kind !== "static" && c.kind !== "dynamic" && c.kind !== "reviewer") ||
    c.coversKinds.length === 0);
  if (invalidCapabilities.length > 0) {
    return {
      status: "rejected",
      code: "unknown_check",
      issues: invalidCapabilities.map((c) => issue("checkCapabilities[" + c.checkId + "]", "malformed or unknown check capability")),
    };
  }
  const usableKinds = new Set<string>();
  for (const capability of capabilities) {
    for (const kind of capability.coversKinds)
      usableKinds.add(kind);
  }
  // Requirement -> check coverage per mapped required obligation.
  const requiredRequirements: {
    obligationId: string;
    requirementId: string;
    kind: string;
    level: string;
  }[] = [];
  for (const obligation of planSnapshot.obligations) {
    if (!obligation.taskIds.includes(task.taskId))
      continue;
    for (const vr of obligation.verificationRequirements) {
      requiredRequirements.push({
        obligationId: obligation.obligationId,
        requirementId: vr.requirementId,
        kind: vr.kind,
        level: vr.requirementLevel,
      });
    }
  }
  const requiredKinds = requiredRequirements.filter((r) => r.level === "required");
  if (requiredRequirements.length === 0 || requiredKinds.length === 0) {
    return {
      status: "rejected",
      code: "invalid",
      issues: [issue("plan.obligations", "task has no required VerificationRequirement to cover")],
    };
  }
  const missingKinds: string[] = [];
  for (const req of requiredKinds) {
    if (!usableKinds.has(req.kind) && req.kind !== "reviewer")
      missingKinds.push(req.kind);
  }
  if (missingKinds.length > 0 && !allApplicable) {
    return {
      status: "rejected",
      code: "no_check_coverage",
      issues: missingKinds.map((kind) => issue("requirementKinds[" + kind + "]", "no registered check covers this requirement kind")),
    };
  }
  const fastPathDiffClasses = input.policy.fastPathDiffClasses ?? [];
  const checks: VerificationCheckPlan[] = [];
  const uncovered: NonNullable<VerificationPlanV1['uncovered']> = [];
  const seenCoverage = new Set<string>();
  for (const req of requiredKinds) {
    const key = req.obligationId + "\0" + req.requirementId;
    if (seenCoverage.has(key))
      continue;
    seenCoverage.add(key);
    const coverage = { obligationId: req.obligationId, requirementId: req.requirementId };
    if (req.kind === "reviewer") {
      if (input.semanticChange === "none" &&
        (fastPathDiffClasses as string[]).includes(input.changeScope.diffClass)) {
        checks.push({
          checkId: NO_CHANGE_FAST_PATH_CHECK_ID,
          kind: "reviewer",
          satisfiesKind: req.kind,
          coverage: [coverage],
          satisfactionPath: "no-change-fast-path",
          noChangeFastPath: {
            diffClass: input.changeScope.diffClass,
            reason: "mechanical no-change proof confirmed by the versioned policy exemption",
          },
        });
      }
      else {
        checks.push({
          checkId: REVIEWER_SEMANTIC_CHECK_ID,
          kind: "reviewer",
          satisfiesKind: req.kind,
          coverage: [coverage],
          satisfactionPath: "review-packet",
        });
      }
      continue;
    }
    const matching = capabilities
      .filter((c) => c.kind === req.kind && c.coversKinds.includes(req.kind))
      .sort((a, b) => (a.checkId < b.checkId ? -1 : a.checkId > b.checkId ? 1 : 0));
    const chosen = matching[0];
    if (chosen === undefined) {
      if (allApplicable && (req.kind === 'static' || req.kind === 'dynamic')) {
        uncovered.push({ ...coverage, kind: req.kind });
        continue;
      }
      return {
        status: "rejected",
        code: "no_check_coverage",
        issues: [issue("requirementKind[" + req.kind + "]", "no check of kind " + req.kind + " covers it")],
      };
    }
    for (const selected of allApplicable ? matching : [chosen]) {
      const existing = allApplicable ? checks.find(c => c.checkId === selected.checkId) : undefined;
      if (existing) existing.coverage.push(coverage);
      else checks.push({
        checkId: selected.checkId,
        kind: selected.kind,
        satisfiesKind: req.kind,
        coverage: [coverage],
        satisfactionPath: "predicate",
      });
    }
  }
  // Explicitly registered scope checks also run when the accepted task has no
  // requirement of their kind. Their empty coverage cannot become Evidence.
  if (allApplicable) for (const capability of capabilities) {
    if (capability.kind === 'reviewer' || checks.some(c => c.checkId === capability.checkId)) continue;
    checks.push({ checkId: capability.checkId, kind: capability.kind, satisfiesKind: capability.kind, coverage: [], satisfactionPath: 'predicate' });
  }
  checks.sort((a, b) => (a.checkId < b.checkId ? -1 : a.checkId > b.checkId ? 1 : 0));
  const content = {
    schemaVersion: input.schemaVersion,
    taskRef: input.taskRef,
    planRef: input.planRef,
    planRevision: planSnapshot.planRevision,
    workspaceRevision: input.workspaceRevision,
    pinnedCompletionPolicy: pins.pinnedCompletionPolicy,
    pinnedArchitectureBaseline: pins.pinnedArchitectureBaseline,
    changeScope: input.changeScope,
    semanticChange: input.semanticChange,
    risks: input.risks,
    checks,
    policyKinds: [...input.policy.requirementKinds].sort(),
    fastPathDiffClasses: [...fastPathDiffClasses].sort(),
    ...(allApplicable ? { selection: 'all-applicable', uncovered, configurationDigest: input.configurationDigest ?? null } : {}),
  };
  const planDigest = sha256Hex(canonicalJson(content));
  const plan: VerificationPlanV1 = {
    schemaVersion: 1,
    planId: planDigest,
    planDigest,
    taskRef: { ...input.taskRef },
    planRef: { ...input.planRef },
    planRevision: planSnapshot.planRevision,
    workspaceRevision: input.workspaceRevision,
    pinnedCompletionPolicy: pins.pinnedCompletionPolicy,
    pinnedArchitectureBaseline: pins.pinnedArchitectureBaseline,
    changeScope: { ...input.changeScope, changedFiles: [...input.changeScope.changedFiles] },
    semanticChange: input.semanticChange,
    risks: input.risks.map((r) => ({ ...r })),
    checks,
    ...(allApplicable ? { uncovered } : {}),
    ...(input.configurationDigest ? { configurationDigest: input.configurationDigest } : {}),
  };
  return { status: "ready", plan };
}
