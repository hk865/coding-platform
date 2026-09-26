/**
 * R3e.1 VerificationPlan compiler (implementation).
 *
 * The SINGLE deterministic, content-addressed pure compiler. The same accepted
 * Plan + policy + source tuple always compiles to the same `planDigest`. It
 * never reads the store, never defaults a missing governance pin and never
 * accepts a caller-supplied digest, coverage or PASS verdict.
 *
 * The compiled plan binds each REQUIRED verification requirement to the frozen
 * registered capabilities that can cover its kind. A required requirement with
 * no covering capability is reported as an `uncovered` gap (never silently
 * dropped and never counted as satisfied). An obligation that is required but
 * carries no required verification requirement is `invalid` — an empty required
 * set must never fold to a vacuous PASS.
 */
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EvidenceCoverageV1 } from '../../../contracts/evidence.js';
import type {
    ChangeScopeV1, CheckCapabilityV1, RiskV1, SemanticChangeClassification,
    VerificationCheckKind, VerificationCheckPlan, VerificationIssue, VerificationPlanV1,
} from '../../../contracts/verification.js';

export type VerificationPlanRejectionCode =
    | 'missing_pin'
    | 'pin_mismatch'
    | 'unknown_check'
    | 'no_check_coverage'
    | 'invalid';

export type VerificationPlanCompileInput = {
    schemaVersion: 1;
    taskRef: TaskTriple;
    planRef: PlanRevisionRef;
    planSnapshot: PlanRevisionSnapshot;
    workspaceRevision: number;
    changeScope: ChangeScopeV1;
    semanticChange: SemanticChangeClassification;
    risks: RiskV1[];
    /** Registered capabilities of the frozen trusted configuration only. */
    checkCapabilities: CheckCapabilityV1[];
    selection?: 'all-applicable';
    configurationDigest?: string;
    /** Resolved policy content (never a built-in default). */
    policy: { requirementKinds: string[]; fastPathDiffClasses?: string[] };
};

export type VerificationPlanCompileResult =
    | { status: 'ready'; plan: VerificationPlanV1 }
    | { status: 'rejected'; code: VerificationPlanRejectionCode; issues: VerificationIssue[] };

function rejected(code: VerificationPlanRejectionCode, issues: VerificationIssue[]): VerificationPlanCompileResult {
    return { status: 'rejected', code, issues };
}

/**
 * DETERMINISTIC plan compilation (pure — same tuple => same plan). It folds the
 * pinned policy's required requirement kinds onto the frozen registered
 * capabilities; nothing here reads time, randomness or the current store.
 */
export function compileVerificationPlan(input: VerificationPlanCompileInput): VerificationPlanCompileResult {
    const plan = input.planSnapshot;
    if (plan.ref.projectId !== input.taskRef.projectId || plan.ref.planId !== input.planRef.planId
        || plan.goalRef.projectId !== input.taskRef.projectId || plan.goalRef.goalId !== input.taskRef.goalId) {
        return rejected('pin_mismatch', [{ path: 'planRef', message: 'the Plan revision does not belong to the requested task/goal' }]);
    }
    if (!plan.tasks.some(task => task.taskId === input.taskRef.taskId)) {
        return rejected('missing_pin', [{ path: 'taskRef', message: 'the adopted Plan does not define the requested task' }]);
    }
    const requiredObligations = plan.obligations.filter(obligation => obligation.requirementLevel === 'required');
    if (requiredObligations.length === 0) {
        return rejected('invalid', [{ path: 'obligations', message: 'the adopted Plan has no required acceptance obligation' }]);
    }

    const checks = new Map<string, VerificationCheckPlan>();
    const uncovered: { obligationId: string; requirementId: string; kind: VerificationCheckKind }[] = [];
    const knownKinds = new Set(input.policy.requirementKinds);
    for (const obligation of requiredObligations) {
        const requiredRequirements = obligation.verificationRequirements
            .filter(requirement => requirement.requirementLevel === 'required');
        if (requiredRequirements.length === 0) {
            return rejected('invalid', [{ path: obligation.obligationId,
                message: `required obligation ${obligation.obligationId} has no required verification requirement` }]);
        }
        for (const requirement of requiredRequirements) {
            const covering = input.checkCapabilities
                .filter(capability => capability.coversKinds.includes(requirement.kind));
            if (covering.length === 0 || !knownKinds.has(requirement.kind)) {
                uncovered.push({ obligationId: obligation.obligationId, requirementId: requirement.requirementId,
                    kind: requirement.kind as VerificationCheckKind });
                continue;
            }
            const coverage: EvidenceCoverageV1 = { obligationId: obligation.obligationId, requirementId: requirement.requirementId };
            for (const capability of covering) {
                const existing = checks.get(capability.checkId);
                if (existing === undefined) {
                    checks.set(capability.checkId, { checkId: capability.checkId, kind: capability.kind,
                        satisfiesKind: requirement.kind, coverage: [coverage], satisfactionPath: 'predicate' });
                } else {
                    existing.coverage.push(coverage);
                }
            }
        }
    }

    const content = {
        schemaVersion: 1 as const,
        taskRef: { ...input.taskRef },
        planRef: { ...input.planRef },
        planRevision: plan.planRevision,
        workspaceRevision: input.workspaceRevision,
        pinnedCompletionPolicy: plan.effectiveCompletionPolicy,
        pinnedArchitectureBaseline: plan.effectiveArchitectureBaseline,
        changeScope: { diffClass: input.changeScope.diffClass,
            changedFiles: [...input.changeScope.changedFiles], writeSummary: input.changeScope.writeSummary },
        semanticChange: input.semanticChange,
        risks: input.risks.map(risk => ({ ...risk })),
        checks: [...checks.values()],
        ...(uncovered.length > 0 ? { uncovered } : {}),
        ...(input.configurationDigest === undefined ? {} : { configurationDigest: input.configurationDigest }),
    };
    let planDigest: string;
    try {
        planDigest = sha256Hex(canonicalJson(content as unknown as JsonValue));
    } catch (error) {
        return rejected('invalid', [{ path: 'plan', message: `the compiled plan is not canonical JSON: ${String(error)}` }]);
    }
    const out: VerificationPlanV1 = { ...content, planId: planDigest, planDigest };
    return { status: 'ready', plan: out };
}
