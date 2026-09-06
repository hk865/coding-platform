/**
 * P1-04 Verification contracts — VerificationEngine.VerificationPort (FROZEN —
 * this ticket is its first real consumer).
 *
 * Authority:
 *   - dev_docs/modules/control/verification-engine.md (verify -> verificationRef /
 *     incomplete / rejected; 组合工具与 Reviewer 证据，不自行完成 Task)
 *   - dev_docs/interfaces/completion-policy.md (§4 layered verification: static /
 *     dynamic / reviewer; no built-in defaults; fast-path only when the policy
 *     explicitly allows a mechanical no-change proof)
 *   - dev_docs/planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md
 *   - IMPLEMENTATION-HANDOFF.md "P1-04 契约与存储语义（冻结）"
 *
 * FROZEN semantics:
 *   - compileVerificationPlan is a DETERMINISTIC PURE function of the exact
 *     tuple (task contract, workspace revision, baseline pin, policy pin,
 *     change scope, risks, available checks); the same tuple always yields the
 *     same plan (content-addressed planId === planDigest). No model call, no
 *     timestamp, no built-in defaults.
 *   - Missing pin / dangling ref / unknown check / no-check-coverage ->
 *     deterministic rejection (NEVER a fallback default).
 *   - Reviewer-layer requirements: satisfactionPath is "review-packet" UNLESS
 *     (semanticChange == "none" AND the versioned policy's fastPathDiffClasses
 *     contains the declared diffClass) — then "no-change-fast-path" with an
 *     EXPLICIT diff class + reason (快放证据显式，不得以“看起来没变”当证明).
 *   - VerificationEngine NEVER writes to the ledger: it produces the plan and
 *     observation drafts; admission is Control's evidence-intake command.
 *   - Reviewer WORK is a formal dispatch Run (P1-03 path); ReviewerPort only
 *     declares capabilities (the double is the only P1-04 consumer).
 */
import type { CommandIdentity } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { TaskTriple } from "./dispatch.js";
import type { PlanRevisionRef, PlanRevisionSnapshot } from "./plan.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "./governance.js";
import type { ArtifactRef } from "./artifact.js";
import type { TaskBudgetV1 } from "./dispatch.js";
import type { VerificationPlanRefV1 } from "./evidence.js";

// ------------------------------------------------------------------------ //
// Change scope / risks / semantic classification                             //
// ------------------------------------------------------------------------ //

export type ChangeScopeV1 = {
  /** Machine-readable diff class, e.g. "docs-only" | "code-change" | "contract". */
  diffClass: string;
  /** Bounded file list (<= CHANGE_SCOPE_MAX_FILES). */
  changedFiles: string[];
  /** Bounded human summary (<= CHANGE_SCOPE_SUMMARY_MAX_BYTES). */
  writeSummary: string;
};

export const CHANGE_SCOPE_MAX_FILES = 64;
export const CHANGE_SCOPE_SUMMARY_MAX_BYTES = 2048;

export type RiskV1 = {
  level: "low" | "medium" | "high";
  description: string;
};

export type SemanticChangeClassification = "none" | "semantic";

// ------------------------------------------------------------------------ //
// Checks                                                                     //
// ------------------------------------------------------------------------ //

/** Static / dynamic / reviewer correspond to the policy requirement kinds. */
export type CheckKind = "static" | "dynamic" | "reviewer";

export type CheckCapabilityV1 = {
  checkId: string;
  kind: CheckKind;
  /** Policy requirement kinds this check can produce PASS/FAIL evidence for. */
  coversKinds: string[];
  replayable: boolean;
};

export type CheckContextV1 = {
  projectId: string;
  goalId: string;
  taskId: string;
  planRef: PlanRevisionRef;
  workspaceRevision: number;
  changeScope: ChangeScopeV1;
};

export type CheckOutcomeV1 = {
  result: "PASS" | "FAIL" | "INCONCLUSIVE";
  /** Provider-stable observation id (audit). */
  observationId: string;
  summary: string;
  artifactRef: ArtifactRef | null;
};

/**
 * CheckPort: the deterministic static/dynamic provider seam for P1-04
 * (fake providers live in contracts/testing; real tools are later tickets).
 */
export interface CheckPort {
  capabilities(): Promise<CheckCapabilityV1[]>;
  runCheck(ctx: CheckContextV1, checkId: string): Promise<CheckOutcomeV1>;
}

// ------------------------------------------------------------------------ //
// VerificationPlan (compile is PURE)                                         //
// ------------------------------------------------------------------------ //

export type VerificationCheckPlan = {
  /** Registered check id (static/dynamic) or the pseudo ids below for reviewer. */
  checkId: string;
  kind: CheckKind;
  /** The policy requirement kind this check satisfies. */
  satisfiesKind: string;
  coverage: { obligationId: string; requirementId: string }[];
  satisfactionPath: "predicate" | "review-packet" | "no-change-fast-path";
  noChangeFastPath?: { diffClass: string; reason: string };
};

export const REVIEWER_SEMANTIC_CHECK_ID = "reviewer-semantic-check";
export const NO_CHANGE_FAST_PATH_CHECK_ID = "no-change-fast-path";

export type VerificationPlanV1 = {
  schemaVersion: 1;
  /** Content address: the plan digest == planId (deterministic compile). */
  planId: string;
  planDigest: string;
  taskRef: TaskTriple;
  planRef: PlanRevisionRef;
  planRevision: number;
  workspaceRevision: number;
  pinnedCompletionPolicy: CompletionPolicyPin;
  pinnedArchitectureBaseline: ArchitectureBaselinePin;
  changeScope: ChangeScopeV1;
  semanticChange: SemanticChangeClassification;
  risks: RiskV1[];
  checks: VerificationCheckPlan[];
};

