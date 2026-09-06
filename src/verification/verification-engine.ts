/**
 * VerificationEngine — P1-04 VerificationPort implementation (first consumer
 * freeze). ENTRY FILE (shared baseline — exported signature FROZEN; lane B
 * fills the implementation).
 *
 * Frozen surface:
 *   - verify(request) -> ready { plan, observations, verificationPlanRef } /
 *     incomplete (missing material) / rejected (deterministic codes);
 *   - compileVerificationPlan is the PURE content-addressed planner in
 *     src/contracts/verification.ts — the engine resolves canonical facts
 *     (goal/plan/workspace/pins/policy) and delegates to it; never falls back
 *     to built-in defaults;
 *   - CheckPort registry: static/dynamic predicate checks run through the
 *     ports; the deterministic providers (contracts/testing) are the only P1-04
 *     implementations; reviewer-layer checks are NOT executed here — they
 *     produce review-packet / fast-path plan entries;
 *   - the engine NEVER writes the ledger; observations are drafts for the
 *     evidence-intake command.
 */
import type { StateLedger } from "../contracts/ledger.js";
import type { VerificationPort } from "../contracts/verification.js";
import type { ReviewerPort, CheckPort } from "../contracts/verification.js";
import type { VerificationRequestV1, VerificationResultV1 } from "../contracts/verification.js";
import type {
  CheckCapabilityV1,
  CheckContextV1,
  ObservationDraftV1,
  VerificationIssue,
  VerificationPlanCompileResult,
  VerificationPlanRejectionCode,
  VerificationRejectionCode,
} from "../contracts/verification.js";
import { compileVerificationPlan } from "../contracts/verification.js";
import type { AggregateSnapshot, GoalSnapshot, WorkspaceSnapshot } from "../contracts/ledger.js";
import type { PlanRevisionSnapshot } from "../contracts/plan.js";
import {
  resolveArchitectureBaselineRevision,
  resolveCompletionPolicyRevision,
} from "../contracts/governance.js";
import { canonicalJson } from "../contracts/fingerprint.js";

export type VerificationEngineDeps = {
  ledger: StateLedger;
  now: () => string;
};

/** Map a pure planner rejection code to the module-level verification code. */
function mapCompileRejection(code: VerificationPlanRejectionCode): VerificationRejectionCode {
  switch (code) {
    case "missing_pin":
      return "missing_pin";
    case "pin_mismatch":
      // The engine resolves the plan-snapshot pins itself before compiling, so a
      // pin_mismatch here is a stale/divergent pin — treat it as a dangling ref
      // (the exact revision the plan required is no longer resolvable).
      return "dangling_ref";
    case "unknown_check":
      return "unknown_check";
    case "no_check_coverage":
      return "no_check_coverage";
    case "invalid":
      return "invalid";
    default:
      return "invalid";
  }
}

function isGoalSnapshot(s: AggregateSnapshot): s is GoalSnapshot {
  return s.ref.aggregateType === "Goal";
}

function isWorkspaceSnapshot(s: AggregateSnapshot): s is WorkspaceSnapshot {
  return s.ref.aggregateType === "Workspace";
}

function isPlanSnapshot(s: AggregateSnapshot): s is PlanRevisionSnapshot {
  return s.ref.aggregateType === "PlanRevision";
}

export class VerificationEngineImpl implements VerificationPort {
  constructor(
    private readonly deps: VerificationEngineDeps,
    private readonly checkPorts: CheckPort[],
    private readonly reviewer: ReviewerPort,
  ) {}

