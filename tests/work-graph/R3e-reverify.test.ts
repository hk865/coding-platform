/**
 * A.2 step 5.9 part 1: the successor-round owner (`EvidencePort.reverifyRound`,
 * docs/refactor/STATE-MACHINES-SPEC.md §9 VR-14/VR-15, VD-12, VD-13, §13.7;
 * §4 TASK-28 (reverify refusals), TASK-29; decisions C5, C8, LA-4, LA-5) over
 * the real R3e fixture: real RecordStore (memory and SQLite), real round
 * writers, real verification workspace reader, the B2 Run/claim/entry writers
 * and the delegated-write admission. Check results are recorded through the
 * formal `beginCheck`/`recordCheckResult` path with explicit observations
 * (no process runs, no model is called).
 *
 * - VR-14/15: an INCONCLUSIVE head gets its successor @1 (ordinal 2, the slot
 *   moved from the head, the predecessor byte-identical), which freezes the
 *   current configuration and the configured executor; the chain-head reads
 *   and the Task projection (TASK-29) follow it; the same request replays, an
 *   old head is `revision_conflict` with the head pin; a second root is `busy`.
 * - R1 FAIL → the file changes → R2 PASS → `completeTask` excludes R1's
 *   blocking evidence (VD-5); without the successor the FAIL fails the Task.
 * - §13.7 policy refusals are committed values: the cap before any capture,
 *   `no_new_basis` (S1 → S1, the same note twice), a human note as a new
 *   input, `source_unchanged`, `verification_uncovered` (configuration
 *   revision stored, LA-4); the refusal pin; the 0-commit problems.
 * - Gate (VD-15): `source_unchanged` on a FAIL gate head, the successor on the
 *   anchored producer after a change; a legacy slot-less root (`null → key`),
 *   then two roots (`incomplete`).
 * - Races: two reverifies of one head, a reverify against a requeue of the
 *   same head (VR-09's same-owner slot), and a reverify refusal against a
 *   requeue in either commit order (§13.2 point 5: the requeue guards the
 *   head's refusal record, the refusal the absent TaskRequeue), commit
 *   exactly once; a refusal committed earlier does not stop a later requeue.
 * - Steps 4–5 (§13.2 point 4, VD-9): a paused or cancelled Goal answers
 *   `busy` to the operator and the automation with nothing written; after the
 *   resume the operator opens the successor (the fence is
 *   tests/composition/A2-reverify-platform.test.ts).
 * - Step 9 and the commit (VD-12, §9.3 VR-14): the Host grant is asked as the
 *   configured executor whoever requests; a Workspace write between the
 *   capture and the commit writes nothing.
 * - Agent (VR-14 step 2, TD-6): an entered Agent of the same Goal with the
 *   `reverify_round` grant opens a successor (`actorClass:'agent'`, the event
 *   actor is the Host executor); another Goal's Agent, an Agent without the
 *   admission seam and an Agent note are refused; an Agent Run that ends
 *   between the admission and the commit writes nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { REPORT_CONTENT_TYPE } from '../../src/contracts/no-progress.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, WORKFLOW_AUTOMATION_ACTOR, type TaskAutomationPolicyV1, type TaskReworkRefusalRef,
} from '../../src/contracts/task-requeue.js';
import type {
  CheckProcessObservation, RoundSnapshot, TrustedCheckConfiguration,
} from '../../src/contracts/verification.js';
import type { VerificationRoundSourcePort } from '../../src/contracts/verification-context.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { EvidencePort, EvidenceServiceDependencies, ReverifyOutcomeV1, ReverifyRoundInput } from '../../src/core/work-graph/evidence/contracts.js';
import {
  VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE, encodeVerificationRoundSnapshot,
} from '../../src/core/work-graph/evidence/evidence-record-codecs.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import {
  TASK_REWORK_REFUSED_EVENT_TYPE, taskRequeueRefKey, taskReworkRefusalRefKey,
} from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import type { GraphWrite } from '../../src/core/work-graph/tasks/contracts.js';
import type {
  AuthorizeConfiguration, KernelExecutionBinding, TaskEntryPermit,
} from '../../src/core/work-graph/tasks/execution-entry-contracts.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { chainEvidenceIds } from '../../src/core/work-graph/state/verification-machine.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { B2_AT, B2_HOST, synchronizeB2Commits } from '../helpers/B2-execution-fixture.js';
import {
  createR3eEvidenceFixture, R3E_GATE_TASK_ID, R3E_HOST, R3E_WORK_TASK_ID, type R3eEvidenceFixture,
} from '../helpers/R3e-evidence-fixture.js';

const KINDS = ['memory', 'sqlite'] as const;
const GRANT = { ...B2_HOST.permissions, tools: ['read', 'reverify_round'] };
const key = (ref: object): string => canonicalJson(ref as JsonValue);
const fixtures: R3eEvidenceFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

async function openFixture(kind: 'memory' | 'sqlite' = 'memory'): Promise<R3eEvidenceFixture> {
  const fixture = await createR3eEvidenceFixture(kind, COMPLETION_RECORD_SCHEMAS);
  fixtures.push(fixture);
  return fixture;
}

function executed(exitCode: number): CheckProcessObservation {
  const text = exitCode === 0 ? 'R3E_OK\n' : 'R3E_FAILED\n';
  return { kind: 'executed', startedAt: B2_AT, finishedAt: B2_AT, exitCode, signal: null, timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 'r3e-workspace-revision-1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
}

type Reverifier = {
  evidence: EvidencePort;
  /** The scope's current trusted configuration (`configurationFor`). */
  configuration: { current: TrustedCheckConfiguration };
  policy: { current: TaskAutomationPolicyV1 };
  captures(): number;
};

/** An evidence owner over the fixture's ledger with the 5.9 dependencies (policy, scoped configuration, optional seams). */
function reverifier(fixture: R3eEvidenceFixture, tag: string, extra: Partial<EvidenceServiceDependencies> = {}): Reverifier {
  let sequence = 0;
  let captures = 0;
  const reader = new VerificationWorkspaceReader();
  const source: VerificationRoundSourcePort = { capture(root) { captures += 1; return reader.capture(root); } };
  const configuration = { current: fixture.configuration };
  const policy = { current: { ...DEFAULT_TASK_AUTOMATION_POLICY } };
  const evidence = createEvidenceService({ records: fixture.records, materials: fixture.materials,
    materialFacts: fixture.materialFacts, executions: createRunStateReader({ records: fixture.records }),
    workspaceHost: fixture.workspaceHost, source,
    configurationFor: scope => scope.projectId === fixture.scope.projectId && scope.workspaceId === fixture.scope.workspaceId
      ? configuration.current : undefined,
    automationPolicy: () => policy.current,
    now: () => B2_AT, newId: () => `r3e-reverify-${tag}-${++sequence}`, ...extra });
  return { evidence, configuration, policy, captures: () => captures };
}

