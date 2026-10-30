/**
 * A.2 step 5.3: the evidence owner, the registered-check runner, the task
 * projection, the completion and the Workflow over the real R3e fixture (real
 * RecordStore, real `EvidencePort`, real verification workspace and frozen
 * Kernel sandbox), on the memory and the SQLite backend.
 *
 * - VR-01 slot (VD-1): a second open is `busy` with the head pin, also when it
 *   raced past the chain lookup (the store's unique claim, mapped by the owner);
 *   a legacy slot-less second root makes the chain invalid: the head read and a
 *   new open are `incomplete`, the Task projects `blocked/round_ambiguous` (P10)
 *   and its completion is refused (TASK-14).
 * - VD-14 / VD-7: the chain head reads by subject whatever Plan is given, after
 *   a later adoption too; a gate without a chain has none.
 * - VR-07 read set: an adoption or a subject Run write committed while the
 *   finalize runs refuses it (`revision_conflict`) and writes nothing.
 * - VR-10..12: no index row for a zero-evidence finalize, an append from a
 *   nonexistent index.
 * - Projection read (§4.1, VD-14): the chain is read in the Run's window (a
 *   round committed in between retries the read); an unreadable chain makes the
 *   task graph unavailable.
 * - Runner (VD-6, VR-05, VR-13, VD-10): a proven non-start returns the check to
 *   pending, an incomplete ticket interrupts it, a lost or failed result record
 *   is retried with the same request id.
 * - §9.3 Workflow order: an interrupted check does not hold the pending ones,
 *   and a round left with interrupted and finished checks finalizes.
 */
import { afterEach, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { VerificationRoundSourcePort } from '../../src/contracts/verification-context.js';
import type { CheckProcessObservation, RoundSnapshot } from '../../src/contracts/verification.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import type { EvidencePort } from '../../src/core/work-graph/model/evidence-contracts.js';
import {
  VERIFICATION_ROUND_ORIGINAL_LOOKUP,
} from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createRegisteredCheckRunner, type RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { readCanonicalTaskFacts } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createInitializationBindingReader } from '../../src/core/work-graph/tasks/goal-confirm-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import {
  createR3eEvidenceFixture, R3E_GATE_TASK_ID, R3E_WORK_TASK_ID, type R3eEvidenceFixture,
} from '../helpers/R3e-evidence-fixture.js';
import { withBackendOrderedLookup } from '../helpers/ordered-lookup-forward.js';

const KINDS = ['memory', 'sqlite'] as const;
const fixtures: R3eEvidenceFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

async function openFixture(kind: 'memory' | 'sqlite' = 'memory'): Promise<R3eEvidenceFixture> {
  const fixture = await createR3eEvidenceFixture(kind, COMPLETION_RECORD_SCHEMAS);
  fixtures.push(fixture);
  return fixture;
}

function executed(text: string): CheckProcessObservation {
  return { kind: 'executed', startedAt: B2_AT, finishedAt: B2_AT, exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 'a2-workspace-revision-1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
}

async function open(fixture: R3eEvidenceFixture): Promise<RoundSnapshot> {
  const opened = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw Error(`the round must open: ${JSON.stringify(opened)}`);
  return opened.value;
}

async function latest(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref']): Promise<RoundSnapshot> {
  const read = await fixture.evidence.readVerification(fixture.ctx, ref);
  if (read.status !== 'ready') throw Error('the round must be readable');
  return read.value;
}

/** Formal begin/record of every check; the round stays open. */
async function settle(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref']): Promise<RoundSnapshot> {
  let round = await latest(fixture, ref);
  for (const check of round.checks) {
    const begin = await fixture.evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, check.checkId));
    if (begin.status !== 'committed') throw Error(`begin ${check.checkId} must commit`);
    round = await latest(fixture, ref);
    const recorded = await fixture.evidence.recordCheckResult(fixture.ctx,
      fixture.recordRequest(round, check.checkId, begin.value.invocationId, executed(`A2_OK_${check.checkId}\n`)));
    if (recorded.status !== 'committed') throw Error(`record ${check.checkId} must commit`);
    round = recorded.value;
  }
  return round;
}

