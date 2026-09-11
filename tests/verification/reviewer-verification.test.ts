import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { EvidenceSnapshot } from '../../src/contracts/evidence.js';
import type { ReviewerSemanticReportV1 } from '../../src/contracts/reviewer-verification.js';
import { buildEvidenceV1, buildReduceTaskCommand, buildSubmitEvidenceCommand } from '../../src/contracts/commands/evidence.js';
import { verificationAnchor } from '../../src/control/verification-engine/evidence-admission.js';
import { reviewerFixture, scope } from './reviewer-fixture.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('independent Reviewer Verification lifecycle', () => {
  it('creates one canonical independent Work, admits precise per-VR outcomes and replays after reopen without rerunning tools', async () => {
    const s = await reviewerFixture(roots);
    const material = await s.service.reviewMaterial(scope, 'tools');
    expect(material.status, JSON.stringify(material)).toBe('ready');
    if (material.status !== 'ready') throw Error('material unavailable');
    expect(material.descriptor.requiredReviewerCoverage).toHaveLength(2);
    expect(material.descriptor.tools).toHaveLength(1);
    const create = vi.spyOn(s.control.lifecycle, 'createWork');
    const first = await s.service.startReview(scope, s.input);
    expect(first.review.phase, JSON.stringify(first.review.gaps)).toBe('awaiting_result');
    expect(first.review.work?.reviewerRunRef.runId).not.toBe(scope.runId);
    expect(first.review.profile!.budget.maxRequests).toBeNull();
    const ref = first.review.work!.ref, { packet } = await s.begin(ref);
    const raw = await s.report(ref, packet, ['FAIL', 'PASS']);
    const rawRef = await s.complete(ref, raw);
    const result = await s.service.resumeReview(scope, { requestId: s.input.requestId });
    expect(result.review.phase, JSON.stringify(result.review.gaps)).toBe('settled');
    expect(result.review.assessment!.body.decision).toMatchObject({ status: 'accepted', requirements: [{ outcome: 'FAIL' }, { outcome: 'PASS' }] });
    expect(result.review.formal.taskPhase).toBe('failed');
    expect(result.review.formal.evidenceRefs).toHaveLength(2);
    for (const evidenceRef of result.review.formal.evidenceRefs) {
      const loaded = await s.h.ledger.load(evidenceRef); expect(loaded.status).toBe('found');
      if (loaded.status !== 'found') throw Error('Evidence missing');
      const evidence = (loaded.snapshot as EvidenceSnapshot).evidence;
      expect(evidence.coverage).toHaveLength(1);
      expect(evidence.summary.artifactRef).toEqual(rawRef);
      expect(evidence.outcome).toBe(evidence.coverage[0]!.requirementId === 'review-0' ? 'FAIL' : 'PASS');
    }
    const reopened = await s.reopen();
    expect((await reopened.startReview(scope, s.input)).replayed).toBe(true);
    expect((await reopened.resumeReview(scope, { requestId: s.input.requestId })).replayed).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await readFile(join(s.root, '.cache/tool-count'), 'utf8')).toBe('x');
    expect(reopened.forRun(scope).reviews).toHaveLength(1);
    expect(await reopened.reviewReceipt(scope, s.input.requestId)).toMatchObject({ workRef: ref, phase: 'settled', scope });
    await expect(reopened.startReview(scope, { ...s.input, roundRequestId: 'different' })).rejects.toThrow('内容已改变');
    await expect(reopened.startReview({ ...scope, runId: 'different' }, s.input)).rejects.toThrow('其他 Run 或 Task');
    const second = await reopened.startReview(scope, { ...s.input, requestId: 'redraw' });
    expect(second.review.phase).toBe('work_rejected');
    expect(second.review.formal.evidenceRefs).toEqual([]);
  });

  it('rejects an applicable extra tool FAIL with no VR coverage before Work creation', async () => {
    const s = await reviewerFixture(roots, { extraToolFailure: true });
    expect(s.round.outcome).toBe('FAIL');
    const create = vi.spyOn(s.control.lifecycle, 'createWork');
    expect(await s.service.reviewMaterial(scope, 'tools')).toMatchObject({ status: 'rejected', code: 'tool_material_unqualified' });
    const result = await s.service.startReview(scope, s.input);
    expect(result.review.phase).toBe('work_rejected');
    expect(create).not.toHaveBeenCalled();
    expect((await s.service.round(scope, 'tools')).outcome).toBe('FAIL');
  });

  it.each([
    ['unknown schema', (report: ReviewerSemanticReportV1) => ({ ...report, schemaVersion: 2 })],
    ['duplicate VR', (report: ReviewerSemanticReportV1) => ({ ...report, requirements: [report.requirements[0], report.requirements[0]] })],
    ['missing VR', (report: ReviewerSemanticReportV1) => ({ ...report, requirements: [report.requirements[0]] })],
    ['invented source digest', (report: ReviewerSemanticReportV1) => ({ ...report, citations: report.citations.map((c, i) => i === 0 ? { ...c, digest: 'a'.repeat(64) } : c) })],
    ['missing source lines', (report: ReviewerSemanticReportV1) => ({ ...report, citations: report.citations.map((c, i) => i === 0 ? { ...c, location: { kind: 'source-lines', path: 'source.txt', startLine: 100, endLine: 100 } } : c) })],
    ['pin excluded path', (report: ReviewerSemanticReportV1) => ({ ...report, citations: report.citations.map((c, i) => i === 0 ? { ...c, materialId: 'source:.cache/tool-count', location: { kind: 'source-lines', path: '.cache/tool-count', startLine: 1, endLine: 1 } } : c) })],
    ['missing artifact pointer', (report: ReviewerSemanticReportV1) => ({ ...report, citations: report.citations.map((c, i) => i === 1 ? { ...c, location: { kind: 'artifact-section', pointer: '/reports/999/result' } } : c) })],
    ['PASS with unresolved unknown', (report: ReviewerSemanticReportV1) => ({ ...report, requirements: report.requirements.map((r, i) => i === 0 ? { ...r, unknowns: ['unresolved behavior'] } : r) })],
  ] as const)('permanently rejects %s and preserves the original raw report across reopen', async (_name, alter) => {
    const s = await reviewerFixture(roots);
    const first = await s.service.startReview(scope, s.input), ref = first.review.work!.ref;
    const { packet } = await s.begin(ref), raw = alter(await s.report(ref, packet));
    const rawRef = await s.complete(ref, raw);
    const result = await s.service.resumeReview(scope, { requestId: s.input.requestId });
    expect(result.review.phase, JSON.stringify(result.review.gaps)).toBe('assessment_rejected');
    expect(result.review.assessment!.body.decision.status).toBe('rejected');
    expect(result.review.formal.evidenceRefs).toEqual([]);
    expect(result.review.formal.resultRef).not.toBeNull();
    const opened = await s.reviewContext.openReport(ref);
    expect(opened.status).toBe('ready');
    if (opened.status === 'ready') expect(opened.record.body).toBe(canonicalJson(raw as never));
    const admit = vi.spyOn(s.control.lifecycle, 'recordValidatedResult');
    const replay = await (await s.reopen()).resumeReview(scope, { requestId: s.input.requestId });
    expect(replay.replayed).toBe(true); expect(replay.review.rawReportRef).toEqual(rawRef);
    expect(admit).not.toHaveBeenCalled();
  });

  it('recovers a lost creation receipt from canonical Work without creating another Run', async () => {
    const s = await reviewerFixture(roots), create = s.control.lifecycle.createWork;
    const calls: string[] = [];
    vi.spyOn(s.control.lifecycle, 'createWork').mockImplementation(async command => {
      calls.push(canonicalJson(command)); await create(command); throw Error('lost after Work commit');
    });
    const first = await s.service.startReview(scope, s.input);
    expect(first.review.work).not.toBeNull();
    expect(first.review.phase).toBe('awaiting_result');
    const replay = await (await s.reopen()).resumeReview(scope, { requestId: s.input.requestId });
    expect(replay.review.work!.ref).toEqual(first.review.work!.ref);
    expect(calls).toHaveLength(1);
    expect(replay.review.phase).toBe('awaiting_result');
  });

  it('recovers a lost result receipt using its persisted command and canonical Result without re-admission', async () => {
    const s = await reviewerFixture(roots), first = await s.service.startReview(scope, s.input), ref = first.review.work!.ref;
    const { packet } = await s.begin(ref); await s.complete(ref, await s.report(ref, packet));
    const admit = s.control.lifecycle.recordValidatedResult, calls: string[] = [];
    vi.spyOn(s.control.lifecycle, 'recordValidatedResult').mockImplementation(async command => {
      calls.push(canonicalJson(command)); const receipt = await admit(command);
      expect(receipt.status, JSON.stringify(receipt)).toBe('accepted'); throw Error('lost after Result commit');
    });
    const initial = await s.service.resumeReview(scope, { requestId: s.input.requestId });
    expect(initial.review.formal.resultRef).not.toBeNull();
    const resumed = await (await s.reopen()).resumeReview(scope, { requestId: s.input.requestId });
    expect(resumed.review.phase, JSON.stringify(resumed.review.gaps)).toBe('settled');
    expect(resumed.review.formal.taskPhase).toBe('satisfied');
    expect(calls).toHaveLength(1);
    const filename = (await readdir(s.directory)).find(n => n.startsWith('review-'))!;
    const saved = JSON.parse(await readFile(join(s.directory, filename), 'utf8'));
    expect(canonicalJson(saved.resultCommand)).toBe(calls[0]);
    expect(await readFile(join(s.root, '.cache/tool-count'), 'utf8')).toBe('x');
  });

  it('leaves a temporary raw report outage pending, then reads the same binding without a new model session', async () => {
    const s = await reviewerFixture(roots), first = await s.service.startReview(scope, s.input), ref = first.review.work!.ref;
    const { packet } = await s.begin(ref); const rawRef = await s.complete(ref, await s.report(ref, packet, ['INCONCLUSIVE', 'PASS']));
    const unavailable = vi.spyOn(s.reviewContext, 'openReport').mockResolvedValueOnce({ status: 'unavailable', ref: rawRef });
    const pending = await s.service.resumeReview(scope, { requestId: s.input.requestId });
    expect(pending.review.phase).toBe('report_recorded'); expect(pending.review.assessment).toBeNull();
    expect(pending.review.formal.evidenceRefs).toEqual([]);
    unavailable.mockRestore();
    const resumed = await (await s.reopen()).resumeReview(scope, { requestId: s.input.requestId });
    expect(resumed.review.phase, JSON.stringify(resumed.review.gaps)).toBe('settled');
    expect(resumed.review.assessment!.body.decision).toMatchObject({ status: 'accepted', requirements: [{ outcome: 'INCONCLUSIVE' }, { outcome: 'PASS' }] });
    expect(resumed.review.formal.taskPhase).not.toBe('satisfied');
    expect(s.observations).toHaveLength(2);
  });

  it('refuses actual source/configuration changes without reviving the old request', async () => {
    const s = await reviewerFixture(roots), first = await s.service.startReview(scope, s.input), ref = first.review.work!.ref;
    const { packet } = await s.begin(ref); await s.complete(ref, await s.report(ref, packet));
    await writeFile(join(s.root, 'source.txt'), 'changed source\n');
    const stale = await s.service.resumeReview(scope, { requestId: s.input.requestId });
    expect(stale.review.current.status).toBe('stale'); expect(stale.review.formal.evidenceRefs).toEqual([]);
    await writeFile(join(s.root, 'source.txt'), 'first source line\nsecond source line\n');
    const restored = await (await s.reopen()).resumeReview(scope, { requestId: s.input.requestId });
    expect(restored.replayed).toBe(true); expect(restored.review.phase).toBe('work_rejected');
    expect(restored.review.formal.evidenceRefs).toEqual([]);

    const configured = await reviewerFixture(roots), started = await configured.service.startReview(scope, configured.input);
    configured.changeModel();
    const view = await configured.service.review(scope, configured.input.requestId);
    expect(view.current.status).toBe('stale'); expect(view.work!.ref).toEqual(started.review.work!.ref);
    expect((await configured.service.startReview(scope, configured.input)).replayed).toBe(true);
  });

  it('refuses a real revoked cross-subject grant even while the projection still contains its old candidate', async () => {
    const s = await reviewerFixture(roots), started = await s.service.startReview(scope, s.input), ref = started.review.work!.ref;
    const { packet, grantRef } = await s.begin(ref); await s.complete(ref, await s.report(ref, packet));
    const original = await s.reviewContext.readMaterial(ref, { ref: packet.materials[0]!.ref, offset: 0, maxBytes: 100 });
    expect(original.content.length).toBeGreaterThan(0);
    // Submit directly to Control so the read model deliberately lags revocation.
    const revoked = await s.h.control.revokeMaterialAccess({ commandId: 'revoke-review', commandType: 'RevokeMaterialAccess', schemaVersion: 1,
      identity: { projectId: scope.projectId, actor: { kind: 'human', id: 'owner' }, idempotencyKey: 'revoke-review' },
      aggregateId: grantRef.grantId, expectedRevision: 1, correlationId: s.input.requestId, submittedAt: '2026-09-09T12:00:00.000Z',
      payload: { grantRef, reason: 'Revoke Reviewer access to original tool materials' } });
    expect(revoked.status, JSON.stringify(revoked)).toBe('committed');
    await expect(s.reviewContext.readMaterial(ref, { ref: packet.materials[0]!.ref, offset: 0, maxBytes: 100 })).rejects.toThrow();
    const result = await s.service.resumeReview(scope, { requestId: s.input.requestId });
    expect(result.review.assessment).toBeNull(); expect(result.review.formal.evidenceRefs).toEqual([]);
    expect(result.review.current.status).not.toBe('current');
    const reopened = await s.reopen();
    expect((await reopened.resumeReview(scope, { requestId: s.input.requestId })).review.formal.evidenceRefs).toEqual([]);
  });

  it.each(['task', 'goal'] as const)('recovers a genuine concurrent %s reduction CAS by keeping the rejected attempt and using a new key', async target => {
    const s = await reviewerFixture(roots), started = await s.service.startReview(scope, s.input), ref = started.review.work!.ref;
    const { packet } = await s.begin(ref); await s.complete(ref, await s.report(ref, packet));
    let first = true;
    if (target === 'task') {
      const reduce = s.deps.control.reduceTask.bind(s.deps.control);
      vi.spyOn(s.deps.control, 'reduceTask').mockImplementation(async command => {
        if (first) {
          first = false;
          expect((await reduce({ ...command, commandId: 'concurrent-task', identity: { ...command.identity, idempotencyKey: 'concurrent-task' } })).status).toBe('committed');
        }
        return reduce(command);
      });
    } else {
      const reduce = s.deps.control.reduceGoal.bind(s.deps.control);
      vi.spyOn(s.deps.control, 'reduceGoal').mockImplementation(async command => {
        if (first) {
          first = false;
          expect((await reduce({ ...command, commandId: 'concurrent-goal', identity: { ...command.identity, idempotencyKey: 'concurrent-goal' } })).status).toBe('committed');
        }
        return reduce(command);
      });
    }
    const initial = await s.service.resumeReview(scope, { requestId: s.input.requestId });
    expect(initial.review.phase).toBe('reduction_pending'); expect(initial.review.formal.evidenceRefs.length).toBeGreaterThan(0);
    const admit = vi.spyOn(s.control.lifecycle, 'recordValidatedResult');
    const resumed = await (await s.reopen()).resumeReview(scope, { requestId: s.input.requestId });
    expect(resumed.review.phase, JSON.stringify(resumed.review.gaps)).toBe('settled');
    expect(admit).not.toHaveBeenCalled();
    const filename = (await readdir(s.directory)).find(n => n.startsWith('review-'))!;
    const record = JSON.parse(await readFile(join(s.directory, filename), 'utf8'));
    expect(record.reduction.rejected).toMatchObject([{ target, code: 'revision_conflict' }]);
    expect(record.reduction[target].revision).toBe(record.reduction.rejected[0].revision + 1);
    expect(record.reduction[target].key).not.toBe(record.reduction.rejected[0].key);
    expect(await readFile(join(s.root, '.cache/tool-count'), 'utf8')).toBe('x');
  });

  it('does not accept a completed report whose persisted Reviewer session reused the Producer', async () => {
    const s = await reviewerFixture(roots), started = await s.service.startReview(scope, s.input), ref = started.review.work!.ref;
    const { packet } = await s.begin(ref); await s.complete(ref, await s.report(ref, packet));
    s.observations[1]!.sessionId = s.observations[0]!.sessionId ?? null;
    const result = await s.service.resumeReview(scope, { requestId: s.input.requestId });
    expect(result.review.phase).toBe('work_rejected'); expect(result.review.gaps).toMatchObject([{ code: 'session_not_independent' }]);
    expect(result.review.formal.evidenceRefs).toEqual([]);
    s.observations[1]!.sessionId = 'reviewer-session';
    const reopened = await s.reopen();
    expect((await reopened.resumeReview(scope, { requestId: s.input.requestId })).replayed).toBe(true);
  });

  it('keeps missing tool material retryable before creation and freezes the same explicit request', async () => {
    const s = await reviewerFixture(roots);
    const blocked = vi.spyOn(s.context, 'openReport').mockImplementation(async ref => ({ status: 'unavailable', ref }));
    const result = await s.service.startReview(scope, s.input);
    expect(result.review.phase).toBe('material_pending'); expect(result.review.work).toBeNull();
    expect(result.review.gaps).toMatchObject([{ code: 'tool_report_unavailable' }]);
    blocked.mockRestore();
    const resumed = await (await s.reopen()).resumeReview(scope, { requestId: s.input.requestId });
    expect(resumed.review.phase, JSON.stringify(resumed.review.gaps)).toBe('awaiting_result');
    expect(resumed.review.work!.requestId).toBe(s.input.requestId);
  });

  it('waits for an existing unknown reviewer execution and ignores caller-provided report fields', async () => {
    const s = await reviewerFixture(roots), started = await s.service.startReview(scope, s.input), ref = started.review.work!.ref;
    await s.begin(ref); s.observations[1]!.status = 'outcome_unknown';
    const admit = vi.spyOn(s.control.lifecycle, 'recordValidatedResult'), create = vi.spyOn(s.control.lifecycle, 'createWork');
    const forged = { requestId: s.input.requestId, report: { result: 'PASS' }, reportRef: s.round.aggregate!.artifactRef };
    const result = await (await s.reopen()).resumeReview(scope, forged);
    expect(result.review.phase).toBe('awaiting_result'); expect(result.review.rawReportRef).toBeNull();
    expect(admit).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    expect(s.observations).toHaveLength(2);
  });

  it('recomputes legacy satisfied state after adopting the independent protocol without changing original Evidence', async () => {
    const s = await reviewerFixture(roots), material = await s.context.resolveRound(scope);
    if (material.status !== 'ready') throw Error('material unavailable');
    const actor = { kind: 'system' as const, id: 'legacy-reviewer' };
    const evidence = buildEvidenceV1({ ...scope, evidenceId: 'legacy-review-pass', kind: 'verdict', outcome: 'PASS', actor,
      runRef: material.material.run.ref, checkId: 'legacy-review', summaryText: 'Pre-protocol limited legacy reviewer evidence',
      artifactRef: s.round.aggregate!.artifactRef, anchor: verificationAnchor(material.material),
      verificationPlanRef: { planId: s.round.plan!.planId, planDigest: s.round.plan!.planDigest },
      coverage: s.round.coverage.filter(c => c.kind === 'reviewer').map(({ obligationId, requirementId }) => ({ obligationId, requirementId })) });
    expect((await s.h.control.submitEvidence(buildSubmitEvidenceCommand({ commandId: evidence.evidenceId, idempotencyKey: evidence.evidenceId,
      correlationId: 'legacy', submittedAt: '2026-09-09T00:00:00.000Z', actor, evidence }))).status).toBe('committed');
    const before = await s.h.control.reduceTask(buildReduceTaskCommand({ ...scope, actor, commandId: 'legacy-reduce', idempotencyKey: 'legacy-reduce',
      correlationId: 'legacy', submittedAt: '2026-09-09T00:00:00.000Z', expectedRevision: await s.context.taskReductionRevision(scope) }));
    expect(before).toMatchObject({ status: 'committed', phase: 'satisfied' });
    const started = await s.service.startReview(scope, s.input);
    expect(started.review.phase, JSON.stringify(started.review.gaps)).toBe('awaiting_result');
    expect(started.review.formal.taskPhase).not.toBe('satisfied');
    const original = await s.h.ledger.load({ aggregateType: 'Evidence', projectId: scope.projectId, evidenceId: evidence.evidenceId });
    expect(original.status).toBe('found');
    if (original.status === 'found') expect((original.snapshot as EvidenceSnapshot).evidence).toEqual(evidence);
    const file = (await readdir(s.directory)).find(n => n.startsWith('review-'))!;
    const saved = JSON.parse(await readFile(join(s.directory, file), 'utf8'));
    expect(saved.adoptionReduction.task.phase).not.toBe('satisfied');
    expect(saved.reduction.task).toBeNull();
  });
});