async function open(fixture: R3eEvidenceFixture, gate = false): Promise<RoundSnapshot> {
  const opened = await fixture.evidence.openVerification(fixture.ctx, gate
    ? fixture.openRequest({ subject: { ...fixture.subject, taskId: R3E_GATE_TASK_ID }, gateSubject: 'goal' })
    : fixture.openRequest());
  if (opened.status !== 'committed') throw Error(`the round must open: ${JSON.stringify(opened)}`);
  return opened.value;
}

async function latest(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref']): Promise<RoundSnapshot> {
  const read = await fixture.evidence.readVerification(fixture.ctx, ref);
  if (read.status !== 'ready') throw Error('the round must be readable');
  return read.value;
}

/** Formal begin/record of every check with the given exit code, then the finalize; `run: false` finalizes them pending. */
async function finish(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref'], exitCode: number | null): Promise<RoundSnapshot> {
  let round = await latest(fixture, ref);
  if (exitCode !== null) {
    for (const check of round.checks) {
      const begin = await fixture.evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, check.checkId));
      if (begin.status !== 'committed') throw Error(`begin ${check.checkId} must commit: ${JSON.stringify(begin)}`);
      round = await latest(fixture, ref);
      const recorded = await fixture.evidence.recordCheckResult(fixture.ctx,
        fixture.recordRequest(round, check.checkId, begin.value.invocationId, executed(exitCode)));
      if (recorded.status !== 'committed') throw Error(`record ${check.checkId} must commit`);
      round = recorded.value;
    }
  }
  const finalized = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(round));
  if (finalized.status !== 'committed') throw Error(`finalize must commit: ${JSON.stringify(finalized)}`);
  return finalized.value.snapshot;
}

function refusalRefOf(round: RoundSnapshot): TaskReworkRefusalRef {
  return { aggregateType: 'TaskReworkRefusal', projectId: round.ref.projectId, goalId: round.ref.goalId,
    taskId: round.ref.taskId, operation: 'reverify', subjectId: round.ref.roundId };
}

function reverifyRequest(round: RoundSnapshot, requestId: string, extra: Omit<ReverifyRoundInput, 'predecessorRoundRef'> = {},
  refusalRevision?: number): GraphWrite<ReverifyRoundInput> {
  return { input: { predecessorRoundRef: round.ref, ...extra }, meta: { requestId, expected: [
    { ref: round.ref, revision: round.revision },
    ...(refusalRevision === undefined ? [] : [{ ref: refusalRefOf(round), revision: refusalRevision }]),
  ] } };
}

function hostCtx(fixture: R3eEvidenceFixture, actor: { kind: 'human' | 'system'; id: string }): CoreCallContext {
  return { projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId, actor },
    signal: new AbortController().signal };
}

function reverified(result: WriteResult<ReverifyOutcomeV1>): RoundSnapshot {
  if (result.status !== 'committed' || result.value.kind !== 'reverified') throw Error(`the reverify must commit a successor: ${JSON.stringify(result)}`);
  return result.value.round;
}

async function workRow(fixture: R3eEvidenceFixture, taskId = R3E_WORK_TASK_ID) {
  const graph = await fixture.b2.base.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef });
  if (graph.status !== 'ready') throw Error('the task graph must be readable');
  return graph.value.tasks.find(row => row.ref.taskId === taskId);
}

async function exists(fixture: R3eEvidenceFixture, refKey: string): Promise<number | null> {
  const read = await fixture.records.readMany([refKey]);
  if (read.status !== 'ready') throw Error('the record read must succeed');
  return read.value.records.find(record => record.refKey === refKey)?.revision ?? null;
}

async function changeSource(fixture: R3eEvidenceFixture, text: string): Promise<void> {
  await writeFile(join(fixture.workspaceRoot, 'src', 'input.txt'), text);
}

/** The fixture's ledger, running `before` once just ahead of the first commit of a successor round or a reverify refusal. */
function beforeReverifyCommit(fixture: R3eEvidenceFixture, before: () => Promise<void>): R3eEvidenceFixture['records'] {
  let done = false;
  return { ...fixture.records, async commit(batch) {
    if (!done && batch.events.some(event => event.eventType === VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE
      || event.eventType === TASK_REWORK_REFUSED_EVENT_TYPE)) {
      done = true;
      await before();
    }
    return fixture.records.commit(batch);
  } };
}

async function within<T>(promise: Promise<T>, reason: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(reason)), 5000); })]);
  } finally { clearTimeout(timer); }
}

/**
 * Two writers over the fixture's ledger that both finish their reads before
 * either commits, in a fixed order: `first` commits once `second` reached
 * its commit, and `second` commits after `first`'s commit returned.
 */
function orderedCommits(fixture: R3eEvidenceFixture): { first: R3eEvidenceFixture['records']; second: R3eEvidenceFixture['records'] } {
  let arrive!: () => void;
  let committed!: () => void;
  const arrived = new Promise<void>(resolve => { arrive = resolve; });
  const firstDone = new Promise<void>(resolve => { committed = resolve; });
  return {
    first: { ...fixture.records, async commit(batch) {
      await within(arrived, 'the second writer never reached its commit');
      try { return await fixture.records.commit(batch); } finally { committed(); }
    } },
    second: { ...fixture.records, async commit(batch) {
      arrive();
      await within(firstDone, 'the first writer never committed');
      return fixture.records.commit(batch);
    } },
  };
}

/** A concurrent write of the Goal's Workspace record (its revision + 1, content unchanged). */
async function bumpWorkspace(fixture: R3eEvidenceFixture): Promise<void> {
  const refKey = key(fixture.workspaceRef);
  const read = await fixture.records.readMany([refKey]);
  const record = read.status === 'ready' ? read.value.records.find(candidate => candidate.refKey === refKey) : undefined;
  if (record === undefined) throw Error('the Workspace record must be readable');
  const revision = record.revision + 1;
  expect(await fixture.b2.base.commitRaw([{ refKey, schemaId: record.schemaId, revision,
    json: JSON.stringify({ ...JSON.parse(record.json) as object, revision }) }], [{ refKey, expectedRevision: record.revision }]))
    .toMatchObject({ status: 'committed' });
}