/** Formal begin/record of every check, then the finalize. */
async function finish(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref']): Promise<RoundSnapshot> {
  const round = await settle(fixture, ref);
  const finalized = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(round));
  if (finalized.status !== 'committed') throw Error(`finalize must commit: ${JSON.stringify(finalized)}`);
  return finalized.value.snapshot;
}

/** The fixture's records with its candidate lookup replaced; the other ports delegate unchanged. */
function recordsWithLookup(fixture: R3eEvidenceFixture, lookup: R3eEvidenceFixture['records']['lookup']): R3eEvidenceFixture['records'] {
  return withBackendOrderedLookup({
    commit: (...args) => fixture.records.commit(...args),
    readMany: (...args) => fixture.records.readMany(...args),
    lookupCommit: (...args) => fixture.records.lookupCommit(...args),
    eventAt: (...args) => fixture.records.eventAt(...args),
    lookup,
  }, fixture.records);
}

/** Another evidence owner over the fixture's ledger, with its own records view, source and id sequence. */
function evidenceOver(fixture: R3eEvidenceFixture, tag: string, overrides: {
  records?: R3eEvidenceFixture['records']; source?: VerificationRoundSourcePort; minted?: string[];
} = {}): EvidencePort {
  let sequence = 0;
  return createEvidenceService({ records: overrides.records ?? fixture.records, materials: fixture.materials,
    executions: createRunStateReader({ records: fixture.records }),
    workspaceHost: fixture.workspaceHost, source: overrides.source ?? new VerificationWorkspaceReader(),
    configuration: fixture.configuration, now: () => B2_AT,
    newId: () => { const id = `a2-${tag}-${++sequence}`; overrides.minted?.push(id); return id; } });
}

/** The fixture's evidence owner over a records view whose first chain lookup answers "no rounds" (a stale read). */
function staleLookupEvidence(fixture: R3eEvidenceFixture): EvidencePort {
  let stale = true;
  return evidenceOver(fixture, 'stale', { records: recordsWithLookup(fixture, async request => {
    if (stale && request.index === VERIFICATION_ROUND_ORIGINAL_LOOKUP) {
      stale = false;
      const page = await fixture.records.lookup(request);
      return page.status === 'ready' ? { status: 'ready', value: { ...page.value, records: [], next: null } } : page;
    }
    return fixture.records.lookup(request);
  }) });
}

async function readKeys(fixture: R3eEvidenceFixture, keys: readonly string[]): Promise<string[]> {
  const read = await fixture.records.readMany(keys);
  if (read.status !== 'ready') throw Error('the record read must succeed');
  return read.value.records.map(record => record.refKey);
}
const keyOf = (ref: object): string => canonicalJson(ref as unknown as JsonValue);

async function workRow(fixture: R3eEvidenceFixture) {
  const graph = await fixture.b2.base.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef });
  if (graph.status !== 'ready') throw Error('the task graph must be readable');
  return graph.value.tasks.find(row => row.ref.taskId === R3E_WORK_TASK_ID);
}

it.each(KINDS)('%s: VR-01 claims the subject slot, so a second root never commits (VD-1)', async kind => {
  const fixture = await openFixture(kind);
  const first = await open(fixture);
  expect(first.chain).toMatchObject({ ordinal: 1, predecessorRoundRef: null, reverify: null });
  // Another request on the same subject Run reads the chain and is busy with the head pin.
  expect(await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest()))
    .toMatchObject({ status: 'rejected', code: 'busy', current: [{ ref: first.ref, revision: 1 }] });
  // A request whose lookup missed the first round reaches the commit; the slot claim refuses it the same way.
  const raced = await staleLookupEvidence(fixture).openVerification(fixture.ctx, fixture.openRequest());
  expect(raced).toMatchObject({ status: 'rejected', code: 'busy', current: [{ ref: first.ref, revision: 1 }] });
  expect(await fixture.evidence.queryRoundChainHead!(fixture.ctx, { subject: fixture.subject, subjectRunRef: fixture.subjectRunRef }))
    .toEqual({ status: 'ready', value: first });
});

