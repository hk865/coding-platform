/**
 * R3e.1 coverage/applicability pure algorithms (implementation).
 *
 * This is the SINGLE pure effective-evidence fold. It consumes the caller's
 * exact per-evidence `EvidenceBindingV1` list and never recomputes applicability
 * from a Plan or rewrites an evidence anchor. `evidenceApplicabilityWithBasis`
 * is the W1-aware decision reused by the service, using the existing
 * `plan-task-basis` helpers directly.
 *
 * Supersession contract for the first batch: there is NO persisted, versioned
 * supersession rule yet, so EVERY applicable FAIL/INCONCLUSIVE stays in
 * `blockingByRequirement`; a later applicable PASS takes the PASS coverage slot
 * but MUST NOT delete a blocker. A claim remains neutral (neither PASS nor
 * blocker). Exact versioned supersession is a later R3e deliverable and must not
 * be guessed from list order, time or equal coverage.
 */
import type {
    EffectiveEvidenceSet, EvidenceApplicability, EvidenceBindingV1, EvidenceV1,
} from '../../../contracts/evidence.js';
import { requirementKeyOf, type EffectivityAnchorV1 } from '../../../contracts/evidence.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import { revisionAssignments } from '../../../contracts/plan.js';
import {
    buildEffectiveTaskBasis, buildFrozenTaskDefinitions, frozenTaskDefinitionsAgree,
    isBasisUnsupported, type FrozenTaskDefinition,
} from '../tasks/plan-task-basis.js';
import { planRevisionRefKey } from '../tasks/plan-record-codecs.js';

/**
 * Build the binding for ONE evidence decision. The original evidence
 * subject/coverage/anchor are copied UNCHANGED; applicability is the caller's
 * computed decision and is never inferred from the current Plan here.
 */
export function evidenceBindingFor(
    evidence: EvidenceV1,
    applicability: EvidenceApplicability,
): EvidenceBindingV1 {
    return {
        schemaVersion: 1,
        evidenceId: evidence.evidenceId,
        subject: { ...evidence.subject },
        coverage: evidence.coverage.map(entry => ({ ...entry })),
        anchor: evidence.anchor,
        applicability,
    };
}

/** One empty definition, used only when a Plan genuinely does not define the
 * evidence task. It is never a success value and never feeds a PASS. */