/** The 5.5 owner `setGoalControl` as the operator, pinned to the Goal as it is now. */
async function goalControl(fixture: R3eEvidenceFixture, control: 'pause' | 'resume' | 'cancel', requestId: string): Promise<void> {
  const goal = await fixture.b2.base.plans.queryGoal(fixture.ctx, fixture.goalRef);
  if (goal.status !== 'ready') throw Error('the Goal must be readable');
  expect(await fixture.b2.base.goals.setGoalControl(fixture.ctx, { input: { goalRef: fixture.goalRef, control,
    reason: `operator ${control}` }, meta: { requestId, expected: [{ ref: fixture.goalRef, revision: goal.value.goal.revision }] } }))
    .toMatchObject({ status: 'committed',
      value: { desiredState: control === 'pause' ? 'paused' : control === 'resume' ? 'active' : 'cancelled' } });
}

/** A requeue owner over `records` (the race wrapper or the fixture's ledger) with a digest-only source. */
function requeueOwner(fixture: R3eEvidenceFixture, records: R3eEvidenceFixture['records'], tag: string) {
  let events = 0;
  return createTaskRequeueService({ records, reads: createRunStateReader({ records: fixture.records }),
    workspaceHost: fixture.workspaceHost, source: { async captureDigest(root) {
      const captured = await new VerificationWorkspaceReader().capture(root);
      return captured.status === 'ready' ? { status: 'ready', sourceDigest: captured.sourceDigest }
        : { status: 'unavailable', reason: 'the source is not readable' };
    } }, materials: fixture.materials, messages: { async readMessage() { return { status: 'not_found' }; } },
    now: () => B2_AT, eventId: () => `r3e-${tag}-requeue-${++events}` });
}

/** An operator requeue of the work Task after the subject Run, pinned to the Goal and the Run as they are now. */
async function requeueRequest(fixture: R3eEvidenceFixture, requestId: string) {
  const goal = await fixture.b2.base.plans.queryGoal(fixture.ctx, fixture.goalRef);
  const run = await createRunStateReader({ records: fixture.records }).readExecution(fixture.ctx, fixture.subjectRunRef);
  if (goal.status !== 'ready' || run.status !== 'ready') throw Error('the Goal and the Run must be readable');
  return { input: { taskRef: fixture.subject, afterRunRef: fixture.subjectRunRef, reason: 'redo the work in a new Run' },
    meta: { requestId, expected: [{ ref: fixture.goalRef, revision: goal.value.goal.revision },
      { ref: fixture.subjectRunRef, revision: run.value.run.revision }] } };
}

function chainHead(fixture: R3eEvidenceFixture) {
  return fixture.evidence.queryRoundChainHead!(fixture.ctx, { subject: fixture.subject, subjectRunRef: fixture.subjectRunRef });
}