it('VD-14 / VD-7: the head reads by subject whatever Plan the caller names, after a later adoption too', async () => {
  const fixture = await openFixture();
  const round = await open(fixture);
  await fixture.adoptUnrelatedFutureEdit('a2-chain-plan-future', 'a2-chain-future');
  const query = { subjectRunRef: fixture.subjectRunRef, subject: fixture.subject };
  expect(await fixture.evidence.queryOriginalVerification!(fixture.ctx, query)).toEqual({ status: 'ready', value: round });
  expect(await fixture.evidence.queryOriginalVerification!(fixture.ctx, { ...query, planRef: fixture.planRef }))
    .toEqual({ status: 'ready', value: round });
  expect(await fixture.evidence.queryOriginalVerification!(fixture.ctx, { ...query,
    planRef: { ...fixture.planRef, projectId: 'another-project' } })).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(await fixture.evidence.queryRoundChainHead!(fixture.ctx, {
    subject: { ...fixture.subject, taskId: R3E_GATE_TASK_ID }, subjectRunRef: null })).toEqual({ status: 'not_found' });
  // The Task projects from the open head: verifying / verification_running (P12).
  expect(await workRow(fixture)).toMatchObject({ effectivePhase: 'verifying', phaseCause: { code: 'verification_running' } });
});

/** A legal write on the ended subject Run: the Runtime records its history locator again (RUN-06), revision + 1. */
async function rerecordSubjectHistory(fixture: R3eEvidenceFixture, requestId: string): Promise<void> {
  const read = await createRunStateReader({ records: fixture.records }).readExecution(fixture.ctx, fixture.subjectRunRef);
  if (read.status !== 'ready' || read.value.run.executionHistory === undefined) throw Error('the subject Run history must be readable');
  const { run } = read.value;
  const history = run.executionHistory!;
  const recorded = await createExecutionHistoryService({ records: fixture.records, now: () => B2_AT, eventId: () => `${requestId}-event` })
    .recordExecutionHistory(fixture.ctx, { input: { runRef: fixture.subjectRunRef, kernel: history.kernel,
      startPosition: history.startPosition, observedThroughPosition: history.observedThroughPosition, endPosition: history.endPosition },
    meta: { requestId, expected: [{ ref: fixture.subjectRunRef, revision: run.revision }] } });
  if (recorded.status !== 'committed') throw Error(`the subject Run history write must commit: ${JSON.stringify(recorded)}`);
}

it.each([
  ['memory', 'Plan adoption'], ['sqlite', 'Plan adoption'], ['memory', 'subject Run'], ['sqlite', 'subject Run'],
] as const)('%s: VR-07 guards its read set: a %s write committed during the finalize refuses it and nothing is written', async (kind, mover) => {
  const fixture = await openFixture(kind);
  const round = await settle(fixture, (await open(fixture)).ref);
  const runBefore = await createRunStateReader({ records: fixture.records }).readExecution(fixture.ctx, fixture.subjectRunRef);
  // The concurrent write lands after the finalize read the Goal, the Plans and the subject Run, before its commit.
  let armed = false;
  const minted: string[] = [];
  const reader = new VerificationWorkspaceReader();
  const evidence = evidenceOver(fixture, `readset-${mover === 'subject Run' ? 'run' : 'plan'}`, { minted, source: { async capture(root) {
    if (armed) {
      armed = false;
      if (mover === 'Plan adoption') await fixture.adoptUnrelatedFutureEdit('a2-readset-plan', 'a2-readset-adopt');
      else await rerecordSubjectHistory(fixture, 'a2-readset-history');
    }
    return reader.capture(root);
  } } });
  armed = true;
  const refused = await evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(round));
  expect(armed, 'the concurrent write ran inside the finalize').toBe(false);
  expect(refused).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  if (mover === 'subject Run') {
    const runAfter = await createRunStateReader({ records: fixture.records }).readExecution(fixture.ctx, fixture.subjectRunRef);
    if (runBefore.status !== 'ready' || runAfter.status !== 'ready') throw Error('the subject Run must be readable');
    expect(runAfter.value.run.revision).toBe(runBefore.value.run.revision + 1);
  }
  // The round is still open at the same revision; no Evidence and no index row was written.
  expect(await latest(fixture, round.ref)).toEqual(round);
  const indexKey = keyOf({ aggregateType: 'TaskEvidenceIndex', projectId: fixture.scope.projectId,
    goalId: fixture.goalRef.goalId, taskId: R3E_WORK_TASK_ID });
  expect(minted.length).toBeGreaterThan(0);
  expect(await readKeys(fixture, [indexKey, ...minted.map(evidenceId =>
    keyOf({ aggregateType: 'Evidence', projectId: fixture.scope.projectId, evidenceId }))])).toEqual([]);
  // The next finalize reads the moved facts and commits.
  const finalized = await evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(round));
  expect(finalized).toMatchObject({ status: 'committed', value: { outcome: 'PASS', gaps: [] } });
  expect(await readKeys(fixture, [indexKey])).toEqual([indexKey]);
});

