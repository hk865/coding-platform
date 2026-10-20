/**
 * K3-41 (一)(二)(三) (L19/L21/D9, L29 row 13): a human-stopped original Run.
 *
 * The Host restart reconciles the paused Run `crashed`/`interrupted_clean` with
 * its pause pointer (RUN-24); the person attests it (RUN-22 creates the review
 * record), directly holds it, then clicks "continue" (`release-hold`). Because
 * the original Run's rework fence is human, the route calls `releaseHold` and
 * then the same operator's human `requeueTask` (afterRun R), and the next drive
 * claims exactly one continuation. (三) parameterizes the two preconditions of
 * that window: a real Host crash after the `releaseHold` commit and before the
 * requeue, and a Goal pause that makes the requeue `busy` until the Goal
 * resumes. In both the record is already `released`, the same request replays
 * `releaseHold`, and exactly one requeue/continuation is committed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { DecisionSelectionV1 } from '../../src/contracts/goal-decisions.js';
import { continuationBriefDigest, renderContinuationBriefZh,
  type ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ResolveDecisionReadV1 } from '../../src/business/workflow/contracts.js';
import { createGoalFanOutDriver, type GoalControlOutcomeV1, type GoalControlPort } from '../../src/app/goal-fan-out-driver.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest, type CoreRoutePlatform,
} from '../../src/app/core-routes.js';
import type { UnknownCallReviewReleaseHoldValue } from '../../src/app/core-http-types.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { readCanonicalTaskFacts, readGoalPhase, readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import { AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain, startAG2bHost, type AG2bHost } from '../helpers/AG2b-collaboration-fixture.js';
import {
  goalControlPins, moveKernelAside, post, publicDirectory, readExecution, restoreKernel, selectWork, tempDir, workRow,
} from '../helpers/A2-restart-fixture.js';
import type { TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-proposal-round.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { GOAL_B, PLAN_B2, WORKSPACE, WORKSPACE_REVISION } from '../helpers/S5-decision-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupScenarios, HostScenario, hostCtx, performs, type InvariantTarget, type ScenarioCommitGate } from '../scenarios/harness.js';
import {
  driveChecked, operatorRequeue, pausedRunOnClosedHostChecked, preparedOf, redrivePolicy, textReply,
} from '../scenarios/support/common.js';
import { openShellWorkRoot, prepareOn } from '../scenarios/support/shell-work-root.js';

// §5.1's stand-in `shell`, hoisted per test file: the real paused Run's one
// process call stays in flight until the Host recognition has read it.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

afterEach(cleanupScenarios);

const ATTEST = 'k3-41-attest';
const HOLD = 'k3-41-hold';
const RELEASE = 'k3-41-release-click';

async function readReview(host: AG2bHost, runRef: TaskExecutionRecord['run']['ref']): Promise<UnknownCallReviewV1> {
  const read = await post<ReadResult<UnknownCallReviewV1>>(host, 'unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
  if (read.status !== 'ready') throw new Error(`the review record must read: ${JSON.stringify(read)}`);
  return read.value;
}

async function holdPersonReview(host: AG2bHost, runRef: TaskExecutionRecord['run']['ref']): Promise<UnknownCallReviewV1> {
  const current = await readReview(host, runRef);
  const held = await post<WriteResult<UnknownCallReviewV1>>(host, 'unknown-call-reviews/hold', graphWrite(AG2B_SCOPE,
    { reviewRef: current.ref, text: null }, HOLD, [{ ref: current.ref, revision: current.revision }]));
  if (held.status !== 'committed') throw new Error(`the hold must commit: ${JSON.stringify(held)}`);
  expect(held.value).toMatchObject({ status: 'resolved', disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } });
  return held.value;
}

/**
 * F-044's real precondition: a `shell` call is in flight on the first Host and
 * the person pauses that Run; the Host is closed cleanly and the Kernel store is
 * moved aside, so the next Host's real RUN-20 startup reconcile books
 * `outcome_unknown` with the pause pointer (RUN-22 then creates the record).
 * Nothing is hand-built.
 */