describe.each(KINDS)('reverifyRound (%s)', (kind) => {
  it('VR-14/15: an INCONCLUSIVE head gets its successor @1 under the current configuration; reads, replay and the old head', async () => {
    const fixture = await openFixture(kind);
    const owner = reverifier(fixture, 'r1');
    const r1 = await finish(fixture, (await open(fixture)).ref, null);
    expect(r1).toMatchObject({ status: 'finalized', outcome: 'INCONCLUSIVE' });
    const before = JSON.stringify(r1);
    owner.configuration.current = { ...fixture.configuration, configurationRevision: 'r3e-checks-config-2' };
    const request = reverifyRequest(r1, 'r3e-reverify-1', { reason: 'operator: check the work again' });
    const result = await owner.evidence.reverifyRound!(fixture.ctx, request);
    const r2 = reverified(result);
    expect(r2).toMatchObject({ revision: 1, status: 'open', outcome: null, subject: fixture.subject, subjectRunRef: fixture.subjectRunRef,
      executor: R3E_HOST, configuration: { configurationRevision: 'r3e-checks-config-2' },
      ref: { ...r1.ref, roundId: expect.any(String) } });
    expect(r2.ref.roundId).not.toBe(r1.ref.roundId);
    expect(r2.checks.every(check => check.phase === 'pending')).toBe(true);
    expect(r2.chain).toMatchObject({ ordinal: 2, predecessorRoundRef: r1.ref, predecessorRevision: r1.revision,
      supersededEvidenceIds: chainEvidenceIds(r1), autoCount: 0,
      reverify: { requestedBy: R3E_HOST, actorClass: 'human', failureClass: 'check_incomplete', exemption: 'none',
        sourceChanged: false, newInputRefs: [], reason: 'operator: check the work again' } });
    expect(r2.chain?.basisDigests).toEqual([r2.chain?.reverify?.basis.digest]);
    // VR-15: the predecessor is not written; the reads follow the new head.
    expect(JSON.stringify(await latest(fixture, r1.ref))).toBe(before);
    const subject = { subject: fixture.subject, subjectRunRef: fixture.subjectRunRef };
    expect(await fixture.evidence.queryRoundChainHead!(fixture.ctx, subject)).toEqual({ status: 'ready', value: r2 });
    expect(await fixture.evidence.queryOriginalVerification!(fixture.ctx, subject)).toEqual({ status: 'ready', value: r2 });
    // TASK-29: the Task follows the open successor head (P12 with its ordinal).
    expect(await workRow(fixture)).toMatchObject({ effectivePhase: 'verifying',
      phaseCause: { code: 'verification_running', detail: { ordinal: 2, predecessorRoundRef: r1.ref } } });
    // The same request replays the original value; another request on the old head names the new head.
    expect(await owner.evidence.reverifyRound!(fixture.ctx, request))
      .toEqual({ ...result, replayed: true });
    expect(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r1, 'r3e-reverify-old-head')))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict', current: [{ ref: r2.ref, revision: 1 }] });
    // VD-1: the subject still takes no second root.
    expect(await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest()))
      .toMatchObject({ status: 'rejected', code: 'busy', current: [{ ref: r2.ref, revision: 1 }] });
    // An open head: finalize first.
    expect(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r2, 'r3e-reverify-open')))
      .toMatchObject({ status: 'rejected', code: 'busy', reason: expect.stringMatching(/^finalize_first: /) });
  }, 60_000);

  it('VD-5: R1 FAIL, the file changes, R2 PASS completes the Task without R1\'s blocking evidence', async () => {
    const fixture = await openFixture(kind);
    const owner = reverifier(fixture, 'fail');
    const r1 = await finish(fixture, (await open(fixture)).ref, 1);
    expect(r1).toMatchObject({ outcome: 'FAIL' });
    expect(await workRow(fixture)).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' } });
    const goal = async () => {
      const read = await fixture.b2.base.plans.queryGoal(fixture.ctx, fixture.goalRef);
      if (read.status !== 'ready') throw Error('the Goal must be readable');
      return read.value.goal;
    };
    const complete = async (roundRef: RoundSnapshot['ref'], requestId: string) => fixture.b2.base.goals.completeTask(fixture.ctx, {
      input: { taskRef: fixture.subject, planRef: fixture.planRef, roundRef }, meta: { requestId, expected: [
        { ref: fixture.goalRef, revision: (await goal()).revision },
        { ref: { aggregateType: 'TaskReduction', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId,
          taskId: R3E_WORK_TASK_ID }, revision: 0 }] } });
    expect(await complete(r1.ref, 'r3e-complete-fail')).toMatchObject({ status: 'rejected', code: 'incomplete' });
    // ND-9: the predecessor's own check report is never a new basis.
    const report = r1.checks[0]!.reportRef!;
    expect(report.contentType).toBe(REPORT_CONTENT_TYPE);
    expect(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r1, 'r3e-own-report',
      { newInputRefs: [{ kind: 'artifact', ref: report }] }))).toMatchObject({ status: 'rejected', code: 'invalid' });
    await changeSource(fixture, 'r3e verification source v2 (fixed)\n');
    const r2 = reverified(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r1, 'r3e-reverify-fixed')));
    expect(r2.chain).toMatchObject({ ordinal: 2, supersededEvidenceIds: chainEvidenceIds(r1),
      reverify: { failureClass: 'check_failed', sourceChanged: true } });
    expect(chainEvidenceIds(r1).length).toBeGreaterThan(0);
    const passed = await finish(fixture, r2.ref, 0);
    expect(passed).toMatchObject({ outcome: 'PASS', gaps: [] });
    const completed = await complete(passed.ref, 'r3e-complete-pass');
    if (completed.status !== 'committed') throw Error(`the successor PASS must complete the Task: ${JSON.stringify(completed)}`);
    expect(completed.value.blockingEvidenceIds).toEqual([]);
    for (const id of chainEvidenceIds(r1)) expect(completed.value.effectiveEvidenceIds).not.toContain(id);
    expect(await workRow(fixture)).toMatchObject({ effectivePhase: 'satisfied' });
  }, 60_000);

  it('§13.7: the cap (before any capture), no_new_basis, a note, source_unchanged and verification_uncovered are committed refusals', async () => {
    const fixture = await openFixture(kind);
    const owner = reverifier(fixture, 'policy');
    const automation = hostCtx(fixture, { ...WORKFLOW_AUTOMATION_ACTOR });
    const r1 = await finish(fixture, (await open(fixture)).ref, null);
    const refusalKey = taskReworkRefusalRefKey(refusalRefOf(r1));

    // Step 7: an automatic request over the cap writes TaskReworkRefusal@1 and captures nothing.
    owner.policy.current = { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: false };
    const capRequest = reverifyRequest(r1, 'r3e-cap-1');
    const capped = await owner.evidence.reverifyRound!(automation, capRequest);
    expect(capped).toMatchObject({ status: 'committed', replayed: false, value: { kind: 'refused', refusal: {
      ref: refusalRefOf(r1), revision: 1, code: 'auto_rework_cap_reached', failureClass: 'check_incomplete', basisDigest: null,
      source: null, configurationRevision: null, requestedBy: WORKFLOW_AUTOMATION_ACTOR, subjectRoundRef: r1.ref,
      afterRunRef: fixture.subjectRunRef, goalEndedRunsAtRefusal: 1 } } });
    expect(owner.captures()).toBe(0);
    expect(await owner.evidence.reverifyRound!(automation, capRequest)).toEqual({ ...capped, replayed: true });
    // A stale refusal pin conflicts; the current one writes @2.
    expect(await owner.evidence.reverifyRound!(automation, reverifyRequest(r1, 'r3e-cap-stale', {}, 0)))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict', current: [{ ref: refusalRefOf(r1), revision: 1 }] });
    expect(await owner.evidence.reverifyRound!(automation, reverifyRequest(r1, 'r3e-cap-2', {}, 1)))
      .toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { revision: 2, code: 'auto_rework_cap_reached' } } });
    expect(await exists(fixture, refusalKey)).toBe(2);
    // A non-human note is invalid (step 5), 0 commit.
    owner.policy.current = { ...DEFAULT_TASK_AUTOMATION_POLICY };
    expect(await owner.evidence.reverifyRound!(automation, reverifyRequest(r1, 'r3e-system-note', { note: 'not mine' })))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await exists(fixture, refusalKey)).toBe(2);

    // The first reverify on the chain passes; the same failure, source and configuration again is no_new_basis.
    const r2 = reverified(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r1, 'r3e-first', {}, 2)));
    const r2Final = await finish(fixture, r2.ref, null);
    const noBasis = await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r2Final, 'r3e-same-key'));
    expect(noBasis).toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { ref: refusalRefOf(r2Final), revision: 1,
      code: 'no_new_basis', basisDigest: r2.chain?.reverify?.basis.digest, configurationRevision: fixture.configuration.configurationRevision,
      source: { sourceDigest: r1.identity.sourceDigest }, reason: expect.stringMatching(/opened round 2 of this chain/) } } });
    // The read model shows it on the failure facts (no configuration resolver here: stale only by Run ends).
    expect(await workRow(fixture)).toMatchObject({ failure: { automation: {
      lastReverifyRefusal: { code: 'no_new_basis', revision: 1, stale: false } } } });
    // "附上说明作为新依据": the human note is stored and joins the new inputs.
    const r3 = reverified(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r2Final, 'r3e-note',
      { note: 'the runner was saturated; nothing in the work changed' }, 1)));
    expect(r3.chain?.reverify?.newInputRefs).toEqual([{ kind: 'artifact',
      ref: expect.objectContaining({ contentType: 'text/plain; charset=utf-8' }) }]);
    // The same note again under the same facts is the same key.
    const r3Final = await finish(fixture, r3.ref, null);
    expect(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r3Final, 'r3e-note-again',
      { note: 'the runner was saturated; nothing in the work changed' }))).toMatchObject({ status: 'committed',
      value: { kind: 'refused', refusal: { code: 'no_new_basis' } } });
    // onlyIfSourceChanged with the source unchanged and no exemption.
    expect(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r3Final, 'r3e-unchanged',
      { onlyIfSourceChanged: true }, 1))).toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { revision: 2,
      code: 'source_unchanged', configurationRevision: null, source: { sourceDigest: r1.identity.sourceDigest } } } });
    // No registered check covers the requirement: refused for a human too, storing the configuration revision.
    owner.configuration.current = { ...fixture.configuration, configurationRevision: 'r3e-checks-dynamic',
      checks: fixture.configuration.checks.map(check => ({ ...check, kind: 'dynamic' as const })) };
    expect(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r3Final, 'r3e-uncovered', {}, 2)))
      .toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { revision: 3, code: 'verification_uncovered',
        configurationRevision: 'r3e-checks-dynamic' } } });
    // A covering configuration (a new revision) admits the successor.
    owner.configuration.current = { ...fixture.configuration, configurationRevision: 'r3e-checks-config-3' };
    expect(reverified(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r3Final, 'r3e-covered', {}, 3))))
      .toMatchObject({ chain: { ordinal: 4 }, configuration: { configurationRevision: 'r3e-checks-config-3' } });
  }, 120_000);

  it('VD-15: a FAIL gate head is source_unchanged until the work changes, then its successor stays on the anchored producer', async () => {
    const fixture = await openFixture(kind);
    const owner = reverifier(fixture, 'gate');
    const g1 = await finish(fixture, (await open(fixture, true)).ref, 1);
    expect(g1).toMatchObject({ outcome: 'FAIL', subject: { taskId: R3E_GATE_TASK_ID }, subjectRunRef: fixture.subjectRunRef });
    // "重新验收" with the gate-fix condition: nothing changed.
    expect(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(g1, 'r3e-gate-unchanged', { onlyIfSourceChanged: true })))
      .toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { code: 'source_unchanged',
        ref: { taskId: R3E_GATE_TASK_ID, operation: 'reverify', subjectId: g1.ref.roundId } } } });
    await changeSource(fixture, 'r3e verification source v3 (gate fix)\n');
    const g2 = reverified(await owner.evidence.reverifyRound!(fixture.ctx,
      reverifyRequest(g1, 'r3e-gate-fixed', { onlyIfSourceChanged: true }, 1)));
    expect(g2).toMatchObject({ subject: { taskId: R3E_GATE_TASK_ID }, subjectRunRef: fixture.subjectRunRef,
      ref: { taskId: R3E_GATE_TASK_ID, runId: fixture.subjectRunRef.runId }, identity: { scope: { gateSubject: 'goal' } },
      chain: { ordinal: 2, reverify: { failureClass: 'check_failed', sourceChanged: true } } });
    expect(await fixture.evidence.queryRoundChainHead!(fixture.ctx, { subject: g1.subject, subjectRunRef: null }))
      .toEqual({ status: 'ready', value: g2 });
    // The gate still takes no second root on any producer (VD-15).
    expect(await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest({
      subject: { ...fixture.subject, taskId: R3E_GATE_TASK_ID }, gateSubject: 'goal' })))
      .toMatchObject({ status: 'rejected', code: 'busy', current: [{ ref: g2.ref, revision: 1 }] });
  }, 60_000);
});