function missingDefinition(taskId: string): FrozenTaskDefinition {
    return {
        task: { taskId, title: '', requirementLevel: 'required', taskKind: 'work',
            disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
        assignment: null,
        inputRequirements: [],
        carriedObligations: [],
    };
}

function definitionsFor(plan: PlanRevisionSnapshot): ReadonlyMap<string, FrozenTaskDefinition> {
    return buildFrozenTaskDefinitions({
        tasks: plan.tasks,
        assignments: revisionAssignments(plan),
        inputRequirements: plan.schemaVersion === 2 ? plan.inputRequirements ?? [] : [],
        obligations: plan.obligations,
    });
}

/**
 * PURE effective evidence set. `bindings` MUST be the complete one-to-one
 * binding list for `evidenceList` (same order/length); a missing binding is not
 * treated as APPLICABLE. The fold never re-reads a Plan or anchor. All
 * applicable FAIL/INCONCLUSIVE remain blocking in this batch; claims stay
 * neutral.
 */
export function selectEffectiveEvidenceSet(
    evidenceList: readonly EvidenceV1[],
    bindings: readonly EvidenceBindingV1[],
): EffectiveEvidenceSet {
    const byId = new Map<string, EvidenceBindingV1>();
    for (const binding of bindings) byId.set(binding.evidenceId, binding);
    for (let index = 0; index < evidenceList.length; index += 1) {
        const binding = bindings[index];
        const evidence = evidenceList[index]!;
        if (binding !== undefined && binding.evidenceId === evidence.evidenceId && !byId.has(evidence.evidenceId)) {
            byId.set(evidence.evidenceId, binding);
        }
    }

    const effectiveEvidenceIds: string[] = [];
    const coverageByRequirement: Record<string, string> = {};
    const blockingByRequirement: Record<string, string[]> = {};
    const staleEvidenceIds: string[] = [];
    const outOfScopeEvidenceIds: string[] = [];

    for (const evidence of evidenceList) {
        const binding = byId.get(evidence.evidenceId);
        const applicability = binding?.applicability ?? 'OUT_OF_SCOPE';
        if (applicability === 'STALE') { staleEvidenceIds.push(evidence.evidenceId); continue; }
        if (applicability === 'OUT_OF_SCOPE') { outOfScopeEvidenceIds.push(evidence.evidenceId); continue; }
        const neutralClaim = evidence.kind === 'claim';
        if (evidence.outcome === 'PASS' && !neutralClaim) {
            effectiveEvidenceIds.push(evidence.evidenceId);
            for (const coverage of evidence.coverage) {
                const key = requirementKeyOf(coverage);
                if (coverageByRequirement[key] === undefined) coverageByRequirement[key] = evidence.evidenceId;
            }
            continue;
        }
        if (neutralClaim) continue;
        if (evidence.outcome === 'FAIL' || evidence.outcome === 'INCONCLUSIVE') {
            for (const coverage of evidence.coverage) {
                const key = requirementKeyOf(coverage);
                const list = blockingByRequirement[key];
                if (list === undefined) blockingByRequirement[key] = [evidence.evidenceId];
                else list.push(evidence.evidenceId);
            }
        }
    }
    return { effectiveEvidenceIds, coverageByRequirement, blockingByRequirement, staleEvidenceIds, outOfScopeEvidenceIds };
}

export type CoverageBasis = 'same-plan' | 'same-basis' | 'redefined' | 'unknown';

export type CoverageApplicabilityDecision = {
    applicability: EvidenceApplicability;
    basis: CoverageBasis;
    /** Frozen task definition the evidence contract was produced under. */
    evidenceDefinition: FrozenTaskDefinition;
    /** Frozen task definition of the currently adopted Plan, when readable. */
    currentDefinition: FrozenTaskDefinition | null;
    reason: string;
};

function samePolicyAnchor(left: EffectivityAnchorV1, right: EffectivityAnchorV1): boolean {
    return left.pinnedCompletionPolicy.digest === right.pinnedCompletionPolicy.digest
        && left.pinnedCompletionPolicy.ref.policyId === right.pinnedCompletionPolicy.ref.policyId
        && left.pinnedCompletionPolicy.ref.revision === right.pinnedCompletionPolicy.ref.revision
        && left.pinnedArchitectureBaseline.digest === right.pinnedArchitectureBaseline.digest
        && left.pinnedArchitectureBaseline.ref.baselineId === right.pinnedArchitectureBaseline.ref.baselineId
        && left.pinnedArchitectureBaseline.ref.revision === right.pinnedArchitectureBaseline.ref.revision;
}

/**
 * W1-aware applicability: compares the evidence contract against the currently
 * adopted Plan using the EXISTING `buildEffectiveTaskBasis` /
 * `buildFrozenTaskDefinitions` / `frozenTaskDefinitionsAgree` helpers. An
 * unrelated future Plan edit that keeps the same basis/definition preserves
 * applicability; a real definition change does not. The service then passes the
 * returned applicability to `evidenceBindingFor` and the fold.
 */
export function evidenceApplicabilityWithBasis(input: {
    evidence: EvidenceV1;
    adoptedPlan: PlanRevisionSnapshot;
    evidencePlan: PlanRevisionSnapshot;
    currentAnchor: EffectivityAnchorV1;
}): CoverageApplicabilityDecision {
    const { evidence, adoptedPlan, evidencePlan, currentAnchor } = input;
    const taskId = evidence.subject.taskId;
    const evidenceDefinitions = definitionsFor(evidencePlan);
    const currentDefinitions = definitionsFor(adoptedPlan);
    const evidenceDefinition = evidenceDefinitions.get(taskId) ?? missingDefinition(taskId);
    const currentDefinition = currentDefinitions.get(taskId) ?? null;

    const evidenceBasis = buildEffectiveTaskBasis(evidencePlan).get(taskId);
    const currentBasis = buildEffectiveTaskBasis(adoptedPlan).get(taskId);
    if (evidenceBasis === undefined || isBasisUnsupported(evidenceBasis)
        || currentBasis === undefined || isBasisUnsupported(currentBasis)) {
        return { applicability: 'OUT_OF_SCOPE', basis: 'unknown', evidenceDefinition, currentDefinition,
            reason: 'the task effective basis could not be resolved' };
    }
    const basisRefEqual = planRevisionRefKey(evidenceBasis as PlanRevisionRef) === planRevisionRefKey(currentBasis as PlanRevisionRef);
    if (currentDefinition === null) {
        return { applicability: 'OUT_OF_SCOPE', basis: 'redefined', evidenceDefinition, currentDefinition: null,
            reason: 'the adopted Plan no longer defines the evidence task' };
    }
    const agree = frozenTaskDefinitionsAgree({ left: evidenceDefinition, right: currentDefinition });
    if (isBasisUnsupported(agree)) {
        return { applicability: 'OUT_OF_SCOPE', basis: 'unknown', evidenceDefinition, currentDefinition,
            reason: agree.reason };
    }
    if (!agree) {
        return { applicability: 'OUT_OF_SCOPE', basis: 'redefined', evidenceDefinition, currentDefinition,
            reason: 'the frozen task definition changed between the evidence Plan and the adopted Plan' };
    }
    if (!basisRefEqual) {
        return { applicability: 'OUT_OF_SCOPE', basis: 'redefined', evidenceDefinition, currentDefinition,
            reason: 'the evidence task is no longer carried by the same task-state basis' };
    }
    if (!samePolicyAnchor(evidence.anchor, currentAnchor)) {
        return { applicability: 'STALE', basis: 'same-basis', evidenceDefinition, currentDefinition,
            reason: 'the pinned CompletionPolicy or ArchitectureBaseline moved since the evidence was produced' };
    }
    const samePlan = planRevisionRefKey(adoptedPlan.ref) === planRevisionRefKey(evidencePlan.ref);
    return { applicability: 'APPLICABLE', basis: samePlan ? 'same-plan' : 'same-basis',
        evidenceDefinition, currentDefinition,
        reason: samePlan ? 'the evidence Plan is the adopted Plan' : 'the adopted Plan inherits the same task basis and definition' };
}