async function crashedShellReviewRun(h: HostScenario): Promise<{
  prepared: Awaited<ReturnType<typeof preparedOf>>;
  aside: Awaited<ReturnType<typeof moveKernelAside>>;
}> {
  shellSeam.arm();
  const model = createScriptedModel([{ kind: 'calls', calls: [{
    callId: 'k3-41-crash-shell', name: 'shell', args: { command: 'k3-41 crash runs a program' } }] }]);
  const root = await openShellWorkRoot(h, model);
  let running: Promise<unknown> | null = null;
  try {
    const start = await prepareOn(root, h.select('k3-41-crash-a', AG2B_WORK_TASK_ID));
    const prepared = preparedOf(start);
    running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: 'k3-41-crash-a-start' });
    await shellSeam.waitForCall();
    // A real human pause on the in-flight shell Run: its pointer survives the
    // Kernel-unreadable reconcile and makes the Run's rework fence human.
    const current = await root.executions.readExecution(hostCtx(), prepared.claim.runRef);
    if (current.status !== 'ready') throw new Error(`the in-flight Run must read: ${JSON.stringify(current)}`);
    const paused = await root.controls.submitControl(hostCtx(), { input: {
      runRef: prepared.claim.runRef, kind: 'pause', reason: 'the person pauses the stopped work' },
    meta: { requestId: 'k3-41-crash-pause', expected: [{ ref: prepared.claim.runRef, revision: current.value.run.revision }] } });
    expect(paused, JSON.stringify(paused)).toMatchObject({ status: 'committed' });
    // HL-06 close of the first Host; the Kernel store is really moved aside, so
    // the next Host's startup reconcile sees the unknown Turn (RUN-20(i)).
    await h.host.host.close();
    const aside = await moveKernelAside(h.database);
    await h.restart({ invariants: false });
    expect((await readExecution(h.host, prepared.claim.runRef)).run).toMatchObject({
      status: 'ended', outcome: 'outcome_unknown', controlState: { desiredState: 'paused' } });
    return { prepared, aside };
  } finally {
    shellSeam.release();
    await running?.catch(() => undefined);
    await root.close();
  }
}

async function pausedAttestedWorld<T>(label: string,
  afterAttest: (host: AG2bHost, runRef: TaskExecutionRecord['run']['ref']) => Promise<T>): Promise<{
  host: AG2bHost; runRef: TaskExecutionRecord['run']['ref']; result: T; inv: InvariantTarget;
}> {
  const root = await tempDir(`k3-41-${label}-ws-`);
  const database = await tempDir(`k3-41-${label}-db-`);
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const { runRef } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv, 'run');
  const aside = await moveKernelAside(database);
  const second = await startAG2bHost(publicDir, { root, database });
  let result: T;
  try {
    // W-14 / RUN-20(i): the pause pointer survives, the outcome is unknown.
    const unknown = await readExecution(second, runRef);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      controlState: { desiredState: 'paused' } });
    const attested = await post<WriteResult<RunSnapshot>>(second, 'executions/resolve-unknown',
      graphWrite(AG2B_SCOPE, { runRef, reason: 'the person checked the stopped work by hand' }, `${ATTEST}-${label}`,
        [{ ref: runRef, revision: unknown.run.revision }]));
    expect(attested, JSON.stringify(attested)).toMatchObject({ status: 'committed',
      value: { status: 'ended', outcome: 'crashed', reconciliation: { observation: { kind: 'human_attested' } } } });
    result = await afterAttest(second, runRef);
  } finally {
    await second.host.close();
  }
  await restoreKernel(database, aside);
  const host = await startAG2bHost(publicDir, { root, database,
    replies: [textReply(`K3-41 ${label}: the continuation ran`)] });
  return { host, runRef, result, inv };
}

/** The (二)/(三) setup: the record is directly held by the person (`removed` below for (一)). */
async function pausedAttestedAndHeld(label: string): Promise<{
  host: AG2bHost; runRef: TaskExecutionRecord['run']['ref']; held: UnknownCallReviewV1; inv: InvariantTarget;
}> {
  const world = await pausedAttestedWorld(label, (host, runRef) => holdPersonReview(host, runRef));
  return { host: world.host, runRef: world.runRef, held: world.result, inv: world.inv };
}

/** The (一) setup: attested but NOT directly held; the card is answered in the test. */
async function pausedAttestedOpen(label: string): Promise<{
  host: AG2bHost; runRef: TaskExecutionRecord['run']['ref']; inv: InvariantTarget;
}> {
  const world = await pausedAttestedWorld(label, async () => null);
  return { host: world.host, runRef: world.runRef, inv: world.inv };
}

async function taskRowOf(host: AG2bHost): Promise<TaskRow> {
  return await workRow(host) as unknown as TaskRow;
}