it('a legacy slot-less root is reverified null → successor; a second legacy root makes the chain invalid (incomplete)', async () => {
  // A finalized INCONCLUSIVE round of another fixture is the template of a pre-A.2 root: no chain, no slot.
  const template = await openFixture();
  const finalized = await finish(template, (await open(template)).ref, null);
  const fixture = await openFixture();
  const owner = reverifier(fixture, 'legacy');
  const root: RoundSnapshot = { ...finalized, subject: { ...fixture.subject }, subjectRunRef: { ...fixture.subjectRunRef },
    ref: { ...finalized.ref, projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId,
      goalId: fixture.goalRef.goalId, taskId: fixture.subject.taskId, runId: fixture.subjectRunRef.runId, roundId: 'r3e-legacy-root' } };
  delete root.chain;
  expect(await fixture.b2.base.commitRaw([encodeVerificationRoundSnapshot(root)])).toMatchObject({ status: 'committed' });
  const next = reverified(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(root, 'r3e-legacy')));
  expect(next.chain).toMatchObject({ ordinal: 2, predecessorRoundRef: root.ref, supersededEvidenceIds: chainEvidenceIds(root) });
  // The slot moved null → successor: a fresh root on the subject is busy with the new head.
  expect(await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest()))
    .toMatchObject({ status: 'rejected', code: 'busy', current: [{ ref: next.ref, revision: 1 }] });
  // A second slot-less root on the same subject: two roots, no head.
  const second: RoundSnapshot = { ...root, ref: { ...root.ref, roundId: 'r3e-legacy-root-2' } };
  expect(await fixture.b2.base.commitRaw([encodeVerificationRoundSnapshot(second)])).toMatchObject({ status: 'committed' });
  expect(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(second, 'r3e-two-roots')))
    .toMatchObject({ status: 'rejected', code: 'incomplete' });
}, 60_000);

it.each(KINDS)('%s: two reverifies of one head, and a reverify racing a requeue of it, commit exactly once', async (kind) => {
  const fixture = await openFixture(kind);
  const r1 = await finish(fixture, (await open(fixture)).ref, 1);
  // Two operators reverify the same FAIL head; both reach the store together.
  let race = synchronizeB2Commits(fixture.records);
  const raced = (tag: string) => {
    let sequence = 0;
    return createEvidenceService({ records: race.records, materials: fixture.materials, materialFacts: fixture.materialFacts,
      executions: createRunStateReader({ records: fixture.records }), workspaceHost: fixture.workspaceHost,
      source: new VerificationWorkspaceReader(), configuration: fixture.configuration, now: () => B2_AT,
      newId: () => `r3e-race-${tag}-${++sequence}` });
  };
  const both = await Promise.all([raced('a').reverifyRound!(fixture.ctx, reverifyRequest(r1, 'r3e-race-a')),
    raced('b').reverifyRound!(fixture.ctx, reverifyRequest(r1, 'r3e-race-b'))]);
  expect(race.arrivals()).toBe(2);
  const winners = both.filter(result => result.status === 'committed');
  expect(winners).toHaveLength(1);
  const winner = reverified(winners[0]!);
  expect(both.find(result => result.status !== 'committed'))
    .toMatchObject({ status: 'rejected', code: 'revision_conflict', current: [{ ref: winner.ref, revision: 1 }] });

  // A requeue and a reverify of the next FAIL head race on its slot (VR-09 same owner vs VR-14 head → successor).
  // The work changed, so the reverify key is new and the reverify opens a successor (a refusal racing a
  // requeue is the next test).
  const r2 = await finish(fixture, winner.ref, 1);
  await changeSource(fixture, 'r3e verification source v2 (race)\n');
  race = synchronizeB2Commits(fixture.records);
  const requeue = requeueOwner(fixture, race.records, 'race');
  const [requeued, reverifiedAgain] = await Promise.all([
    requeue.requeueTask(fixture.ctx, await requeueRequest(fixture, 'r3e-race-requeue')),
    raced('c').reverifyRound!(fixture.ctx, reverifyRequest(r2, 'r3e-race-c')),
  ]);
  expect(race.arrivals()).toBe(2);
  expect([requeued, reverifiedAgain].filter(result => result.status === 'committed')).toHaveLength(1);
  const requeueKey = taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId: fixture.subjectRunRef.projectId,
    goalId: fixture.subjectRunRef.goalId, taskId: fixture.subject.taskId, afterRunId: fixture.subjectRunRef.runId });
  if (requeued.status === 'committed') {
    expect(reverifiedAgain).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await exists(fixture, requeueKey)).toBe(1);
    expect(await chainHead(fixture)).toEqual({ status: 'ready', value: r2 });
  } else {
    expect(requeued).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await exists(fixture, requeueKey)).toBeNull();
    expect(reverified(reverifiedAgain).chain).toMatchObject({ ordinal: 3 });
  }
}, 60_000);

