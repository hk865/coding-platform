import assert from 'node:assert/strict';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReviewerPacketV1 } from '../../src/contracts/reviewer-context.js';

type Scope = { projectId: string; workspaceId: string; goalId: string };
type Run = { spec: { runId: string; taskId: string }; status: string };
type ModelStep = { call?: { name: string; arguments: Record<string, unknown> }; answer?: unknown };

/** Scenario assertion; expected recipients come from the observed formal targets. */
export function assertDecisionReport(reports: any[], producerRunId: string, decisionRecipientRunIds: readonly string[]) {
  const expected = decisionRecipientRunIds.includes(producerRunId);
  const originals = reports.filter(report => report.readonlyReport).map(report => report.readonlyReport);
  if (expected) assert(originals.length > 0, 'An actual decision recipient must have its original readonly report');
  for (const report of originals) {
    if (expected || report.collaborationFacts !== undefined) {
      assert(report.collaborationFacts?.kind === 'producer-collaboration-facts', 'Current report verification must retain canonical decision and Work identity evidence');
      assert.equal(report.collaborationFacts.producerRunRef?.runId, producerRunId);
    }
  }
}

function objects(value: unknown): any[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (value && typeof value === 'object') return [value, ...Object.values(value).flatMap(objects)];
  if (typeof value !== 'string') return [];
  try { return objects(JSON.parse(value)); } catch {
    return value.split('\n\n').flatMap(part => { try { return objects(JSON.parse(part)); } catch { return []; } });
  }
}

/** Protocol fixture, not a real model quality verdict. Reads the actual source
 * and every packet material through the Reviewer tools before producing JSON. */