async function queueOf(host: AG2bHost): Promise<DecisionQueueReadV1> {
  const read = await post<ReadResult<DecisionQueueReadV1>>(host, 'decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 } }));
  if (read.status !== 'ready') throw new Error(`the decision queue must read: ${JSON.stringify(read)}`);
  return read.value;
}

function reviewCardOf(queue: DecisionQueueReadV1): DecisionCardV1 {
  const cards = queue.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

async function answerReviewCard(host: AG2bHost, card: DecisionCardV1, optionId: string, requestId: string,
): Promise<ReadResult<ResolveDecisionReadV1>> {
  return await post<ReadResult<ResolveDecisionReadV1>>(host, 'decisions/answer', graphWrite(AG2B_SCOPE, {
    source: card.source, selection: { kind: 'option', optionId } as DecisionSelectionV1,
    text: '', annotations: [],
  }, requestId, card.source.pins));
}

/** The prepared manifest's continuation brief through the public `materials/open` route. */
async function preparedBriefOfHost(host: AG2bHost, bundleRef: ArtifactRef): Promise<ContinuationBriefV1> {
  const read = await post<ReadResult<{ body: string }>>(host, 'materials/open',
    plain(AG2B_SCOPE, { ref: bundleRef, usage: 'historical_explanation' }));
  if (read.status !== 'ready') throw new Error(`the prepared manifest must be openable: ${JSON.stringify(read)}`);
  const manifest = JSON.parse(read.value.body) as PreparedTaskManifestV1;
  if (manifest.continuationBrief === undefined) throw new Error('the prepared manifest must carry the continuation brief');
  return manifest.continuationBrief;
}

it('K3-41 (一) memory/sqlite Host: a rerun_as_is card answer resolves the record but the human-stopped Run stays at AV-4; the human continue claims one continuation whose brief carries the review section', async () => {
  const { host, runRef, inv } = await pausedAttestedOpen('one');
  try {
    // The human-stopped Run's card exists; the review record was created by RUN-22.
    const before = await readReview(host, runRef);
    expect(before.status).toBe('needs_decision');
    const card = reviewCardOf(await queueOf(host));
    expect(card.source.kind).toBe('unknown_call_review');
    expect(card.source.key).toContain(runRef.runId);

    // (一): the card answer "run it again" resolves the record; it does NOT hold it.
    const answered = await answerReviewCard(host, card, 'rerun_as_is', 'k3-41-one-answer');
    expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (answered.status !== 'ready') return;
    const action = answered.value.action as WriteResult<UnknownCallReviewV1>;
    expect(action, JSON.stringify(action)).toMatchObject({ status: 'committed', value: {
      status: 'resolved', activeRound: null,
      disposition: { choice: 'rerun_as_is', source: 'card', hold: null } } });

    // D9: the original Run's fence is human, so AV-4 stops the Task (`task_paused`,
    // NOT the AV-4c review hold) and no automatic requeue happens.
    const row = await taskRowOf(host);
    expect(row.unknownCallReview).toMatchObject({ status: 'resolved', hold: null });
    expect(row.failure?.automation.verdict).toMatchObject({ kind: 'stopped', reason: 'task_paused',
      detail: { fence: 'human_pause', pausedBy: 'human' } });
    const verdict = row.failure?.automation.verdict;
    if (verdict?.kind === 'stopped') expect(verdict.detail).not.toHaveProperty('reviewHold');
    expect(row.execution?.runId).toBe(runRef.runId);
    expect(row.rework?.entries ?? [], 'no system requeue exists').toEqual([]);
    const afterQueue = await queueOf(host);
    expect(afterQueue.waitingAnswer.filter(entry => entry.source.kind === 'unknown_call_review')).toEqual([]);
    expect(afterQueue.waitingAnswer.filter(entry => entry.source.kind === 'goal_cause'
      && entry.source.key.includes('automation_confirmation_required'))).toEqual([]);

    const idle = await driveChecked(host, inv, selectWork('k3-41-one-idle'), { stopBefore: 'start' });
    const idleKinds = idle.steps.flatMap(step => step.receipt === null ? [] : [step.receipt.kind]);
    expect(idleKinds, 'nothing is requeued automatically').not.toContain('requeue_task');
    expect(idleKinds, 'no continuation is claimed').not.toContain('claim_task');
    expect(idle.steps.some(step => (step.reason ?? '').startsWith('automation_confirmation_required'))).toBe(false);
    expect((await taskRowOf(host)).rework?.entries ?? []).toEqual([]);

    // The person's "continue": the human requeue after the human-stopped Run.
    const requeued = await operatorRequeue(host, runRef, 'k3-41-one-requeue', 'continue the human-stopped work');
    expect(requeued, JSON.stringify(requeued)).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });

    const continued = await driveChecked(host, inv, selectWork('k3-41-one-continue'), { stopBefore: 'start' });
    expect(continued.next).not.toBeNull();
    const prepared = preparedOf(continued.next);
    const brief = await preparedBriefOfHost(host, prepared.envelope.bundleRef);
    expect(brief.unknownCallReview?.disposition).toMatchObject({ choice: 'rerun_as_is', source: 'card' });
    const note = renderContinuationBriefZh(brief, continuationBriefDigest(brief));
    expect(note).toContain('### 结果未知的调用：核对和处置');
    expect(note).toContain('- 处置：照原样重跑（卡上选的）。');
    const continuedRow = await taskRowOf(host);
    expect(continuedRow.rework?.entries ?? [], 'exactly one continuation').toHaveLength(1);
    expect(continuedRow.execution?.runId).not.toBe(runRef.runId);
  } finally {
    await host.host.close();
  }
}, 300_000);