it.each(KINDS.flatMap(kind => (['refusal', 'requeue'] as const).map(first => [kind, first] as const)))(
  '%s: §13.2 point 5: a reverify refusal and a requeue of one head both read before either commits; the %s commits first, the other is revision_conflict',
  async (kind, first) => {
    const fixture = await openFixture(kind);
    const r1 = await finish(fixture, (await open(fixture)).ref, 1);
    // Nothing changed, so the reverify asking `onlyIfSourceChanged` is the refusal `source_unchanged`, which holds
    // the head's slot with the same owner (no slot conflict with the requeue's VR-09 claim). The requeue guards the
    // head's reverify refusal record as read; the refusal guards the absent TaskRequeue.
    const order = orderedCommits(fixture);
    const owner = reverifier(fixture, `refusal-${first}`, { records: first === 'refusal' ? order.first : order.second });
    const requeue = requeueOwner(fixture, first === 'requeue' ? order.first : order.second, `refusal-${first}`);
    const requeueInput = await requeueRequest(fixture, `r3e-refusal-${first}-requeue`);
    const [requeued, refused] = await Promise.all([requeue.requeueTask(fixture.ctx, requeueInput),
      owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r1, `r3e-refusal-${first}`, { onlyIfSourceChanged: true }))]);
    const requeueKey = taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId: fixture.subjectRunRef.projectId,
      goalId: fixture.subjectRunRef.goalId, taskId: fixture.subject.taskId, afterRunId: fixture.subjectRunRef.runId });
    const refusalKey = taskReworkRefusalRefKey(refusalRefOf(r1));
    if (first === 'requeue') {
      expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { afterRoundRef: r1.ref } } });
      expect(refused).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(await exists(fixture, requeueKey)).toBe(1);
      expect(await exists(fixture, refusalKey)).toBeNull();
    } else {
      expect(refused).toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { code: 'source_unchanged', revision: 1 } } });
      expect(requeued).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(await exists(fixture, requeueKey)).toBeNull();
      // A refusal committed before the requeue reads does not stop the requeue (it guards the record as read).
      const later = await requeueOwner(fixture, fixture.records, 'refusal-later')
        .requeueTask(fixture.ctx, await requeueRequest(fixture, 'r3e-refusal-later-requeue'));
      expect(later).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { afterRoundRef: r1.ref } } });
      expect(await exists(fixture, refusalKey)).toBe(1);
    }
    expect(await chainHead(fixture)).toEqual({ status: 'ready', value: r1 });
  }, 60_000);

it('I-12 (C5): a requeue after a successor names the chain head and supersedes the whole chain; the head then refuses a successor', async () => {
  const fixture = await openFixture();
  const owner = reverifier(fixture, 'i12');
  const r1 = await finish(fixture, (await open(fixture)).ref, 1);
  await changeSource(fixture, 'r3e verification source v2 (still failing)\n');
  const r2 = await finish(fixture, reverified(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r1, 'r3e-i12-r2'))).ref, 1);
  expect(r2).toMatchObject({ outcome: 'FAIL', chain: { ordinal: 2 } });
  const requeued = await requeueOwner(fixture, fixture.records, 'i12')
    .requeueTask(fixture.ctx, await requeueRequest(fixture, 'r3e-i12-requeue'));
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw Error(`the requeue must commit: ${JSON.stringify(requeued)}`);
  // I-12 (C5): `afterRoundRef` is the chain head and `supersededEvidenceIds` the whole chain, ancestors first.
  expect(requeued.value.requeue).toMatchObject({ afterRoundRef: r2.ref, supersededEvidenceIds: chainEvidenceIds(r2),
    failureClass: 'check_failed' });
  expect(chainEvidenceIds(r2).slice(0, chainEvidenceIds(r1).length)).toEqual(chainEvidenceIds(r1));
  // §9.4: a reverify of a requeued subject Run names the TaskRequeue@1 (the new Run opens its own chain).
  expect(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r2, 'r3e-i12-after-requeue'))).toMatchObject({
    status: 'rejected', code: 'revision_conflict', current: [{ ref: requeued.value.requeue.ref, revision: 1 }] });
}, 60_000);

it('steps 4–5 (§13.2 point 4, VD-9): a paused or a cancelled Goal answers busy to the operator and the automation; after the resume the operator opens the successor', async () => {
  const fixture = await openFixture();
  const owner = reverifier(fixture, 'goal');
  const callers = [['operator', fixture.ctx], ['automation', hostCtx(fixture, { ...WORKFLOW_AUTOMATION_ACTOR })]] as const;
  const r1 = await finish(fixture, (await open(fixture)).ref, null);
  // The 5.5 owner pauses the Goal: every rework waits for the resume, nothing is written or captured.
  await goalControl(fixture, 'pause', 'r3e-goal-pause');
  for (const [tag, caller] of callers) {
    expect(await owner.evidence.reverifyRound!(caller, reverifyRequest(r1, `r3e-goal-paused-${tag}`)), tag)
      .toMatchObject({ status: 'rejected', code: 'busy', reason: 'the Goal is paused; resume the Goal first' });
  }
  expect(await exists(fixture, taskReworkRefusalRefKey(refusalRefOf(r1)))).toBeNull();
  expect(owner.captures()).toBe(0);
  expect(await chainHead(fixture)).toEqual({ status: 'ready', value: r1 });
  // After the operator's resume the operator's reverify opens the successor.
  await goalControl(fixture, 'resume', 'r3e-goal-resume');
  const r2 = reverified(await owner.evidence.reverifyRound!(fixture.ctx, reverifyRequest(r1, 'r3e-goal-resumed')));
  expect(r2.chain).toMatchObject({ ordinal: 2, reverify: { actorClass: 'human' } });
  // A cancelled Goal: the same answer for both, nothing written.
  const r2Final = await finish(fixture, r2.ref, null);
  await goalControl(fixture, 'cancel', 'r3e-goal-cancel');
  const captured = owner.captures();
  for (const [tag, caller] of callers) {
    expect(await owner.evidence.reverifyRound!(caller, reverifyRequest(r2Final, `r3e-goal-cancelled-${tag}`)), tag)
      .toMatchObject({ status: 'rejected', code: 'busy', reason: 'the Goal is cancelled; resume the Goal first' });
  }
  expect(await exists(fixture, taskReworkRefusalRefKey(refusalRefOf(r2Final)))).toBeNull();
  expect(owner.captures()).toBe(captured);
  expect(await chainHead(fixture)).toEqual({ status: 'ready', value: r2Final });
}, 60_000);