  async verify(request: VerificationRequestV1): Promise<VerificationResultV1> {
    const issue = (path: string, message: string): VerificationIssue => ({ path, message });

    // -- 1. Resolve the goal + workspace (canonical facts; not_found when missing).
    const goalResult = await this.deps.ledger.load({
      aggregateType: "Goal",
      projectId: request.projectId,
      goalId: request.goalId,
    });
    if (goalResult.status !== "found" || !isGoalSnapshot(goalResult.snapshot)) {
      return {
        status: "rejected",
        code: "not_found",
        issues: [
          issue(
            "goalRef",
            "goal not found for project '" + request.projectId + "' goal '" + request.goalId + "'",
          ),
        ],
      };
    }
    const goalSnapshot = goalResult.snapshot as GoalSnapshot;

    const workspaceResult = await this.deps.ledger.load(goalSnapshot.workspaceRef);
    if (workspaceResult.status !== "found" || !isWorkspaceSnapshot(workspaceResult.snapshot)) {
      return {
        status: "rejected",
        code: "not_found",
        issues: [issue("workspaceRef", "workspace not found for the goal")],
      };
    }
    const canonicalWorkspaceRevision = (workspaceResult.snapshot as WorkspaceSnapshot).revision;

    // workspaceRevision: default = the canonical workspace revision. An explicit
    // value that diverges from canonical is stale — the engine cannot compile a
    // valid plan for a workspace revision that is not the current one. Stable code:
    // "invalid" (the request references a revision that does not exist as current);
    // it is NOT a pin/ref resolution failure and NOT a budget exhaustion.
    if (request.workspaceRevision !== undefined && request.workspaceRevision !== canonicalWorkspaceRevision) {
      return {
        status: "rejected",
        code: "invalid",
        issues: [
          issue(
            "workspaceRevision",
            "requested workspace revision " +
              request.workspaceRevision +
              " != canonical " +
              canonicalWorkspaceRevision,
          ),
        ],
      };
    }
    const workspaceRevision = request.workspaceRevision ?? canonicalWorkspaceRevision;

    // -- 2. Load the plan by the request.planRef (not_found).
    const planResult = await this.deps.ledger.load(request.planRef);
    if (planResult.status !== "found" || !isPlanSnapshot(planResult.snapshot)) {
      return {
        status: "rejected",
        code: "not_found",
        issues: [issue("planRef", "plan revision not found")],
      };
    }
    const planSnapshot = planResult.snapshot as PlanRevisionSnapshot;

    // -- 3. Resolve the pinned policy + baseline by the plan snapshot's frozen
    //        pins (triple match via the read-only governance helpers).
    const policyPin = planSnapshot.effectiveCompletionPolicy;
    const policyResolution = await resolveCompletionPolicyRevision(
      this.deps.ledger,
      policyPin.ref,
      policyPin.digest,
    );
    if (policyResolution.status !== "found") {
      return {
        status: "rejected",
        code: "dangling_ref",
        issues: [
          issue(
            "pinnedCompletionPolicy",
            "installed CompletionPolicy revision does not match the plan snapshot pin",
          ),
        ],
      };
    }
    const baselinePin = planSnapshot.effectiveArchitectureBaseline;
    const baselineResolution = await resolveArchitectureBaselineRevision(
      this.deps.ledger,
      baselinePin.ref,
      baselinePin.digest,
    );
    if (baselineResolution.status !== "found") {
      return {
        status: "rejected",
        code: "dangling_ref",
        issues: [
          issue(
            "pinnedArchitectureBaseline",
            "installed ArchitectureBaseline revision does not match the plan snapshot pin",
          ),
        ],
      };
    }
    const policyContent = policyResolution.snapshot.content;

    // Caller-declared pins, when present, must be exactly the plan snapshot's
    // frozen pins — a stale declaration is rejected (no fallback).
    if (
      request.pinnedCompletionPolicy !== undefined &&
      canonicalJson(request.pinnedCompletionPolicy) !== canonicalJson(policyPin)
    ) {
      return {
        status: "rejected",
        code: "dangling_ref",
        issues: [
          issue(
            "pinnedCompletionPolicy",
            "request's declared CompletionPolicy pin is stale (does not match the plan snapshot pin)",
          ),
        ],
      };
    }
    if (
      request.pinnedArchitectureBaseline !== undefined &&
      canonicalJson(request.pinnedArchitectureBaseline) !== canonicalJson(baselinePin)
    ) {
      return {
        status: "rejected",
        code: "dangling_ref",
        issues: [
          issue(
            "pinnedArchitectureBaseline",
            "request's declared ArchitectureBaseline pin is stale (does not match the plan snapshot pin)",
          ),
        ],
      };
    }

    // -- 4. Gather the available check capabilities from the injected ports.
    const capabilities: CheckCapabilityV1[] = [];
    for (const port of this.checkPorts) {
      const caps = await port.capabilities();
      for (const c of caps) capabilities.push(c);
    }

    // -- 5. Compile the plan (PURE; maps its deterministic rejections directly).
    //        The policy payload only carries fastPathDiffClasses when the resolved
    //        policy actually declares one (exactOptionalPropertyTypes).
    const policy: { requirementKinds: string[]; fastPathDiffClasses?: string[] } = {
      requirementKinds: policyContent.requirementKinds,
    };
    if (policyContent.fastPathDiffClasses !== undefined) {
      policy.fastPathDiffClasses = policyContent.fastPathDiffClasses;
    }
    const compiled: VerificationPlanCompileResult = compileVerificationPlan({
      schemaVersion: 1,
      taskRef: { projectId: request.projectId, goalId: request.goalId, taskId: request.taskId },
      planRef: request.planRef,
      planSnapshot,
      workspaceRevision,
      changeScope: request.changeScope,
      semanticChange: request.semanticChange,
      risks: request.risks,
      checkCapabilities: capabilities,
      policy,
    });
    if (compiled.status === "rejected") {
      return {
        status: "rejected",
        code: mapCompileRejection(compiled.code),
        issues: compiled.issues,
      };
    }
    const plan = compiled.plan;

    // -- 6. maxChecks budget (default 8): only PREDICATE checks are executed, so
    //        only they count against the cap. Reviewer-plan entries never run here.
    const predicateChecks = plan.checks.filter((c) => c.satisfactionPath === "predicate");
    const maxChecks = request.maxChecks ?? 8;
    if (predicateChecks.length > maxChecks) {
      return {
        status: "rejected",
        code: "budget_exhausted",
        issues: [
          issue(
            "maxChecks",
            "predicate checks " + predicateChecks.length + " exceed maxChecks " + maxChecks,
          ),
        ],
      };
    }

    // Index the predicates by checkId (a static/dynamic capability provides the port).
    const portByCheckId = new Map<string, CheckPort>();
    for (const port of this.checkPorts) {
      const caps = await port.capabilities();
      for (const c of caps) {
        if (c.kind === "static" || c.kind === "dynamic") {
          if (!portByCheckId.has(c.checkId)) portByCheckId.set(c.checkId, port);
        }
      }
    }

    const ctx: CheckContextV1 = {
      projectId: request.projectId,
      goalId: request.goalId,
      taskId: request.taskId,
      planRef: request.planRef,
      workspaceRevision,
      changeScope: request.changeScope,
    };

    // -- 7. Run the predicate checks; reviewer-layer checks are NOT executed here.
    const observations: ObservationDraftV1[] = [];
    for (const check of predicateChecks) {
      const port = portByCheckId.get(check.checkId);
      if (port === undefined) {
        return {
          status: "rejected",
          code: "unknown_check",
          issues: [
            issue("checkId", "no registered check port for predicate check '" + check.checkId + "'"),
          ],
        };
      }
      const outcome = await port.runCheck(ctx, check.checkId);
      observations.push({
        checkId: check.checkId,
        kind: check.kind === "dynamic" ? "dynamic" : "static",
        result: outcome.result,
        coverage: check.coverage.map((c) => ({ ...c })),
        summary: outcome.summary,
        artifactRef: outcome.artifactRef,
      });
    }

    // -- 8. Ready result. The engine NEVER writes the ledger: these drafts feed
    //        Control's evidence-intake command. verificationPlanRef is the audit
    //        association (== plan.planId/planDigest — content-addressed).
    return {
      status: "ready",
      plan,
      observations,
      verificationPlanRef: { planId: plan.planId, planDigest: plan.planDigest },
    };
  }
}

export function createVerificationEngine(
  deps: VerificationEngineDeps,
  checkPorts: CheckPort[],
  reviewer: ReviewerPort,
): VerificationEngineImpl {
  return new VerificationEngineImpl(deps, checkPorts, reviewer);
}