it('K3-41 (二) memory/sqlite Host: release-hold on a human-stopped Run releases and performs the human requeue, then one continuation is claimed', async () => {
  const { host, runRef, held, inv } = await pausedAttestedAndHeld('two');
  try {
    // The human-fenced original Run is the selected Run; `releaseHold` then the
    // same operator's requeue commits in the route's one response.
    const released = await post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>;
      requeue: WriteResult<{ kind: string }> | null }>>(host, 'unknown-call-reviews/release-hold',
    graphWrite(AG2B_SCOPE, { reviewRef: held.ref }, RELEASE, [{ ref: held.ref, revision: held.revision }]));
    expect(released, JSON.stringify(released)).toMatchObject({ status: 'committed', replayed: false, value: {
      hold: { status: 'committed', replayed: false, value: { status: 'resolved', activeRound: null,
        disposition: { hold: 'released' } } },
      requeue: { status: 'committed', replayed: false, value: { kind: 'requeued' } } } });

    // The human requeue is the continuation: the next drive claims a NEW Run.
    const continuation = await driveChecked(host, inv, selectWork('k3-41-continue', true), { stopBefore: 'open_checks' });
    expect(continuation.next?.kind === 'perform' ? continuation.next.operation.kind : null,
      'the drive stops after the one continuation Run').toBe('open_checks');
    const row = await workRow(host);
    if (row.execution === null || row.execution.runId === runRef.runId) {
      throw new Error('the human requeue must have been claimed as the continuation Run');
    }
    expect(row.execution.runId).not.toBe(runRef.runId);
  } finally {
    await host.host.close();
  }
}, 300_000);

// ---------------------------------------------------------------------------
// F-044: the real crash boundary of release-hold on the old SQLite Host.
// The gate below is a wrapper around the real commit: it is entered AFTER the
// releaseHold commit is durable and holds the route BEFORE the human requeue,
// then the old Host is abandoned (lock rewritten to a dead pid) and a new Host
// reconciles the same database. `restart({ crash: true })` is the A2 crash
// fixture; a Goal pause no longer stands in for it.
// ---------------------------------------------------------------------------