it.each(KINDS)('%s: step 9 asks the Host grant as the configured executor; a Workspace write before the commit writes nothing', async (kind) => {
  const fixture = await openFixture(kind);
  const operator = { kind: 'human' as const, id: 'r3e-second-operator' };
  const asked: unknown[] = [];
  const workspace = { revision: 1 };
  const workspaceHost: WorkspaceHostBindings = {
    async resolveRoot(target) {
      const resolved = await fixture.workspaceHost.resolveRoot(target);
      return resolved.status !== 'ready' ? resolved
        : { status: 'ready', value: { ...resolved.value, workspaceRevision: workspace.revision } };
    },
    async authorize(ctx, target) {
      asked.push(structuredClone(ctx.principal));
      return fixture.workspaceHost.authorize(ctx, target);
    },
  };
  // Another writer moves the Workspace after the capture, just before the reverify commits.
  const owner = reverifier(fixture, 'executor', { workspaceHost, records: beforeReverifyCommit(fixture, async () => {
    await bumpWorkspace(fixture);
    workspace.revision += 1;
  }) });
  const r1 = await finish(fixture, (await open(fixture)).ref, null);
  const request = reverifyRequest(r1, 'r3e-second-operator');
  expect(await owner.evidence.reverifyRound!(hostCtx(fixture, operator), request))
    .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(await chainHead(fixture)).toEqual({ status: 'ready', value: r1 });
  expect(await exists(fixture, taskReworkRefusalRefKey(refusalRefOf(r1)))).toBeNull();
  // The same request again reads the new Workspace revision and opens the successor.
  const r2 = reverified(await owner.evidence.reverifyRound!(hostCtx(fixture, operator), request));
  expect(r2).toMatchObject({ executor: R3E_HOST, identity: { workspaceRevision: 2 },
    chain: { ordinal: 2, reverify: { actorClass: 'human', requestedBy: operator } } });
  // VD-12: the grant was asked as the configured executor both times, never as the requester or a platform reader.
  expect(asked).toEqual([{ kind: 'host', actor: R3E_HOST }, { kind: 'host', actor: R3E_HOST }]);
}, 60_000);

// -------------------------------------------------------------------------- //
// VR-14 step 2: the Agent admission (TD-6, GAP-46: no production Role grants it) //
// -------------------------------------------------------------------------- //

