/**
 * VerificationPort implementation over canonical Context material and explicit providers.
 * The pure verification-plan compiler fixes requirement coverage and content identity.
 * Static/dynamic checks execute through injected CheckPorts; reviewer requirements
 * produce review-packet or policy-authorized fast-path entries. Production command
 * checks and deterministic test providers share this engine. Observations remain
 * drafts until Control admits Evidence; this engine never writes the ledger.
 */
import type { VerificationContextPort } from "../../contracts/verification-context.js";
import type { VerificationPort } from "../../contracts/verification.js";
import type { ReviewerPort, CheckPort } from "../../contracts/verification.js";
import type { VerificationRequestV1, VerificationResultV1 } from "../../contracts/verification.js";
import type { CheckCapabilityV1, CheckContextV1, ObservationDraftV1, VerificationIssue, VerificationRejectionCode, VerificationPlanV1 } from '../../contracts/verification.js';
import type { VerificationPlanCompileResult, VerificationPlanRejectionCode } from './verification-plan-compiler.js';
import { compileVerificationPlan } from "./verification-plan-compiler.js";

export type VerificationEngineDeps = {
  context: Pick<VerificationContextPort, 'resolveVerification'>;
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

export class VerificationEngineImpl implements VerificationPort {
  constructor(
    private readonly deps: VerificationEngineDeps,
    private readonly checkPorts: CheckPort[],
    private readonly reviewer: ReviewerPort,
  ) {}

  async verify(request: VerificationRequestV1): Promise<VerificationResultV1> {
    const issue = (path: string, message: string): VerificationIssue => ({ path, message });

    const material = await this.deps.context.resolveVerification(request);
    if (material.status !== 'ready') return material;
    const { planSnapshot, workspaceRevision, policyContent } = material;

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
    const predicateChecks = [...new Map(plan.checks.filter(c => c.satisfactionPath === 'predicate').map(c => [c.checkId, c])).values()];
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
      observations.push(await executePlannedCheck(plan, check.checkId, ctx, port));
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

/** One immutable execution unit; all of its requirement edges share the result. */
export async function executePlannedCheck(plan: VerificationPlanV1, checkId: string, context: CheckContextV1, port: CheckPort): Promise<ObservationDraftV1> {
  const entries = plan.checks.filter(c => c.checkId === checkId && c.satisfactionPath === 'predicate');
  const check = entries[0];
  if (!check || check.kind === 'reviewer') throw Error('unknown predicate in frozen verification plan: ' + checkId);
  const coverage = [...new Map(entries.flatMap(c => c.coverage).map(c => [c.obligationId + '\0' + c.requirementId, c])).values()];
  const outcome = await port.runCheck(context, checkId);
  return { checkId, kind: check.kind, coverage, result: outcome.result, summary: outcome.summary, artifactRef: outcome.artifactRef };
}