it.each([
  ['a real crash after the releaseHold commit and before the requeue replays the same request and claims exactly one continuation', 'crash'],
  ['a Goal pause that makes the requeue busy until the Goal resumes replays the same request and claims exactly one continuation', 'goal-pause'],
])('K3-41 (三) SQLite Host: %s', async (_description, precondition) => {
  let armed = false;
  let reachedResolve!: () => void;
  const reached = new Promise<void>((resolve) => { reachedResolve = resolve; });
  let settleResolve!: (fail: boolean) => void;
  const held = new Promise<boolean>((resolve) => { settleResolve = resolve; });
  let hits = 0;
  const gate: ScenarioCommitGate = async (batch) => {
    if (!armed) return;
    const releaseHold = batch.events.some(event => event.eventType === 'UnknownCallReviewChanged'
      && (JSON.parse(event.json) as { change?: unknown }).change === 'hold_released');
    if (!releaseHold) return;
    // The durable write has already happened; hold the route before its human requeue.
    armed = false;
    hits += 1;
    reachedResolve();
    if (await held) throw new Error('injected: the old Host fell at the release-hold commit');
  };
  const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
    script: { replies: [textReply('K3-41 F-044: the continuation ran')] }, commitGate: gate });
  let oldRequest: Promise<unknown> | null = null;
  let restored = false;
  let aside: Awaited<ReturnType<typeof moveKernelAside>> | null = null;
  try {
    const setup = await crashedShellReviewRun(h);
    const prepared = setup.prepared;
    aside = setup.aside;
    const unknown = await readExecution(h.host, prepared.claim.runRef);
    // The human pause survives the crash reconcile: RUN-20 books `unknown`, so
    // the person's attestation (RUN-22) is what creates the review record.
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      controlState: { desiredState: 'paused' }, reconciliation: { observation: { kind: 'unresolved' } } });
    const attested = await h.post<WriteResult<RunSnapshot>>('executions/resolve-unknown',
      graphWrite(AG2B_SCOPE, { runRef: prepared.claim.runRef, reason: 'the person checked the stopped work by hand' },
        'k3-41-crash-attest', [{ ref: prepared.claim.runRef, revision: unknown.run.revision }]));
    expect(attested, JSON.stringify(attested)).toMatchObject({ status: 'committed', value: {
      status: 'ended', outcome: 'crashed', reconciliation: { observation: { kind: 'human_attested' } } } });
    const created = await readReview(h.host, prepared.claim.runRef);
    expect(created, JSON.stringify(created)).toMatchObject({ status: 'needs_decision', activeRound: null });
    const heldRecord = await h.post<WriteResult<UnknownCallReviewV1>>('unknown-call-reviews/hold',
      graphWrite(AG2B_SCOPE, { reviewRef: created.ref, text: null }, HOLD,
        [{ ref: created.ref, revision: created.revision }]));
    expect(heldRecord, JSON.stringify(heldRecord)).toMatchObject({ status: 'committed', value: {
      status: 'resolved', activeRound: null, disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } } });
    if (heldRecord.status !== 'committed') throw new Error('the hold must commit');
    // The Kernel store is restored before the release-hold Host boundary; the
    // release path reads the Run and its control intent, never the Kernel.
    await restoreKernel(h.database, aside);
    restored = true;
    const releaseBody = graphWrite(AG2B_SCOPE, { reviewRef: heldRecord.value.ref }, RELEASE,
      [{ ref: heldRecord.value.ref, revision: heldRecord.value.revision }]);

    let releasedRevision: number | null = null;
    if (precondition === 'goal-pause') {
      // Goal paused: the hold commits, the human requeue is refused `busy`.
      const paused = await h.post<WriteResult<GoalControlOutcomeV1>>('goals/control', graphWrite(AG2B_SCOPE,
        { goalRef: AG2B_GOAL_REF, control: 'pause', reason: 'hold the continuation for the crash window' },
        'k3-41-goal-pause', await goalControlPins(h.host)));
      expect(paused, JSON.stringify(paused)).toMatchObject({ status: 'committed' });
      const first = await h.post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>;
        requeue: WriteResult<{ kind: string }> | null }>>('unknown-call-reviews/release-hold', releaseBody);
      expect(first, JSON.stringify(first)).toMatchObject({ status: 'committed', value: {
        hold: { status: 'committed', value: { disposition: { hold: 'released' } } },
        requeue: { status: 'rejected', code: 'busy' } } });
      const releasedRecord = await readReview(h.host, prepared.claim.runRef);
      expect(releasedRecord).toMatchObject({ status: 'resolved', activeRound: null, disposition: { hold: 'released' } });
      releasedRevision = releasedRecord.revision;
      // Resume the Goal: the re-click below replays the hold and the human
      // requeue now commits.
      const resumed = await h.post<WriteResult<GoalControlOutcomeV1>>('goals/control', graphWrite(AG2B_SCOPE,
        { goalRef: AG2B_GOAL_REF, control: 'resume', reason: 'resume for the re-click' },
        'k3-41-goal-resume', await goalControlPins(h.host)));
      expect(resumed, JSON.stringify(resumed)).toMatchObject({ status: 'committed' });
    } else {
      // The old Host's releaseHold commit lands and the gate holds before the
      // human requeue; the request stays in flight on the Host that is abandoned.
      armed = true;
      oldRequest = h.post('unknown-call-reviews/release-hold', releaseBody);
      await reached;
      expect(hits, 'the gate held exactly the release-hold commit').toBe(1);
      const durable = await readReview(h.host, prepared.claim.runRef);
      expect(durable).toMatchObject({ status: 'resolved', activeRound: null, disposition: { hold: 'released' } });
      expect(durable.revision).toBe(heldRecord.value.revision + 1);

      // The old Host is abandoned at that boundary; the new Host starts on the
      // SAME SQLite database and runs its real startup reconcile. Its wrapper is
      // not the gate (dropCommitGate restored the factories).
      h.dropCommitGate();
      const report = await h.restart({ crash: true, invariants: false });
      expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03' });
      // The startup reconcile alone creates no continuation.
      expect(await readReview(h.host, prepared.claim.runRef)).toEqual(durable);
      expect((await h.taskRow()).rework?.entries ?? [], 'no requeue before the replayed click').toHaveLength(0);
    }

    // The SAME release-hold request on the new/resumed Host: the hold receipt
    // replays and the one human requeue commits.
    const replay = await h.post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>;
      requeue: WriteResult<{ kind: string }> | null }>>('unknown-call-reviews/release-hold', releaseBody);
    expect(replay, JSON.stringify(replay)).toMatchObject({ status: 'committed', value: {
      hold: { status: 'committed', replayed: true, value: { disposition: { hold: 'released' } } },
      requeue: { status: 'committed', replayed: false, value: { kind: 'requeued' } } } });
    if (replay.status !== 'committed' || replay.value.requeue === null) throw new Error('the replay must requeue');
    if (releasedRevision !== null) {
      expect(replay).toMatchObject({ value: { hold: { value: { revision: releasedRevision } } } });
    }

    // Exactly one continuation Run is claimed from that one requeue.
    const continuation = await h.advance(h.select('k3-41-crash-continue'), { stopBefore: performs('open_checks') });
    expect(continuation.next?.kind === 'perform' ? continuation.next.operation.kind : null,
      'the drive stops after the one continuation Run').toBe('open_checks');
    const row = await h.taskRow();
    expect(row.rework?.entries ?? [], 'exactly one continuation').toHaveLength(1);
    expect(row.execution?.runId).not.toBe(prepared.claim.runRef.runId);
    expect((await readExecution(h.host, prepared.claim.runRef)).run.status).toBe('ended');

    // A second click of the same request replays both steps and adds nothing.
    const again = await h.post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>;
      requeue: WriteResult<{ kind: string }> | null }>>('unknown-call-reviews/release-hold', releaseBody);
    expect(again, JSON.stringify(again)).toMatchObject({ status: 'committed', value: {
      hold: { status: 'committed', replayed: true },
      requeue: { status: 'committed', replayed: true, value: { kind: 'requeued' } } } });
    expect((await h.taskRow()).rework?.entries ?? [], 'still exactly one continuation').toHaveLength(1);
  } finally {
    settleResolve(true);
    if (oldRequest !== null) await oldRequest.catch(() => undefined);
    await h.drainAbandoned().catch(() => undefined);
    if (!restored && aside !== null) await restoreKernel(h.database, aside).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// The route-dispatch examples (K3-41-style). The AG2b Host does not expose its
// platform, so these two examples assemble the real owners over the shared K3
// world and dispatch the REAL frozen route table. The human-stopped Run itself
// is the real one: a public claim, `prepareAndStart` with §5.1's blocked shell
// stand-in, the person's real pause control, the production Host RUN-20/RUN-22
// record, and the Runtime's own end after the stand-in is released. Nothing is
// hand-encoded. The Host recognition path reads the fixture directory ledger,
// so the world is SQLite (a memory world is not visible to the platform Host).
// ---------------------------------------------------------------------------

const ROUTE_AT = '2026-10-20T00:00:00.000Z';

/** A platform where every group a route does not use answers an inert stub. */
function routePlatform(groups: Partial<Record<keyof CoreRoutePlatform, unknown>>): CoreRoutePlatform {
  const stub = new Proxy({}, { get: () => async () => ({
    status: 'rejected' as const, code: 'unsupported' as const, reason: 'the K3-41 route test stub is not a real owner',
  }) });
  return new Proxy(groups, { get: (target, key) => key in target ? Reflect.get(target, key) : stub }) as unknown as CoreRoutePlatform;
}

type RouteFixture = {
  world: K3ReviewCardWorld;
  base: TaskClaimFixture;
  ctx: K3ReviewCardWorld['fixture']['ctx'];
  records: K3ReviewCardWorld['records'];
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  requeues: ReturnType<typeof createTaskRequeueService>;
  controls: ReturnType<typeof createRunControlService>;
  reads: ReturnType<typeof createRunStateReader>;
  goalControl: GoalControlPort;
  record: UnknownCallReviewV1;
  held: UnknownCallReviewV1;
  bindings: ReturnType<typeof createPlatformCoreRouteBindings>;
  close(): Promise<void>;
};

/** The real owners over the shared world: a human-paused Run, attested, held. */
async function routeFixture(kind: 'memory' | 'sqlite' = 'sqlite'): Promise<RouteFixture> {
  const world = await openK3ReviewCardWorld(kind);
  const base = world.fixture.b2.base;
  const ctx = world.fixture.ctx;
  const records = world.records;
  const reads = createRunStateReader({ records });
  let seq = 0;
  const id = () => `k3-41-route-${String(++seq)}`;
  const controls = createRunControlService({ records,
    authority: createMaterialRecordReaders(records).authority, reads, now: () => ROUTE_AT, eventId: id });
  const sourceReader = new VerificationWorkspaceReader();
  const requeues = createTaskRequeueService({ records, reads,
    workspaceHost: { async resolveRoot() {
      return { status: 'ready' as const, value: { root: world.fixture.base.directory,
        workspaceRevision: WORKSPACE_REVISION } };
    } },
    source: { captureDigest: (root: string) => sourceReader.captureDigest(root) },
    materials: { async storeArtifact() { throw new Error('no note'); }, async openArtifact() { throw new Error('no artifact'); } },
    messages: { async readMessage() { return { status: 'not_found' as const }; } },
    now: () => ROUTE_AT, eventId: id });
  // The real Goal-control driver, but `driving: false`: this process holds no
  // Host instance lease, so the fan-out is correctly skipped (L-10) and its run
  // dependencies are never reached.
  const goalControl = createGoalFanOutDriver({
    goals: base.goals, plans: base.plans as never, executions: reads, controls,
    runtime: {} as never, claims: { requeueTask: requeues.requeueTask }, driving: () => false });

  // ---- the REAL human-paused original Run and its record ------------------
  const harness = await openRealRunHarness(world);
  const session = await world.fixture.createS5Session('k3-41-route-original');
  const claim = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId: 'k3-20-a',
    requestId: 'k3-41-route-original-claim' });
  const started = await harness.prepareAndStart(claim, {
    model: createScriptedModel([{ kind: 'calls', calls: [{ callId: 'call-1', name: 'shell',
      args: { command: 'echo hi' } }] }]),
    tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
  });
  const current = await reads.readExecution(ctx, claim.runRef);
  if (current.status !== 'ready') throw new Error(`the entered Run must read: ${JSON.stringify(current)}`);
  // The person's pause is the real control owner's write while the Run is in
  // flight; the pointer survives the Host's RUN-20/RUN-22 recognition.
  const pause = await controls.submitControl(ctx, { input: {
    runRef: claim.runRef, kind: 'pause', reason: 'the person pauses the stopped work' },
    meta: { requestId: 'k3-41-route-pause', expected: [{ ref: claim.runRef, revision: current.value.run.revision }] } });
  expect(pause, JSON.stringify(pause)).toMatchObject({ status: 'committed' });
  const record = await harness.createRecord(claim);
  expect(record, JSON.stringify(record)).toMatchObject({ revision: 1, status: 'pending_review', inventory: 'complete' });
  expect(record.items).toHaveLength(1);
  // Release the stand-in so the Runtime books its own end as well.
  shellSeam.release();
  await started.started.catch(() => undefined);

  const held = await world.reviews.holdReview(ctx, { input: { reviewRef: record.ref, text: null },
    meta: { requestId: 'k3-41-route-hold', expected: [{ ref: record.ref, revision: record.revision }] } });
  expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed', value: {
    status: 'resolved', activeRound: null, disposition: { choice: 'handle_myself', hold: 'held' } } });
  if (held.status !== 'committed') throw new Error('the hold must commit');

  const fixture: RouteFixture = {
    world, base, ctx, records, reviews: world.reviews, requeues, controls, reads, goalControl,
    record, held: held.value,
    // Replaced below once the fixture object exists; `bindingsFor` needs it.
    bindings: createPlatformCoreRouteBindings(routePlatform({})),
    async close() { await goalControl.close(); await harness.closeUnion(); await world.close(); },
  };
  fixture.bindings = bindingsFor(fixture);
  return fixture;
}

