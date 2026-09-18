import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewerFixture } from './reviewer-fixture.js';
import type { EvidenceSnapshot } from '../../src/contracts/evidence.js';
import { buildEvidenceV1, buildSubmitEvidenceCommand } from '../../src/contracts/commands/evidence.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('ordinary GoalGate independently verifies current work', () => {
  it('runs its own tool and independent reviewer, then Control completes the same Goal without a fabricated Gate producer', async () => {
    const s = await reviewerFixture(roots, { goalGate: true });
    expect(s.round.control.taskPhase).not.toBe('satisfied');
    expect(s.round.scope).toEqual(s.scope);
    const materials = await s.service.reviewMaterial(s.scope, 'tools');
    expect(materials.status, JSON.stringify(materials)).toBe('ready');
    if (materials.status !== 'ready') throw Error('no material');
    expect(materials.descriptor.subject.producerAttemptRef.taskId).toBe(s.producerScope.taskId);
    expect(materials.descriptor.subject.scope.taskId).toBe(s.scope.taskId);
    expect(materials.descriptor.tools.map(t => t.checkId)).toEqual(['dynamic']);
    const started = await s.service.startReview(s.scope, s.input);
    expect(started.review.phase, JSON.stringify(started.review.gaps)).toBe('awaiting_result');
    const ref = started.review.work!.ref;
    expect(started.review.work!.producerRunRef.runId).toBe(s.producerScope.runId);
    expect(started.review.work!.reviewerRunRef.runId).not.toBe(s.producerScope.runId);
    const { packet } = await s.begin(ref);
    await s.complete(ref, await s.report(ref, packet));
    const completed = await s.service.resumeReview(s.scope, { requestId: s.input.requestId });
    expect(completed.review.phase, JSON.stringify(completed.review.gaps)).toBe('settled');
    expect(completed.review.formal.taskPhase).toBe('satisfied');
    expect(completed.review.formal.goalPhase).toBe('COMPLETED');
    for (const ref of completed.review.formal.evidenceRefs) {
      const loaded = await s.h.ledger.load(ref);
      expect(loaded.status).toBe('found');
      if (loaded.status === 'found') expect((loaded.snapshot as EvidenceSnapshot).evidence.subject.taskId).toBe(s.scope.taskId);
    }
    expect(await readFile(join(s.root, '.cache/tool-count'), 'utf8')).toBe('x');
    const reopened = await s.reopen();
    expect((await reopened.startReview(s.scope, s.input)).replayed).toBe(true);
    expect(await readFile(join(s.root, '.cache/tool-count'), 'utf8')).toBe('x');
  });

  it('requires explicit Gate scope and rejects borrowing another Task producer for ordinary scope', async () => {
    const s = await reviewerFixture(roots, { goalGate: true });
    const { gateSubject: _, ...ordinary } = s.scope;
    expect((await s.context.resolveRound(ordinary)).status).toBe('rejected');
    expect((await s.context.resolveRound({ ...s.producerScope, gateSubject: 'goal' })).status).toBe('rejected');
    const changed = { ...s.round.configuration!, checks: s.round.configuration!.checks.map(c => { if(c.mode === 'readonly-report') throw Error('fixture expects commands'); return { ...c, command: 'exit 1' }; }) };
    await expect(s.service.startRound(s.scope, { requestId: 'tools', allowExecute: true, configuration: changed })).rejects.toThrow('内容已改变');
  });

  it('keeps missing Reviewer incomplete and refuses stale sources instead of copying producer PASS', async () => {
    const s = await reviewerFixture(roots, { goalGate: true });
    expect(s.round.outcome).toBe('INCONCLUSIVE');
    expect(s.round.aggregate!.admissions.every(a => a.coverage.kind !== 'reviewer')).toBe(true);
    await writeFile(join(s.root, 'source.txt'), 'updated source');
    const stale = await s.service.reviewMaterial(s.scope, 'tools');
    expect(stale.status).toBe('rejected');
    expect((await s.service.round(s.scope, 'tools')).current.status).toBe('stale');
    expect(await readFile(join(s.root, '.cache/tool-count'), 'utf8')).toBe('x');
  });

  it('blocks Gate execution while a workspace outcome requires reconciliation', async () => {
    const s = await reviewerFixture(roots, { goalGate: true });
    s.observations.push({ ...s.observations[0]!, spec: { ...s.observations[0]!.spec, runId: 'unknown-effect' }, status: 'outcome_unknown' });
    const result = await s.service.startRound(s.scope, { requestId: 'after-unknown', allowExecute: true, configuration: s.round.configuration! });
    expect(result.round.status).toBe('rejected');
    expect(result.round.gaps.some(g => g.code === 'run_unsettled')).toBe(true);
    const reopened = await s.reopen();
    expect((await reopened.startRound(s.scope, { requestId: 'after-unknown', allowExecute: true, configuration: s.round.configuration! })).replayed).toBe(true);
    expect(await readFile(join(s.root, '.cache/tool-count'), 'utf8')).toBe('x');
  });

  it('refreshes predecessor reductions when a new FAIL was admitted without a reduction', async () => {
    const s = await reviewerFixture(roots, { goalGate: true });
    const before = await s.h.ledger.load({ aggregateType: 'TaskReduction', projectId: s.scope.projectId, goalId: s.scope.goalId, taskId: s.producerScope.taskId });
    expect(before.status === 'found' && 'phase' in before.snapshot && before.snapshot.phase).toBe('satisfied');
    const evidence = buildEvidenceV1({ ...s.producerScope, evidenceId: 'new-producer-fail', kind: 'observation', outcome: 'FAIL',
      runRef: s.round.materialIdentity!.runRef, checkId: 'new-check', actor: { kind: 'system', id: 'test-verifier' },
      coverage: [{ obligationId: 'producer-tool', requirementId: 'producer-dynamic' }],
      anchor: { schemaVersion: 1, planRef: s.round.materialIdentity!.planRef, planRevision: s.round.materialIdentity!.planRevision,
        workspaceRevision: s.round.materialIdentity!.workspaceRevision, pinnedCompletionPolicy: s.round.materialIdentity!.policyPin,
        pinnedArchitectureBaseline: s.round.materialIdentity!.baselinePin },
      verificationPlanRef: { planId: 'new-producer-check', planDigest: 'a'.repeat(64) }, summaryText: 'A later independent tool failed', artifactRef: s.round.aggregate!.artifactRef });
    const admitted = await s.h.control.submitEvidence(buildSubmitEvidenceCommand({ commandId: 'new-producer-fail', idempotencyKey: 'new-producer-fail', correlationId: 'negative', submittedAt: new Date().toISOString(), actor: { kind: 'system', id: 'test-verifier' }, evidence }));
    expect(admitted.status).toBe('committed');
    const result = await s.service.startRound(s.scope, { requestId: 'after-failure', allowExecute: true, configuration: s.round.configuration! });
    expect(result.round.status).toBe('incomplete');
    expect(result.round.gaps.some(g => g.code === 'prerequisite_unsettled')).toBe(true);
    expect((await s.service.round(s.scope, 'tools')).current.status).toBe('stale');
    expect(await readFile(join(s.root, '.cache/tool-count'), 'utf8')).toBe('x');
  });

  it('reconciles a committed Gate Evidence receipt loss with the same identity and no repeated tool', async () => {
    const s = await reviewerFixture(roots, { goalGate: true });
    const submit = s.deps.control.submitEvidence.bind(s.deps.control);
    let lose = true;
    const commands: string[] = [];
    vi.spyOn(s.deps.control, 'submitEvidence').mockImplementation(async command => {
      commands.push(JSON.stringify(command));
      const result = await submit(command);
      if (lose) { lose = false; throw Error('injected receipt loss after Gate evidence commit'); }
      return result;
    });
    const request = { requestId: 'receipt-loss', allowExecute: true as const, configuration: s.round.configuration! };
    const first = await s.service.startRound(s.scope, request);
    expect(first.round.status).toBe('interrupted');
    expect(first.round.aggregate!.admissions[0]!.status).toBe('pending');
    expect(await readFile(join(s.root, '.cache/tool-count'), 'utf8')).toBe('xx');
    const reopened = await s.reopen();
    expect((await reopened.startRound(s.scope, request)).replayed).toBe(true);
    const resumed = await reopened.resumeRound(s.scope, { requestId: request.requestId, allowExecute: true });
    expect(resumed.round.status, JSON.stringify(resumed.round.gaps)).toBe('completed');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(commands[1]);
    expect(await readFile(join(s.root, '.cache/tool-count'), 'utf8')).toBe('xx');
  });

  it('completes a formally tool-only GoalGate using its own evidence without inventing a Reviewer obligation', async () => {
    const s = await reviewerFixture(roots, { goalGate: true, reviewerKinds: 0 });
    expect(s.round.outcome).toBe('PASS');
    expect(s.round.control.taskPhase).toBe('satisfied');
    expect(s.round.control.goalPhase).toBe('COMPLETED');
    expect(s.service.forRun(s.scope).reviews).toHaveLength(0);
    expect(s.round.aggregate!.admissions.every(a => a.coverage.obligationId === 'independent-review')).toBe(true);
  });
});
