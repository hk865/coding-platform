/**
 * R3e.1 coverage / applicability behaviour tests (stage-1 skeleton).
 *
 * These cases exercise the pure rules the service will call: the frozen
 * VerificationPlan compiler, the binding-driven effective evidence fold (no
 * persisted supersession rule yet) and the W1 taskStateBasis-aware
 * applicability. Evidence observations and their explicit bindings are domain
 * inputs (allowed for WorkGraph rule verification); the Plan/anchor and the W1
 * future-only adoption come from the real R3e fixture. At stage 1 every pure
 * algorithm is an explicit placeholder, so the first call is the honest RED.
 *
 * Specification: docs/refactor/tasks/R3e-completion-skeleton.md §5.2, §8 and the
 * R3e.1 mid-review repair §4.
 */
import { afterEach, expect, it } from 'vitest';
import type { EvidenceApplicability, EvidenceBindingV1, EvidenceV1 } from '../../src/contracts/evidence.js';
import type { PlanRevisionSnapshot, TaskStateBasisV1 } from '../../src/contracts/plan.js';
import { compileVerificationPlan, type VerificationPlanCompileInput } from '../../src/core/work-graph/evidence/verification-plan.js';
import { evidenceApplicabilityWithBasis, selectEffectiveEvidenceSet } from '../../src/core/work-graph/evidence/coverage.js';
import { createR3eEvidenceFixture, R3E_WORK_TASK_ID, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';

const fixtures: R3eEvidenceFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

async function fixture(): Promise<R3eEvidenceFixture> {
  const value = await createR3eEvidenceFixture('memory');
  fixtures.push(value);
  return value;
}

function planWithRequirements(base: PlanRevisionSnapshot, requirementIds: string[]): PlanRevisionSnapshot {
  return { ...base, obligations: base.obligations.map((obligation, index) => index === 0
    ? { ...obligation, verificationRequirements: requirementIds.map(requirementId => ({
        requirementId, requirementLevel: 'required' as const, kind: 'static', description: requirementId,
      })) }
    : obligation) };
}

/** Explicit one-to-one binding, exactly what the service passes to the fold. */
function binding(evidence: EvidenceV1, applicability: EvidenceApplicability): EvidenceBindingV1 {
  return { schemaVersion: 1, evidenceId: evidence.evidenceId, subject: evidence.subject,
    coverage: evidence.coverage.map(entry => ({ ...entry })), anchor: evidence.anchor, applicability };
}

function basisFor(plan: PlanRevisionSnapshot, planRef = plan.ref): TaskStateBasisV1 {
  return { schemaVersion: 1, entries: plan.tasks.map(task => ({ taskId: task.taskId, planRef })) };
}

function asV2(plan: PlanRevisionSnapshot, taskStateBasis: TaskStateBasisV1): PlanRevisionSnapshot {
  return { ...plan, schemaVersion: 2, taskStateBasis };
}

it('two applicable PASSes leave a missing requirement unsatisfied and a claim never counts', async () => {
  const f = await fixture();
  const plan = planWithRequirements(f.plan, ['check-1', 'check-2', 'check-3']);
  const passOne = f.makeEvidence({ evidenceId: 'r3e-e1', outcome: 'PASS', coverage: [{ obligationId: 'r3e-obligation', requirementId: 'check-1' }], plan });
  const passTwo = f.makeEvidence({ evidenceId: 'r3e-e2', outcome: 'PASS', coverage: [{ obligationId: 'r3e-obligation', requirementId: 'check-2' }], plan });
  const neutralClaim = f.makeEvidence({ evidenceId: 'r3e-e3', outcome: 'INCONCLUSIVE', kind: 'claim', coverage: [{ obligationId: 'r3e-obligation', requirementId: 'check-3' }], plan });

  const effective = selectEffectiveEvidenceSet([passOne, passTwo, neutralClaim],
    [binding(passOne, 'APPLICABLE'), binding(passTwo, 'APPLICABLE'), binding(neutralClaim, 'APPLICABLE')]);
  expect(effective.effectiveEvidenceIds.sort()).toEqual(['r3e-e1', 'r3e-e2']);
  expect(effective.blockingByRequirement).toEqual({});
  expect(Object.values(effective.coverageByRequirement)).not.toContain('r3e-e3');
  expect(Object.keys(effective.coverageByRequirement)).not.toContain('r3e-obligation\u0000check-3');
});

it('an applicable PASS never deletes an earlier applicable FAIL from the blockers', async () => {
  const f = await fixture();
  const plan = planWithRequirements(f.plan, ['check-1', 'check-2']);
  const failOne = f.makeEvidence({ evidenceId: 'r3e-fail-1', outcome: 'FAIL', coverage: [{ obligationId: 'r3e-obligation', requirementId: 'check-1' }], plan });
  const passOne = f.makeEvidence({ evidenceId: 'r3e-pass-1', outcome: 'PASS', coverage: [{ obligationId: 'r3e-obligation', requirementId: 'check-1' }], plan });
  const failTwo = f.makeEvidence({ evidenceId: 'r3e-fail-2', outcome: 'FAIL', coverage: [{ obligationId: 'r3e-obligation', requirementId: 'check-2' }], plan });

  const effective = selectEffectiveEvidenceSet([failOne, passOne, failTwo],
    [binding(failOne, 'APPLICABLE'), binding(passOne, 'APPLICABLE'), binding(failTwo, 'APPLICABLE')]);
  expect(effective.coverageByRequirement['r3e-obligation\u0000check-1']).toBe('r3e-pass-1');
  expect(effective.blockingByRequirement['r3e-obligation\u0000check-1']).toEqual(['r3e-fail-1']);
  expect(effective.blockingByRequirement['r3e-obligation\u0000check-2']).toEqual(['r3e-fail-2']);
});

it('an empty required-obligation set is rejected by the compiler and a no-target binding is not APPLICABLE', async () => {
  const f = await fixture();
  const emptyPlan = planWithRequirements(f.plan, []);
  const orphan = f.makeEvidence({ evidenceId: 'r3e-orphan', outcome: 'PASS', coverage: [{ obligationId: 'r3e-obligation', requirementId: 'check-1' }], plan: emptyPlan });

  // The fold only consumes the supplied decision; it does not invent APPLICABLE.
  const effective = selectEffectiveEvidenceSet([orphan], [binding(orphan, 'OUT_OF_SCOPE')]);
  expect(effective.effectiveEvidenceIds).toEqual([]);
  expect(effective.coverageByRequirement).toEqual({});

  const input: VerificationPlanCompileInput = {
    schemaVersion: 1, taskRef: f.subject, planRef: emptyPlan.ref, planSnapshot: emptyPlan,
    workspaceRevision: 1,
    changeScope: { diffClass: 'code-change', changedFiles: [], writeSummary: 'R3e coverage empty-obligation case' },
    semanticChange: 'semantic', risks: [],
    checkCapabilities: [{ checkId: f.passCheck.checkId, kind: 'static', coversKinds: ['static'], replayable: false }],
    policy: { requirementKinds: ['static'] },
  };
  expect(compileVerificationPlan(input)).toMatchObject({ status: 'rejected', code: 'invalid' });
});

it('an unrelated future adoption keeps applicability along taskStateBasis (anchor unchanged) while a definition change does not', async () => {
  const f = await fixture();
  const evidencePlan = f.plan;
  expect(evidencePlan.schemaVersion).toBe(2);
  const adoptedPlan = await f.adoptUnrelatedFutureEdit('r3e-plan-future', 'r3e-future');
  expect(adoptedPlan.ref.planId).toBe('r3e-plan-future');
  expect(adoptedPlan.ref).not.toEqual(evidencePlan.ref);
  expect(adoptedPlan.tasks.some(task => task.taskId === 'r3e-future-intent')).toBe(true);

  const evidence = f.makeEvidence({
    evidenceId: 'r3e-basis-pass', outcome: 'PASS',
    coverage: [{ obligationId: 'r3e-obligation', requirementId: 'r3e-static-requirement' }], plan: evidencePlan,
  });
  const decision = evidenceApplicabilityWithBasis({
    evidence, adoptedPlan, evidencePlan, currentAnchor: f.anchorFor(adoptedPlan),
  });
  expect(decision).toMatchObject({ applicability: 'APPLICABLE', basis: 'same-basis' });

  const bindingForDecision = binding(evidence, decision.applicability);
  expect(bindingForDecision.anchor, 'the binding keeps the ORIGINAL evidence anchor').toEqual(evidence.anchor);
  expect(bindingForDecision.anchor.planRef).toEqual(evidencePlan.ref);
  const effective = selectEffectiveEvidenceSet([evidence], [bindingForDecision]);
  expect(effective.effectiveEvidenceIds).toEqual(['r3e-basis-pass']);

  // Pure counterexample: same basis pointer but a really changed frozen task
  // definition. This does NOT claim W1 allows rewriting an executed task.
  const redefined = asV2({ ...evidencePlan,
    tasks: evidencePlan.tasks.map(task => task.taskId === R3E_WORK_TASK_ID
      ? { ...task, title: 'The definition actually changed' } : task) }, basisFor(evidencePlan));
  const changed = evidenceApplicabilityWithBasis({
    evidence, adoptedPlan: redefined, evidencePlan, currentAnchor: f.anchorFor(redefined),
  });
  expect(changed).toMatchObject({ applicability: 'OUT_OF_SCOPE', basis: 'redefined' });
});