function bindingsFor(f: RouteFixture, controls: unknown = f.controls) {
  return createPlatformCoreRouteBindings(routePlatform({
    claims: { requeueTask: f.requeues.requeueTask, readTaskRequeueByIdentity: f.requeues.readTaskRequeueByIdentity },
    executions: f.reads,
    plans: f.base.plans,
    controls,
    unknownCallReviews: f.reviews,
  }), undefined, undefined, f.goalControl);
}

/** The one-shot readControl fault: the real owner answers every later call. */
function failReadControlOnce(controls: ReturnType<typeof createRunControlService>) {
  let failed = false;
  return { ...controls, async readControl(...args: Parameters<typeof controls.readControl>) {
    if (!failed) {
      failed = true;
      return { status: 'rejected' as const, code: 'unavailable' as const,
        reason: 'injected one-shot control-intent read failure' };
    }
    return controls.readControl(...args);
  } };
}

function routeWrite(scope: { projectId: string; workspaceId: string }, input: unknown,
  requestId: string, expected: readonly VersionPin[]) {
  return { scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
    request: { input, meta: { requestId, expected } } };
}

async function routeCall(f: RouteFixture, suffix: Parameters<typeof parseCoreRouteRequest>[0], body: unknown,
  bindings = f.bindings): Promise<unknown> {
  const parsed = parseCoreRouteRequest(suffix, body);
  if (!parsed.ok) throw new Error(`the route body must parse: ${JSON.stringify(parsed.rejection)}`);
  return dispatchCoreRoute(bindings, suffix, f.ctx, parsed);
}