it('VR-10..12: no index row for zero evidence, an append from no index', async () => {
  const fixture = await openFixture();
  const indexRef = { aggregateType: 'TaskEvidenceIndex' as const, projectId: fixture.scope.projectId,
    goalId: fixture.goalRef.goalId, taskId: R3E_WORK_TASK_ID };
  const indexKey = canonicalJson(indexRef as unknown as JsonValue);
  const readIndex = async () => {
    const read = await fixture.records.readMany([indexKey]);
    if (read.status !== 'ready') throw Error('the index read must succeed');
    return read.value.records.find(record => record.refKey === indexKey) ?? null;
  };
  // VR-12: a round finalized with every check pending admits nothing and writes no index row.
  const round = await open(fixture);
  const finalized = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(round));
  expect(finalized).toMatchObject({ status: 'committed', value: { outcome: 'INCONCLUSIVE', evidence: [] } });
  expect(await readIndex()).toBeNull();
  // VR-11: the gate's own index starts absent and the append creates it.
  const gateIndexRef = { ...indexRef, taskId: R3E_GATE_TASK_ID };
  const gate = await fixture.evidence.openVerification(fixture.ctx,
    fixture.openRequest({ subject: { ...fixture.subject, taskId: R3E_GATE_TASK_ID }, gateSubject: 'goal' }));
  if (gate.status !== 'committed') throw Error(`the gate round must open: ${JSON.stringify(gate)}`);
  const gateDone = await finish(fixture, gate.value.ref);
  expect(gateDone).toMatchObject({ status: 'finalized', outcome: 'PASS' });
  const gateIndex = await fixture.records.readMany([canonicalJson(gateIndexRef as unknown as JsonValue)]);
  if (gateIndex.status !== 'ready') throw Error('the gate index must be readable');
  expect(JSON.parse(gateIndex.value.records[0]!.json)).toMatchObject({ revision: gateDone.evidenceRefs.length,
    evidenceIds: gateDone.evidenceRefs.map(ref => ref.evidenceId) });
});

it.each(KINDS)('%s: the projection reads the chain in the window of the Run; a round committed in between retries the read', async kind => {
  const fixture = await openFixture(kind);
  const settled = await settle(fixture, (await open(fixture)).ref);
  expect(await workRow(fixture)).toMatchObject({ effectivePhase: 'verifying', phaseCause: { code: 'verification_running' } });
  // The finalize commits after the canonical read of the Run and before its chain lookup answers.
  let lookups = 0;
  const records = recordsWithLookup(fixture, async request => {
    if (request.index === VERIFICATION_ROUND_ORIGINAL_LOOKUP && ++lookups === 1) {
      expect(await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(settled)))
        .toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    }
    return fixture.records.lookup(request);
  });
  const moved = await readCanonicalTaskFacts(records, fixture.goalRef, fixture.plan);
  if (moved.status !== 'ready') throw Error(`the task facts must be readable: ${JSON.stringify(moved)}`);
  expect(lookups, 'the moved window is read again').toBe(2);
  expect(moved.value.byTaskId.get(R3E_WORK_TASK_ID)).toMatchObject({ effectivePhase: 'verifying',
    phaseCause: { code: 'awaiting_completion' } });
  // One watermark: the facts are those of a read after the finalize, never the Run's older window with a newer chain.
  const after = await readCanonicalTaskFacts(fixture.records, fixture.goalRef, fixture.plan);
  if (after.status !== 'ready') throw Error('the task facts must be readable again');
  expect(moved.value.readThrough).toEqual(after.value.readThrough);
  expect(moved.value.roundsByTaskId.get(R3E_WORK_TASK_ID)).toMatchObject({ kind: 'pass' });
});