export function deterministicReview(request: ModelRequest): ModelStep {
  const delivered = objects(request.messages);
  const packet = delivered.find(value => value.kind === 'independent-review-packet') as ReviewerPacketV1 | undefined;
  assert(packet, 'Reviewer must receive its own independent packet');
  const binding = delivered.find(value => value.reviewId === packet.workRef.reviewId && value.packetDigest);
  assert(binding, 'Reviewer packet binding is required');
  const returned = objects(request.messages.filter(message => message.role === 'tool'));
  const source = returned.find(value => value.materialId === 'source:src/utils/grouping.mjs' && value.truncated === false);
  if (!source) return { call: { name: 'read_source', arguments: { path: 'src/utils/grouping.mjs', startLine: 1, maxLines: 150 } } };
  const missing = packet.materials.find(material => !returned.some(value => value.ref?.digest === material.ref.digest && value.complete === true));
  if (missing) return { call: { name: 'read_material', arguments: {
    materialId: missing.materialId,
    offset: Math.max(0, ...returned.filter(value => value.ref?.digest === missing.ref.digest).map(value => Number(value.nextOffset) || 0)), maxBytes: 32768,
  } } };
  assert.match(source.content.replace(/\/\/[^\n]*/g, ''), /if\s*\(!t\.due\)\s*\{\s*out\.today\.push\(t\)\s*continue/, 'No-deadline behavior must actually be repaired');
  const report = packet.materials.find(material => material.kind === 'tool-report');
  assert(report, 'An independently produced check report is mandatory');
  for (const value of returned.filter(value => value.readonlyReport?.collaborationFacts !== undefined)) {
    const facts = value.readonlyReport.collaborationFacts;
    assert(facts?.kind === 'producer-collaboration-facts', 'Reviewer must actually read canonical decision corroboration, not only the producer claim');
    assert(facts.decisions.some((decision: any) => value.readonlyReport.report.includes(decision.review.proposalDigest)));
    assert(facts.decisions.some((decision: any) => ['reader-a', 'reader-b'].every(taskId => decision.works.some((work: any) => work.taskId === taskId))));
  }
  assert(packet.coverage.length > 0);
  const firstLine = source.content.split(/\r?\n/).findIndex((line: string) => /if\s*\(!t\.due\)/.test(line)) + 1;
  assert(firstLine > 0);
  return { answer: {
    schemaVersion: 1, kind: 'independent-review-result', reviewId: packet.workRef.reviewId,
    descriptorDigest: packet.descriptorDigest, packetDigest: binding.packetDigest, sourceDigest: packet.materialIdentity.sourceDigest,
    citations: [
      { citationId: 'source', materialId: source.materialId, digest: source.sourceDigest, location: { kind: 'source-lines', path: 'src/utils/grouping.mjs', startLine: firstLine, endLine: firstLine + 2 } },
      { citationId: 'checks', materialId: report.materialId, digest: report.ref.digest, location: { kind: 'artifact-section', pointer: '/result' } },
    ],
    requirements: packet.coverage.map(({ obligationId, requirementId }) => ({ obligationId, requirementId, result: 'PASS',
      rationale: 'Deterministic protocol witness: read the current no-deadline branch and all original round materials. The scoped check report records either command assertions or readonly report and source-read facts. This is not a real model-quality judgment.',
      citationIds: ['source', 'checks'], issueIds: [], unknowns: [],
    })), issues: [],
  } };
}

type VerificationHost = {
  post: (path: string, body: any) => Promise<any>;
  state: () => Promise<any>;
  scope: Scope;
  evidence: Record<string, any>;
  /** Test observation deadline only; never becomes a runtime/model budget. */
  reviewTimeoutMs?: number;
  decisionRecipientRunIds?: readonly string[];
};

/** Qualify an upstream producer before dependent investigation is admitted. */
export async function verifyCodingProducer(input: VerificationHost & { taskId: string; run: Run }) {
  return verifySubject(input, false);
}

async function verifySubject(input: VerificationHost & { taskId: string; run: Run }, gate: boolean) {
    const { post, state, scope, evidence, taskId, run } = input;
    assert.equal(run.status, 'completed', `${taskId}: execution must finish before verification`);
    const target = { ...scope, taskId, runId: run.spec.runId, ...(gate ? { gateSubject: 'goal' } : {}) };
    const requestId = `cc-check-${taskId}`, reviewRequestId = `${requestId}-review`;
    const record: Record<string, any> = evidence[taskId] = { target };
    const appliesTo = { workspaceId: scope.workspaceId, taskIds: [taskId] };
    const check = !gate && ['reader-a', 'reader-b', 'coordinator'].includes(taskId)
      ? { checkId: requestId, mode: 'readonly-report', kind: 'static', appliesTo, requiredReadPaths: ['RULES.md', 'src/utils/grouping.mjs'] }
      : { checkId: requestId, kind: 'dynamic', command: './.cache/node --test check.mjs', cwd: '.', timeoutMs: 10000, appliesTo };
    const round = record['round'] = await post('/api/real/verifications/rounds/start', { ...target, requestId, allowExecute: true,
      configuration: { checks: [check] },
    });
    assert.equal(round.round?.status, 'completed', `Check processing must finish before Reviewer: ${JSON.stringify(round)}`);
    assert.equal(round.round?.outcome, 'INCONCLUSIVE', JSON.stringify(round));
    record['report'] = await post('/api/real/verifications/check-report', { ...scope, runId: run.spec.runId, requestId: round.round.checks[0].requestId });
    assertDecisionReport(record['report'].reports ?? [], run.spec.runId, input.decisionRecipientRunIds ?? []);
    const profile = await post('/api/real/verifications/reviews/profile', target);
    assert.equal(profile.status, 'ready', JSON.stringify(profile));
    record['started'] = await post('/api/real/verifications/reviews/start', { ...target, requestId: reviewRequestId,
      roundRequestId: requestId, reviewerConfigRef: profile.ref, allowExecute: true });
    const deadline = Date.now() + (input.reviewTimeoutMs ?? 180000);
    let review: any;
    for (;;) {
      review = record['review'] = await post('/api/real/verifications/reviews/read', { ...target, requestId: reviewRequestId });
      const current = evidence['latestState'] = await state();
      const reviewer = current.liveRuns.find((row: any) => row.spec.runId === review.work?.reviewerRunRef.runId);
      if (['settled', 'assessment_rejected', 'work_rejected'].includes(review.phase) || ['failed', 'outcome_unknown', 'budget_exhausted', 'cancelled'].includes(reviewer?.status)) break;
      assert(Date.now() < deadline, `Reviewer did not settle: ${JSON.stringify(review)}`);
      // Production UI refreshes state every 2.5s. The old 40ms full-state poll
      // competed with complete source hashing and made 6.9s parallel material
      // reads take 15.3s on real17's fixed dataset. This is observation only;
      // the scenario's actual overlap, wake and crash boundaries use barriers.
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    assert.equal(review.phase, 'settled', JSON.stringify(review));
    assert.equal(review.formal.taskPhase, 'satisfied', JSON.stringify(review));
    if (gate) assert.equal(review.formal.goalPhase, 'COMPLETED');
    else assert.notEqual(review.formal.goalPhase, 'COMPLETED', 'Work evidence must not satisfy the independent GoalGate');
    assert(review.formal.evidenceRefs.length > 0);
    const replay = await post('/api/real/verifications/reviews/resume', { ...target, requestId: reviewRequestId });
    assert.deepEqual(replay.review.formal, review.formal);
    return record;
}

/** One Goal throughout. Every required producer gets its own round and Review;
 * the final Gate consumes its own evidence after the prerequisites are accepted. */
export async function verifyCodingLineage(input: VerificationHost & { runByTask: Record<string, Run>; decisionRecipientRunIds: readonly string[] }): Promise<void> {
  const { state, runByTask, evidence } = input;
  const required = ['reader-a', 'reader-b', 'coordinator', 'coding'];
  assert.deepEqual(Object.keys(runByTask).sort(), [...required].sort(), 'Do not omit a required work producer');
  const initial = await state();
  assert.equal(initial.matrix.status, 'ready');
  assert.notEqual(initial.matrix.matrix.rows.find((row: any) => row.taskId === 'goal-gate')?.livePhase, 'satisfied');
  const allEvidence = new Set<string>();
  for (const taskId of [...required, 'goal-gate']) {
    const gate = taskId === 'goal-gate';
    const record = await verifySubject({ ...input, taskId, run: runByTask[gate ? 'coding' : taskId]! }, gate);
    for (const ref of record['review'].formal.evidenceRefs) {
      const identity = JSON.stringify(ref);
      assert(!allEvidence.has(identity), 'Each subject must own new evidence, never borrow another task result');
      allEvidence.add(identity);
    }
  }
  evidence['final'] = await state();
  for (const taskId of [...required, 'goal-gate']) assert.equal(evidence['final'].matrix.matrix.rows.find((row: any) => row.taskId === taskId)?.livePhase, 'satisfied', taskId);
}