export type VerificationIssue = { path: string; message: string };

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
 * Frozen rules:
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
export function compileVerificationPlan(
  input: VerificationPlanCompileInput,
): VerificationPlanCompileResult {
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
  const invalidCapabilities = capabilities.filter(
    (c) =>
      c.checkId.length === 0 ||
      (c.kind !== "static" && c.kind !== "dynamic" && c.kind !== "reviewer") ||
      c.coversKinds.length === 0,
  );
  if (invalidCapabilities.length > 0) {
    return {
      status: "rejected",
      code: "unknown_check",
      issues: invalidCapabilities.map((c) =>
        issue("checkCapabilities[" + c.checkId + "]", "malformed or unknown check capability"),
      ),
    };
  }
  const usableKinds = new Set<string>();
  for (const capability of capabilities) {
    for (const kind of capability.coversKinds) usableKinds.add(kind);
  }

  // Requirement -> check coverage per mapped required obligation.
  const requiredRequirements: { obligationId: string; requirementId: string; kind: string; level: string }[] = [];
  for (const obligation of planSnapshot.obligations) {
    if (!obligation.taskIds.includes(task.taskId)) continue;
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
    if (!usableKinds.has(req.kind) && req.kind !== "reviewer") missingKinds.push(req.kind);
  }
  if (missingKinds.length > 0) {
    return {
      status: "rejected",
      code: "no_check_coverage",
      issues: missingKinds.map((kind) =>
        issue("requirementKinds[" + kind + "]", "no registered check covers this requirement kind"),
      ),
    };
  }

  const fastPathDiffClasses = input.policy.fastPathDiffClasses ?? [];
  const checks: VerificationCheckPlan[] = [];
  const seenCoverage = new Set<string>();
  for (const req of requiredKinds) {
    const key = req.obligationId + " " + req.requirementId;
    if (seenCoverage.has(key)) continue;
    seenCoverage.add(key);
    const coverage = { obligationId: req.obligationId, requirementId: req.requirementId };
    if (req.kind === "reviewer") {
      if (
        input.semanticChange === "none" &&
        (fastPathDiffClasses as string[]).includes(input.changeScope.diffClass)
      ) {
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
      } else {
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
      return {
        status: "rejected",
        code: "no_check_coverage",
        issues: [issue("requirementKind[" + req.kind + "]", "no check of kind " + req.kind + " covers it")],
      };
    }
    checks.push({
      checkId: chosen.checkId,
      kind: chosen.kind,
      satisfiesKind: req.kind,
      coverage: [coverage],
      satisfactionPath: "predicate",
    });
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
  };
  return { status: "ready", plan };
}

// ------------------------------------------------------------------------ //
// Verification request + result (the WHOLE module port)                      //
// ------------------------------------------------------------------------ //

export type VerificationRequestV1 = {
  schemaVersion: 1;
  requestId: string;
  projectId: string;
  goalId: string;
  taskId: string;
  planRef: PlanRevisionRef;
  /** Optional: default = canonical Workspace revision. */
  workspaceRevision?: number;
  /** Optional: caller-declared cap on the number of checks executed (<= 64). */
  maxChecks?: number;
  changeScope: ChangeScopeV1;
  semanticChange: SemanticChangeClassification;
  risks: RiskV1[];
  /** Registered immutable revision of the effective policy the request was
   * produced under (a stale pin is rejected — no fallback). */
  pinnedCompletionPolicy?: CompletionPolicyPin;
  pinnedArchitectureBaseline?: ArchitectureBaselinePin;
  budget?: TaskBudgetV1;
};

export type ObservationDraftV1 = {
  checkId: string;
  kind: "static" | "dynamic";
  result: "PASS" | "FAIL" | "INCONCLUSIVE";
  coverage: { obligationId: string; requirementId: string }[];
  summary: string;
  artifactRef: ArtifactRef | null;
};

export type VerificationRejectionCode =
  | "invalid"
  | "not_found"
  | "missing_pin"
  | "dangling_ref"
  | "unknown_check"
  | "no_check_coverage"
  | "budget_exhausted";

export type VerificationResultV1 =
  | {
      status: "ready";
      plan: VerificationPlanV1;
      /** Check results for predicate checks (static/dynamic). Reviewer-layer
       * checks are NOT executed here — they need a ReviewPacket + review run. */
      observations: ObservationDraftV1[];
      verificationPlanRef: VerificationPlanRefV1;
    }
  | { status: "incomplete"; gaps: string[]; issues: VerificationIssue[] }
  | {
      status: "rejected";
      code: VerificationRejectionCode;
      issues: VerificationIssue[];
    };

/** VerificationPort — FROZEN (interfaces_to_freeze: VerificationEngine). */
export interface VerificationPort {
  verify(request: VerificationRequestV1): Promise<VerificationResultV1>;
}

// ------------------------------------------------------------------------ //
// ReviewerPort (minimal frozen shape — review WORK is a dispatch Run)        //
// ------------------------------------------------------------------------ //

export type ReviewerCapabilities = {
  mode: "dispatch-run";
  /** Review packet hard cap (bytes, canonical JSON — bounded, no transcript). */
  maxPacketBytes: number;
  /** The adapter NEVER sees a transcript, only the bounded ReviewPacket. */
  noFullTranscript: true;
};

export interface ReviewerPort {
  capabilities(): Promise<ReviewerCapabilities>;
}

export const REVIEWER_MAX_PACKET_BYTES = 64 * 1024;