it('a round chain the projection cannot read makes the task graph unavailable, never a guessed phase', async () => {
  const fixture = await openFixture();
  await open(fixture);
  const records = recordsWithLookup(fixture, async request => request.index === VERIFICATION_ROUND_ORIGINAL_LOOKUP
    ? { status: 'rejected', code: 'unavailable', reason: 'a2: the round index is unavailable' }
    : fixture.records.lookup(request));
  const plans = createPlanService({ records, bindings: createInitializationBindingReader({ records }),
    now: () => B2_AT, eventId: () => 'a2-unused-event' });
  expect(await plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef }))
    .toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(await readCanonicalTaskFacts(records, fixture.goalRef, fixture.plan))
    .toMatchObject({ status: 'rejected', code: 'unavailable' });
});

/** The runner over the fixture's evidence owner, with a Host binding the test may switch. */
function runnerWith(fixture: R3eEvidenceFixture, evidence: EvidencePort, workspaceHost: WorkspaceHostBindings = fixture.workspaceHost) {
  return createRegisteredCheckRunner({ evidence, workspaceHost, kernel, now: () => B2_AT });
}
function runRequest(round: RoundSnapshot, checkId: string, requestId: string) {
  return { input: { roundRef: round.ref, checkId }, meta: { requestId, expected: [{ ref: round.ref, revision: round.revision }] } };
}
/** The fixture's evidence owner, except that the begin of `checkId()` hands out an incomplete ticket. */
function brokenTicketEvidence(fixture: R3eEvidenceFixture, checkId: () => string | null): EvidencePort {
  return { ...fixture.evidence, async beginCheck(ctx, request) {
    const begun = await fixture.evidence.beginCheck(ctx, request);
    return begun.status === 'committed' && request.input.checkId === checkId()
      ? { ...begun, value: { ...begun.value, workspaceRoot: '' } } : begun;
  } };
}

it.each(KINDS)('%s: VR-05 (VD-6): a root change after begin and a caller cancel return the check to pending; the next run begins anew', async kind => {
  const fixture = await openFixture(kind);
  const round = await open(fixture);
  const checkId = fixture.passCheck.checkId;
  // The runner's own root re-check after begin sees another root.
  let resolves = 0;
  const movingRoot: WorkspaceHostBindings = { ...fixture.workspaceHost, async resolveRoot(workspace) {
    resolves += 1;
    const resolved = await fixture.workspaceHost.resolveRoot(workspace);
    return resolves === 2 && resolved.status === 'ready' ? { status: 'ready', value: { ...resolved.value, root: '/a2/moved' } } : resolved;
  } };
  const moved = await runnerWith(fixture, fixture.evidence, movingRoot).runRegisteredCheck(fixture.ctx, runRequest(round, checkId, 'a2-run-moved'));
  expect(moved).toMatchObject({ status: 'rejected', code: 'unavailable', reason: 'the workspace root changed after begin; no process was started' });
  const afterMove = await latest(fixture, round.ref);
  expect(afterMove.checks.find(check => check.checkId === checkId)).toMatchObject({ phase: 'pending', invocationId: null });
  expect(afterMove.revision).toBe(3);
  // The caller cancels right after the begin commits: no process starts and the window returns to pending.
  const controller = new AbortController();
  const cancelling: EvidencePort = { ...fixture.evidence, async beginCheck(ctx, request) {
    const begun = await fixture.evidence.beginCheck(ctx, request);
    controller.abort();
    return begun;
  } };
  const cancelCtx: CoreCallContext = { ...fixture.ctx, signal: controller.signal };
  expect(await runnerWith(fixture, cancelling).runRegisteredCheck(cancelCtx, runRequest(afterMove, checkId, 'a2-run-cancel')))
    .toMatchObject({ status: 'rejected', code: 'cancelled' });
  const afterCancel = await latest(fixture, round.ref);
  expect(afterCancel.checks.find(check => check.checkId === checkId)).toMatchObject({ phase: 'pending', invocationId: null });
  // A later run begins with a new invocation and records the real result.
  const ran = await fixture.runner.runRegisteredCheck(fixture.ctx, runRequest(afterCancel, checkId, 'a2-run-again'));
  expect(ran).toMatchObject({ status: 'ready' });
  if (ran.status !== 'ready') throw Error('the check must run');
  expect(ran.value.checks.find(check => check.checkId === checkId)).toMatchObject({ phase: 'finished', outcome: 'PASS' });
});