async function routeFacts(f: RouteFixture) {
  const window = await readGoalPlanWindow(f.records, GOAL_B);
  if (window.status !== 'ready' || window.plan === null) throw new Error(`the Plan must read: ${JSON.stringify(window)}`);
  const facts = await readCanonicalTaskFacts(f.records, GOAL_B, window.plan, f.record.task.taskId);
  if (facts.status !== 'ready') throw new Error(`the projection must read: ${JSON.stringify(facts)}`);
  return facts.value;
}

async function routeRuns(f: RouteFixture) {
  return (await routeFacts(f)).runsByTaskId.get(f.record.task.taskId) ?? [];
}

async function goalControlThroughRoute(f: RouteFixture, control: 'pause' | 'resume', requestId: string) {
  const goal = await f.base.plans.queryGoal(f.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal must read: ${JSON.stringify(goal)}`);
  const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: GOAL_B.projectId,
    goalId: GOAL_B.goalId };
  const phase = await readGoalPhase(f.records, phaseRef);
  if (phase.status !== 'ready') throw new Error(`the GoalPhase must read: ${JSON.stringify(phase)}`);
  return routeCall(f, 'goals/control', routeWrite(f.world.fixture.base.scope,
    { goalRef: GOAL_B, control, reason: `operator ${control}` }, requestId,
    [{ ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: phaseRef, revision: phase.snapshot?.revision ?? 0 }])) as Promise<WriteResult<GoalControlOutcomeV1>>;
}

/**
 * The ordinary continuation request for the record's Task: goal, Workspace and
 * Session pins are the store's real revisions, not the route's input.
 */
async function continuationRequest(f: RouteFixture, requeueRef: TaskRequeueRef, requestId: string) {
  const session = await f.world.fixture.createS5Session(requestId);
  const goal = await f.base.plans.queryGoal(f.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal must read: ${JSON.stringify(goal)}`);
  const card = await f.base.sessionsPort.readSession(f.ctx, session);
  if (card.status !== 'ready') throw new Error(`the Session must read: ${JSON.stringify(card)}`);
  return { input: { goalRef: GOAL_B, planRef: PLAN_B2, taskId: f.record.task.taskId, sessionRef: session,
    roleBinding: f.base.roleBinding, budget: f.base.budget, requeueRef },
  meta: { requestId, expected: [
    { ref: GOAL_B, revision: goal.value.goal.revision },
    { ref: WORKSPACE, revision: WORKSPACE_REVISION },
    { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision },
  ] } };
}

function releaseHoldBody(f: RouteFixture, requestId: string) {
  return routeWrite(f.world.fixture.base.scope, { reviewRef: f.held.ref }, requestId,
    [{ ref: f.held.ref, revision: f.held.revision }]);
}

const routeFixtures: RouteFixture[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const fixture of routeFixtures.splice(0)) await fixture.close();
});