/** A W16 future adoption adding one claimable optional work Task (with its assignment) to the R3e Goal. */
async function adoptAgentTask(fixture: R3eEvidenceFixture): Promise<PlanRevisionSnapshot> {
  const plan = fixture.plan;
  const goalNow = await fixture.b2.base.plans.queryGoal(fixture.ctx, fixture.goalRef);
  if (goalNow.status !== 'ready') throw Error('the Goal must be readable');
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 'r3e-plan-agent', planRevision: plan.planRevision + 1, goalId: fixture.goalRef.goalId,
    stages: structuredClone(plan.stages), tasks: [...structuredClone(plan.tasks), { taskId: 'r3e-agent-work',
      title: 'Agent work', requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
      scope: { kind: 'goal' }, executionIntent: 'request_execution' }],
    assignments: [...structuredClone(plan.assignments ?? []), { taskId: 'r3e-agent-work', role: 'builder', instruction: 'Agent work' }],
    obligations: structuredClone(plan.obligations), taskHierarchy: structuredClone(plan.taskHierarchy),
    executionDag: structuredClone(plan.executionDag),
    taskRelations: plan.schemaVersion === 2 ? structuredClone(plan.taskRelations ?? []) : [],
    inputRequirements: plan.schemaVersion === 2 ? structuredClone(plan.inputRequirements ?? []) : [],
  };
  const expected = [{ ref: fixture.goalRef, revision: goalNow.value.goal.revision }];
  const proposed = await fixture.b2.base.plans.proposePlan(fixture.ctx, { meta: { requestId: 'r3e-agent-propose', expected },
    input: { goalRef: fixture.goalRef, basedOn: plan.ref, draft, reason: { text: 'an Agent task', sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw Error(`agent task proposal failed: ${JSON.stringify(proposed)}`);
  const applied = await fixture.b2.base.plans.applyPlanChange(fixture.ctx, { meta: { requestId: 'r3e-agent-apply', expected },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw Error(`agent task adoption failed: ${JSON.stringify(applied)}`);
  return applied.value;
}

it('an entered Agent of the same Goal with the reverify_round grant opens a successor; others are refused', async () => {
  const fixture = await openFixture();
  const b2 = fixture.b2;
  const base = b2.base;
  let sequence = 0;
  const now = () => B2_AT;
  const eventId = () => `r3e-agent-event-${++sequence}`;
  const reads = createRunStateReader({ records: fixture.records });
  const roles = createRoleConfigurationService({ records: fixture.records, now, eventId });
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    if (ctx.projectId !== base.scope.projectId || input.configurationRevision !== B2_HOST.configurationRevision
      || ![B2_HOST.permissions, GRANT].some(permissions => key(permissions) === key(input.permissions))) {
      return { status: 'rejected', code: 'forbidden', reason: 'the test Host does not authorize this configuration' };
    }
    return { status: 'ready', value: { configurationRevision: B2_HOST.configurationRevision,
      permissions: structuredClone(input.permissions), hostTemplate: structuredClone(B2_HOST.hostTemplate) } };
  };
  const entry = createExecutionEntryService({ records: fixture.records, reads, roles, bodies: b2.bodies, materials: fixture.materials,
    authorizeConfiguration, now, eventId, newId: () => `r3e-agent-entry-${++sequence}` });
  const enterAgent = async (claim: TaskClaim, kernelRunId: string):
  Promise<{ run: RunSnapshot; permit: TaskEntryPermit; kernel: KernelExecutionBinding }> => {
    const prepared = await b2.buildPrepared({ claim, permissions: GRANT });
    const facts = await b2.read(claim);
    const kernel: KernelExecutionBinding = { adapterId: facts.session.kernel.adapterId,
      kernelSessionId: facts.session.kernel.kernelSessionId, runId: kernelRunId, turnId: `${kernelRunId}-turn` };
    const authorized = await entry.authorizeRuntimeEntry(base.ctx, { input: { prepared, consumerId: `consumer-${kernelRunId}` },
      meta: { requestId: `${kernelRunId}-authorize`, expected: [await b2.pin(claim)] } });
    if (authorized.status !== 'committed') throw Error(`agent authorize failed: ${JSON.stringify(authorized)}`);
    const begun = await entry.beginRuntimeEntry(base.ctx, { input: { permit: authorized.value, kernel },
      meta: { requestId: `${kernelRunId}-begin`, expected: [await b2.pin(claim)] } });
    if (begun.status !== 'committed') throw Error(`agent begin failed: ${JSON.stringify(begun)}`);
    const entered = await entry.recordExecutionEntered(base.ctx, {
      input: { permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
        enteredAt: B2_AT, kernelSource: { ...kernel, position: 3 },
        history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: `${kernelRunId}-entered`, expected: [await b2.pin(claim)] } });
    if (entered.status !== 'committed') throw Error(`agent entered failed: ${JSON.stringify(entered)}`);
    return { run: (await b2.read(claim)).run, permit: authorized.value, kernel };
  };
  const workCtx = (claim: TaskClaim, run: RunSnapshot): CoreCallContext => ({ projectId: base.scope.projectId,
    workspaceId: claim.workspaceId, principal: { kind: 'work_run', runRef: claim.runRef, roleBinding: run.roleBinding },
    materialReader: { kind: 'run', requester: claim.runRef }, signal: new AbortController().signal });
  const owner = reverifier(fixture, 'agent', { delegatedWrites: { reads, roles, bodies: b2.bodies, authorizeConfiguration } });
  const r1 = await finish(fixture, (await open(fixture)).ref, null);

  // The same Goal: a new claimable work Task, claimed in its own Session and entered under the grant.
  const plan = await adoptAgentTask(fixture);
  const session = await base.createSession('r3e-agent-session');
  const goalRead = await base.plans.queryGoal(fixture.ctx, fixture.goalRef);
  const card = await base.sessionsPort.readSession(fixture.ctx, session);
  if (goalRead.status !== 'ready' || card.status !== 'ready') throw Error('the Goal and the Session must be readable');
  const claimed = await base.service.claimTask(fixture.ctx, { input: { goalRef: fixture.goalRef, planRef: plan.ref,
    taskId: 'r3e-agent-work', sessionRef: session, roleBinding: base.roleBinding, budget: base.budget },
    meta: { requestId: 'r3e-agent-claim', expected: [{ ref: fixture.goalRef, revision: goalRead.value.goal.revision },
      { ref: fixture.workspaceRef, revision: 1 }, { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision }] } });
  if (claimed.status !== 'committed') throw Error(`agent claim failed: ${JSON.stringify(claimed)}`);
  const agentEntry = await enterAgent(claimed.value, 'r3e-agent-kernel');
  const agentRun = agentEntry.run;
  expect(agentRun).toMatchObject({ status: 'running', envelope: { permissions: GRANT } });
  const agent = workCtx(claimed.value, agentRun);

  // Without the admission seam the Host refuses every Agent; an Agent never attaches a note.
  expect(await reverifier(fixture, 'no-seam').evidence.reverifyRound!(agent, reverifyRequest(r1, 'r3e-agent-no-seam')))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(await owner.evidence.reverifyRound!(agent, reverifyRequest(r1, 'r3e-agent-note', { note: 'mine' })))
    .toMatchObject({ status: 'rejected', code: 'invalid' });
  // Another Goal's Agent (the B2 base Goal's Run, entered) reworks nothing here.
  await b2.enter();
  const other = workCtx(b2.claim, (await b2.read(b2.claim)).run);
  expect(await owner.evidence.reverifyRound!(other, reverifyRequest(r1, 'r3e-agent-other-goal')))
    .toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'an Agent reworks only Tasks of its own Goal' });
  expect(await exists(fixture, taskReworkRefusalRefKey(refusalRefOf(r1)))).toBeNull();

  const result = await owner.evidence.reverifyRound!(agent, reverifyRequest(r1, 'r3e-agent-reverify', { reason: 'the agent checks again' }));
  const r2 = reverified(result);
  expect(r2.chain).toMatchObject({ ordinal: 2, autoCount: 1, reverify: { actorClass: 'agent',
    requestedBy: { kind: 'agent', runRef: claimed.value.runRef }, reason: 'the agent checks again' } });
  // The event actor is the Host identity that committed it (the configured executor), never the Agent.
  if (result.status !== 'committed') throw Error('the Agent reverify must commit');
  const at = await fixture.records.eventAt(result.cursor);
  if (at.status !== 'ready') throw Error('the reverify event must be readable');
  expect(at.value.event.eventType).toBe(VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE);
  expect(JSON.parse(at.value.event.json)).toMatchObject({ actor: R3E_HOST, roundRef: r2.ref });
  expect(r2.executor).toEqual(R3E_HOST);
  expect(await owner.evidence.reverifyRound!(agent, reverifyRequest(r1, 'r3e-agent-reverify', { reason: 'the agent checks again' })))
    .toMatchObject({ status: 'committed', replayed: true, value: { kind: 'reverified', round: { ref: r2.ref } } });

  // VR-14 step 12: the commit guards the admission it read. The Agent's Run ends (its Turn completes) after the
  // admission and before the commit: nothing is written, and the head stays the finalized successor.
  const r2Final = await finish(fixture, r2.ref, null);
  const ending = reverifier(fixture, 'agent-ended', { delegatedWrites: { reads, roles, bodies: b2.bodies, authorizeConfiguration },
    records: beforeReverifyCommit(fixture, async () => {
      const claim = claimed.value;
      const ended = await entry.recordRunResult(base.ctx, { input: { claim,
        entry: { consumerId: agentEntry.permit.consumerId, entryGeneration: agentEntry.permit.entryGeneration },
        event: { eventType: 'run_completed', schemaVersion: 1, eventId: 'r3e-agent-completed', runRef: claim.runRef, sequence: 2,
          occurredAt: B2_AT, payload: { kind: 'completed', exitCode: 0 } },
        kernelSource: { ...agentEntry.kernel, position: 4 },
        completedHistoryBoundary: { source: { ...agentEntry.kernel, position: 4 }, cursor: 'r3e-agent-completed-boundary-4' },
        history: { kernel: agentEntry.kernel, startPosition: 2, observedThroughPosition: 4, endPosition: 4 } },
        meta: { requestId: 'r3e-agent-terminal', expected: [await b2.pin(claim)] } });
      if (ended.status !== 'committed' || ended.value.status !== 'ended') throw Error(`the Agent Run must end: ${JSON.stringify(ended)}`);
    }) });
  expect(await ending.evidence.reverifyRound!(agent, reverifyRequest(r2Final, 'r3e-agent-ended')))
    .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(await exists(fixture, taskReworkRefusalRefKey(refusalRefOf(r2Final)))).toBeNull();
  expect(await chainHead(fixture)).toEqual({ status: 'ready', value: r2Final });
  // Asked again, the ended Run is no longer admitted at all.
  expect(await owner.evidence.reverifyRound!(agent, reverifyRequest(r2Final, 'r3e-agent-after-end')))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
}, 120_000);