it.each(KINDS)('%s: VR-13: an incomplete ticket interrupts the check (ticket_invalid), and the round finalizes it as a gap', async kind => {
  const fixture = await openFixture(kind);
  const round = await open(fixture);
  const checkId = fixture.interruptCheck.checkId;
  const refused = await runnerWith(fixture, brokenTicketEvidence(fixture, () => checkId))
    .runRegisteredCheck(fixture.ctx, runRequest(round, checkId, 'a2-run-broken'));
  expect(refused).toMatchObject({ status: 'rejected', code: 'unavailable', reason: expect.stringMatching(/^the frozen ticket is incomplete: /) });
  const interrupted = await latest(fixture, round.ref);
  expect(interrupted.checks.find(check => check.checkId === checkId)).toMatchObject({ phase: 'interrupted',
    incompleteCause: 'ticket_invalid', outcome: null });
  // The other check still runs (V6); the round finalizes with the interrupted check as a gap.
  const ran = await fixture.runner.runRegisteredCheck(fixture.ctx, runRequest(interrupted, fixture.passCheck.checkId, 'a2-run-pass'));
  if (ran.status !== 'ready') throw Error('the pass check must run');
  const finalized = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(ran.value));
  expect(finalized).toMatchObject({ status: 'committed', value: { outcome: 'INCONCLUSIVE',
    gaps: [{ code: 'interrupted_check', message: `the required check ${checkId} was interrupted (ticket_invalid)` }] } });
});

it.each(KINDS)('%s: VD-10: a result record that failed or lost its response is retried with the same request id', async kind => {
  const fixture = await openFixture(kind);
  const round = await open(fixture);
  const requests: string[] = [];
  // 1. The report store is unavailable once: the runner re-reads the round and records again.
  let failOnce = true;
  const flaky: EvidencePort = { ...fixture.evidence, async recordCheckResult(ctx, request) {
    requests.push(request.meta.requestId);
    if (failOnce) { failOnce = false; return { status: 'rejected', code: 'unavailable', reason: 'the report store is unavailable' }; }
    return fixture.evidence.recordCheckResult(ctx, request);
  } };
  const first = await runnerWith(fixture, flaky).runRegisteredCheck(fixture.ctx, runRequest(round, fixture.passCheck.checkId, 'a2-run-flaky'));
  expect(first).toMatchObject({ status: 'ready' });
  if (first.status !== 'ready') throw Error('the check must be recorded');
  expect(first.value.checks.find(check => check.checkId === fixture.passCheck.checkId)).toMatchObject({ phase: 'finished', outcome: 'PASS' });
  expect(requests).toHaveLength(2);
  expect(new Set(requests).size).toBe(1);
  // 2. The record commits but its response is lost: the re-read shows the finished check, which is the answer.
  let calls = 0;
  const lossy: EvidencePort = { ...fixture.evidence, async recordCheckResult(ctx, request) {
    calls += 1;
    const recorded = await fixture.evidence.recordCheckResult(ctx, request);
    return calls === 1 ? { status: 'rejected', code: 'unavailable', reason: 'the response was lost' } : recorded;
  } };
  const second = await runnerWith(fixture, lossy).runRegisteredCheck(fixture.ctx,
    runRequest(first.value, fixture.interruptCheck.checkId, 'a2-run-lossy'));
  expect(second).toMatchObject({ status: 'ready' });
  if (second.status !== 'ready') throw Error('the lost record must be read back');
  expect(second.value.checks.find(check => check.checkId === fixture.interruptCheck.checkId))
    .toMatchObject({ phase: 'finished', outcome: 'PASS' });
  expect(calls).toBe(1);
});

/** The real Workflow over the fixture's owners; no Run is started, so the Runtime answers unsupported. */
function workflowOver(fixture: R3eEvidenceFixture, checks: RegisteredCheckRunner) {
  const unsupported = async () => ({ status: 'rejected' as const, code: 'unsupported' as const, reason: 'no Runtime in this test' });
  const runtime: RuntimeExecutionPort = { capabilities: unsupported, createSession: unsupported, readSessionHistory: unsupported,
    readExecutionHistory: unsupported, readTaskExecutionHistory: unsupported, prepareExecution: unsupported,
    startRun: unsupported, observeRun: unsupported };
  const base = fixture.b2.base;
  return createWorkflow({ tasks: base.goals, plans: base.plans, sessions: base.sessionsPort, claims: base.service,
    executions: createRunStateReader({ records: fixture.records }), runtime, evidence: fixture.evidence, checks,
    sourceAuthority: createSourceAuthorityReader({ authority: createMaterialRecordReaders(fixture.records).authority }),
    configuration: { consumerId: 'a2-order-consumer', bindings: [{ workspace: fixture.scope,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: base.roleBinding, budget: base.budget }] } });
}