describe.each(['memory', 'sqlite'] as const)('K3-41 (二) route read failures (%s)', kind => {
  it('K3-41 (二): a failed control-intent read is a rejected requeue, never null; the re-click performs one continuation', async () => {
    const f = await routeFixture(kind);
    routeFixtures.push(f);
    const bindings = bindingsFor(f, failReadControlOnce(f.controls));
    const body = releaseHoldBody(f, RELEASE);
    const first = (await routeCall(f, 'unknown-call-reviews/release-hold', body, bindings)) as WriteResult<UnknownCallReviewReleaseHoldValue>;
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'committed', value: {
      hold: { status: 'committed', replayed: false, value: { status: 'resolved', activeRound: null,
        disposition: { hold: 'released' } } },
      requeue: { status: 'rejected', code: 'unavailable',
        reason: 'injected one-shot control-intent read failure' } } });
    expect((await routeFacts(f)).requeuesByTaskId.get(f.record.task.taskId) ?? [],
      'the refused requeue writes no TaskRequeued').toHaveLength(0);
    const released = await f.reviews.readReview(f.ctx, { ref: f.held.ref });
    if (released.status !== 'ready') throw new Error('the released record must read');

    // The same click, now with the real read: releaseHold replays, the requeue commits.
    const replay = (await routeCall(f, 'unknown-call-reviews/release-hold', body)) as WriteResult<UnknownCallReviewReleaseHoldValue>;
    expect(replay, JSON.stringify(replay)).toMatchObject({ status: 'committed', value: {
      hold: { status: 'committed', replayed: true, value: { revision: released.value.revision } },
      requeue: { status: 'committed', replayed: false, value: { kind: 'requeued' } } } });
    const requeues = (await routeFacts(f)).requeuesByTaskId.get(f.record.task.taskId) ?? [];
    expect(requeues, 'one TaskRequeued').toHaveLength(1);

    // Exactly one continuation Run is claimed from that one requeue.
    const request = await continuationRequest(f, requeues[0]!.ref, 'k3-41-route-continuation-one');
    const claimed = await f.base.makeService(f.records).claimTask(f.ctx, request);
    expect(claimed, JSON.stringify(claimed)).toMatchObject({ status: 'committed', replayed: false });
    expect((await routeRuns(f)).map(run => run.ref.runId), 'the original Run and its one successor')
      .toHaveLength(2);
  });
});

describe.each(['memory', 'sqlite'] as const)('K3-41 (二) release-hold replay (%s)', kind => {
  it('K3-41 (二): after both steps commit and the Goal changes, the same release-hold replays the one requeue and adds no continuation', async () => {
    const f = await routeFixture(kind);
    routeFixtures.push(f);
    const body = releaseHoldBody(f, RELEASE);
    const first = (await routeCall(f, 'unknown-call-reviews/release-hold', body)) as WriteResult<UnknownCallReviewReleaseHoldValue>;
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'committed', replayed: false, value: {
      hold: { status: 'committed', replayed: false, value: { disposition: { hold: 'released' } } },
      requeue: { status: 'committed', replayed: false, value: { kind: 'requeued' } } } });
    if (first.status !== 'committed') throw new Error('the first release-hold must commit');
    const firstRequeue = first.value.requeue;
    if (firstRequeue === null || firstRequeue.status !== 'committed' || firstRequeue.value.kind !== 'requeued') {
      throw new Error(`the first requeue must commit: ${JSON.stringify(firstRequeue)}`);
    }

    // The Goal changes through the public route: the pins the first requeue
    // fingerprinted are stale now.
    expect(await goalControlThroughRoute(f, 'pause', 'k3-41-route-goal-pause'))
      .toMatchObject({ status: 'committed', replayed: false });
    expect(await goalControlThroughRoute(f, 'resume', 'k3-41-route-goal-resume'))
      .toMatchObject({ status: 'committed', replayed: false });

    // The SAME release-hold request (same request id, same body) replays both receipts.
    const replay = (await routeCall(f, 'unknown-call-reviews/release-hold', body)) as WriteResult<UnknownCallReviewReleaseHoldValue>;
    expect(replay, JSON.stringify(replay)).toMatchObject({ status: 'committed', value: {
      hold: { status: 'committed', replayed: true },
      requeue: { status: 'committed', replayed: true, cursor: firstRequeue.cursor,
        value: { kind: 'requeued', requeue: { ref: firstRequeue.value.requeue.ref } } } } });
    const requeues = (await routeFacts(f)).requeuesByTaskId.get(f.record.task.taskId) ?? [];
    expect(requeues, 'exactly one TaskRequeued').toHaveLength(1);

    // Exactly one continuation Run from the one requeue.
    const request = await continuationRequest(f, firstRequeue.value.requeue.ref, 'k3-41-route-continuation-replay');
    const claimed = await f.base.makeService(f.records).claimTask(f.ctx, request);
    expect(claimed, JSON.stringify(claimed)).toMatchObject({ status: 'committed' });
    expect((await routeRuns(f)).map(run => run.ref.runId), 'still exactly one continuation')
      .toHaveLength(2);
  });
});