it.each(KINDS)('%s: §9.3 Workflow order: an interrupted check does not hold the pending one, and the round then finalizes', async kind => {
  const fixture = await openFixture(kind);
  // VR-13 interrupts the round's first check (its ticket is incomplete); the second runs normally.
  let firstCheckId: string | null = null;
  const workflow = workflowOver(fixture, runnerWith(fixture, brokenTicketEvidence(fixture, () => firstCheckId)));
  const advance = async (input: WorkflowAdvanceInput) => {
    const result = await workflow.advanceWork(fixture.ctx, input);
    if (result.status !== 'ready') throw Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    return result.value;
  };
  const select = (flowId: string): WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef: fixture.goalRef, flowId,
    sessionHint: null, kind: 'select_work', taskId: R3E_WORK_TASK_ID });
  // 1. The completed Run has no chain: the Workflow opens its root, then runs the first check.
  const toOpen = await advance(select('a2-order-1'));
  expect(toOpen.next).toMatchObject({ kind: 'perform', operation: { kind: 'open_checks' } });
  const opened = await advance(toOpen.next!);
  const next1 = opened.next;
  if (next1?.kind !== 'perform' || next1.operation.kind !== 'run_check') throw Error(`the open must lead to a check: ${JSON.stringify(opened)}`);
  firstCheckId = next1.operation.request.input.checkId;
  const roundRef = next1.operation.request.input.roundRef;
  const interrupted = await advance(next1);
  expect(interrupted).toMatchObject({ state: 'waiting', next: null, receipt: { kind: 'run_check',
    result: { status: 'rejected', code: 'unavailable', reason: expect.stringMatching(/^the frozen ticket is incomplete: /) } } });
  const afterInterrupt = await latest(fixture, roundRef);
  const secondCheckId = afterInterrupt.checks.find(check => check.checkId !== firstCheckId)!.checkId;
  expect(afterInterrupt.checks.map(check => [check.checkId, check.phase])).toEqual(
    afterInterrupt.checks.map(check => [check.checkId, check.checkId === firstCheckId ? 'interrupted' : 'pending']));
  expect(await workRow(fixture)).toMatchObject({ effectivePhase: 'verifying',
    phaseCause: { code: 'verification_running', detail: { checkIds: [firstCheckId] } } });
  // 2. The next selection runs the pending check past the interrupted one (V6 "只补未执行"), never the interrupted one.
  const resumed = await advance(select('a2-order-2'));
  expect(resumed.next).toMatchObject({ kind: 'perform', operation: { kind: 'run_check',
    request: { input: { roundRef, checkId: secondCheckId } } } });
  // 3. Only interrupted and finished checks are left: the round finalizes, the interrupted check a gap.
  const ran = await advance(resumed.next!);
  expect(ran).toMatchObject({ state: 'advance', receipt: { kind: 'run_check', result: { status: 'ready' } },
    next: { kind: 'perform', operation: { kind: 'finalize_checks', request: { input: { roundRef } } } } });
  expect(await workRow(fixture)).toMatchObject({ effectivePhase: 'blocked',
    phaseCause: { code: 'check_interrupted' } });
  const finalized = await advance(ran.next!);
  // §15.2 5.8 result mapping: a non-PASS finalize goes back to the selection.
  expect(finalized).toMatchObject({ state: 'advance', next: { kind: 'select_work', flowId: 'a2-order-2' },
    receipt: { kind: 'finalize_checks', result: { status: 'committed',
    value: { outcome: 'INCONCLUSIVE', gaps: [{ code: 'interrupted_check',
      message: `the required check ${firstCheckId} was interrupted (ticket_invalid)` }] } } } });
  expect(await workRow(fixture)).toMatchObject({ effectivePhase: 'blocked',
    phaseCause: { code: 'round_inconclusive', detail: { gapCodes: ['interrupted_check'] } } });
});
