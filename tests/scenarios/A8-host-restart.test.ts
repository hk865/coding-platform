/**
 * A.2 step 6, scenario A8 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步", §12.10): crash points of a
 * work Run before the Kernel (A8-1) and with side effects not booked (A8-3), on rebuilt Hosts over one
 * SQLite ledger and Kernel store, and the start-up re-drive (§12.1 step 6b, LA-6) on and off. The other
 * §12.10 groups are in their own files (one file would pass the ~90 s guideline): A8-2 (entry unknown, with
 * the A8-1c supplement) A8-host-restart-entry.test.ts, C4 (A8-3l..A8-3r) A8-host-restart-paused.test.ts,
 * C8 (A8-R1, A8-R2) A8-host-restart-rework.test.ts, the lease and QueryRun cases (A8-L*, A8-Q*)
 * A8-host-restart-lease.test.ts.
 *
 * - A8-1a (W-01): a claimed Run re-driven with the same claim at the next start, with the re-drive on and
 *   off (moved case).
 * - A8-3a (W-09): the Kernel wrote the Turn's terminal and the result was never booked (the ledger's write
 *   lock held by the test past the store's busy wait); the restart books the Kernel's own terminal (RUN-18);
 *   the lost `start` sent again answers the booked Run.
 * - A8-3b (W-10): the Kernel yielded on a saved wait message and the yield was never booked; the restart
 *   rebuilds the continuation from the durable facts (RD-3). A8-3h (W-16, CTL-08(e)): the terminal was booked
 *   and its control acks were lost; the restart settles the queued steer (from its Kernel event) and pause.
 *   Both crash points are inside one Runtime call, so a composition root on the same files runs the Run and
 *   the test locks the ledger right after one named commit (support/common.ts `lockLedgerAfter`).
 * - A8-3j (W-18, D-17): the wait message was saved and the Kernel never recorded the send's result (the test
 *   locks the Kernel store too, at the same commit); the restart handles it as W-13 (RUN-20(i)), the message stays
 *   as saved and its wait association is lost. A8-1d (W-04) and A8-3k (W-19) need states the Host cannot reach
 *   on demand (a pre-D-7 queued intent, a tool that ignores a cancel): tests/runtime/A2-reconcile-runtime.test.ts.
 * - A8-3d with the Kernel paused (W-12, CI-04): a cancel queued on a Run paused at a safe point (submitted on a
 *   Host without the lease, HL-07) stops it at the restart by the paused stop (RUN-23, CTL-10).
 * - A8-3 (W-11, W-12, W-14, W-15, W-17; moved cases): crashes mid-Turn and the start-up re-drive of an
 *   interrupted Run (§13.4 #17), and the A8-2c/A8-3g Run left under a `host_config` probe.
 *
 * Every case checks the §11 invariants after each step that changes records (the harness does it in
 * `advance()` and after every restart; moved cases call `assertInvariantsAt`), counts model calls (and
 * Kernel Turns or check starts where a fresh Host could make them) during the reconcile, and ends with
 * another start on the same data that changes and writes nothing (`expectQuietHarnessRestart`,
 * `expectQuietRestart`). Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import type { SessionRef, TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type { ControlIntentSnapshotV1, SubmittedControl } from '../../src/contracts/control-intent.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite, plain, seedAG2bWorkGraph,
  startAG2bHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  answer, moveKernelAside, post, publicDirectory, readControl, readExecution, restoreKernel, selectWork, submitControl, tempDir, workRow,
  writeAutomationSettings, writeStaleLock, type AdvanceValue,
} from '../helpers/A2-restart-fixture.js';
import type { FuzzStep } from '../state/invariants.js';
import {
  assertInvariants, assertInvariantsAt, cleanupScenarios, hostCtx, openHostScenario, performs, readSqlite, SCENARIO_OPERATOR,
  stepOfReceipt, type HostScenario, type InvariantTarget,
} from './harness.js';
import {
  driveChecked, editThenText, execution, hostGoalDisplay, lockLedger, lockLedgerAfter, openWorkRoot, pausedRunOnClosedHostChecked,
  preparedOf, readMessage, redrivePolicy, requiredBriefOf, sessionKey, stepOf, WORK_TARGET,
} from './support/common.js';
import { crashMidTurn, expectQuietHarnessRestart, expectQuietRestart, kernelTurnOf } from './support/restart.js';

afterEach(cleanupScenarios);

// The moved cases' local names (tests/app/A2-automation-rework.test.ts at 05125db).
const goalDisplay = hostGoalDisplay;
const readBrief = async (host: AG2bHost, runRef: RunRef) => (await requiredBriefOf(host, runRef)).brief;
/** A person's attestation on a Host with the default automation (A.2 step 6 invariant step of the moved cases). */
const attestedStep: FuzzStep = { kind: 'other', actor: SCENARIO_OPERATOR, automationPolicy: DEFAULT_TASK_AUTOMATION_POLICY };

const A8_3B_QUESTION = 'restart scenario A8-3b: a question that waits for its reply';
const A8_3J_QUESTION = 'restart scenario A8-3j: a question whose wait the crash loses';
const A8_3H_STEER = 'restart scenario A8-3h: also read the tests';

it('A8-3a (W-09, RUN-18, ATT-08, SES-06): the Kernel wrote the Turn\'s terminal but its result was never booked; the restart books the Kernel\'s own terminal, releases the Session at the full boundary, and the Workflow goes on', async () => {
  let scenario: HostScenario | undefined;
  let ledger: { release(): void } | undefined;
  // Run 1: one edit, then the final text. During the final model call the test takes the ledger's write lock, so
  // the Kernel writes the Turn's terminal in its own store and the observer's `recordRunResult` fails after the
  // store's busy wait (`database is locked`): the terminal is written and not booked (the core A8-3 crash point).
  const h = await openHostScenario({ automation: redrivePolicy(false), script: { replies: editThenText('a8-3a'),
    duringReply: async (index) => {
      if (index === 1 && scenario !== undefined) ledger = lockLedger(scenario.database);
    } } });
  scenario = h;
  const toStart = await h.advance(h.select('a8-3a', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach start');
  let started: Record<string, unknown>;
  try {
    started = await h.answer('workflow/advance', plain(AG2B_SCOPE, toStart.next));
  } finally {
    ledger?.release();
  }
  expect(ledger, 'the lock was taken during the final model call').toBeDefined();
  expect(started).toMatchObject({ status: 'ready', value: { state: 'waiting', receipt: { kind: 'start',
    result: { status: 'rejected', code: 'unavailable' } } } });
  expect(JSON.stringify(started)).toContain('database is locked');
  const value = (started as { value: AdvanceValue }).value;
  if (value.receipt === null) throw new Error('the start step must answer its receipt');
  await assertInvariants(h, 'a8-3a terminal not booked', stepOfReceipt(value.receipt, h.stepActor(), h.automationPolicy(), 'a8-3a start'));
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Task must select its Run');
  const running = await execution(h, runRef);
  expect(running.run).toMatchObject({ status: 'running', outcome: null, executionAuthorization: { phase: 'entered' } });
  expect(running.session.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: runRef.runId } });
  expect(h.modelCalls()).toBe(2);
  const atCrash = h.counts();

  // The crash. W-09: the Turn has a Kernel terminal (completed) and no tool call without a result: RUN-18 books it.
  const report = await h.restart({ crash: true });
  const hostInstanceId = report.hostInstanceId;
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
    runs: [{ ref: JSON.stringify(runRef), row: 'W-09', status: 'reconciled', reason: 'terminal completed' }],
    queries: [], checks: [], controls: [], redriveGoals: [], problems: [] } });
  expect(h.counts(), 'no model request, Kernel Turn or check process during the reconcile').toMatchObject({
    modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted, checksBegun: atCrash.checksBegun,
    kernelRecords: atCrash.kernelRecords });
  const ended = await execution(h, runRef);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed', executionAuthorization: { phase: 'settled' },
    reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId },
      observation: { kind: 'runtime_terminal' } } });
  expect(ended.run.terminalPayload, 'contract (f): the terminal payload is written').toBeDefined();
  // ATT-08: the Attempt ends with the Kernel's outcome; the Outbox is settled and the Lease released.
  expect(ended.attempt).toMatchObject({ status: 'ended', endOutcome: 'completed' });
  expect(ended.outbox).toMatchObject({ status: 'settled' });
  expect(ended.lease?.release).toBeDefined();
  // SES-06: the Session is released at the Turn's full boundary; its Turn ended, so it stays available (LA-1 not met).
  expect(ended.session).toMatchObject({ occupancy: null, health: 'available' });
  expect(ended.session.historyCursor).not.toBeNull();
  expect(ended.session.historyCursor, 'the cursor moved to the Turn\'s full boundary').not.toEqual(running.session.historyCursor);

  // §12.10 step 4: the `start` whose answer was lost, sent again with the same identity, answers the Run as booked
  // (the read-shaped answer of A4's `replayOf`): no Kernel Turn, no model call, no write.
  const beforeResend = h.counts();
  const resent = await h.answer('workflow/advance', plain(AG2B_SCOPE, toStart.next));
  expect(resent).toMatchObject({ status: 'ready', value: { receipt: { kind: 'start', result: { status: 'ready',
    value: { run: { ref: runRef, status: 'ended', outcome: 'completed', revision: ended.run.revision } } } } } });
  expect(h.counts(), 'the same start again writes nothing').toEqual(beforeResend);

  // The Workflow goes on from the booked terminal: the round PASSes (the edit wrote the result file), the Goal completes.
  expect((await h.advance(h.select('a8-3a-later'))).state).toBe('completed');
  expect(h.modelCalls(), 'no model call after the booked Turn').toBe(2);
  await expectQuietHarnessRestart(h, 'a8-3a');
}, 180_000);

it('A8-3b (W-10, RD-3, L-5, RUN-18, contract (f)): the Kernel yielded on a saved wait message and the yielded terminal was never booked; the restart rebuilds the continuation from the durable facts and books the yield', async () => {
  const h = await openHostScenario({ automation: redrivePolicy(false), check: 'pass' });
  // The wait message's recipient takes part in the work Task (as the W-17 case links it).
  const recipient = (await createAG2bSession(h.host, 'a8-3b-recipient', AG2B_QUERY_ROLE,
    [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
  await assertInvariants(h, 'a8-3b recipient', stepOf(h, 'other', 'a8-3b recipient'));
  const toStart = await h.advance(h.select('a8-3b', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const prepared = preparedOf(toStart.next);
  // The crash point (§12.10 step 1, 故障注入; the Host has no seam inside one Runtime call): a composition root on the
  // same files starts the prepared Run; right after the wait message is saved the test takes the ledger's write lock,
  // so the Kernel yields in its own store and the observer's yielded-terminal write fails (`database is locked`).
  const lock = lockLedgerAfter(h.database, 'SessionMessageSent');
  const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'a8-3b-send', name: 'send_session_message',
    args: { recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId }, text: A8_3B_QUESTION, replyMode: 'wait' } }] }]);
  const root = await openWorkRoot(h, model, lock.observer);
  let started: unknown;
  try {
    started = await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'a8-3b-start' });
  } finally {
    lock.release();
    await root.close();
  }
  expect(lock.locked(), 'the lock was taken right after the message commit').toBe(true);
  expect(started).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(JSON.stringify(started)).toContain('database is locked');
  expect(model.calls(), 'one model reply: the send').toBe(1);
  await assertInvariants(h, 'a8-3b yielded, not booked', stepOf(h, 'entry_authorized', 'a8-3b yielded, not booked'));
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Task must select its Run');
  const running = await execution(h, runRef);
  expect(running.run).toMatchObject({ status: 'running', outcome: null, executionAuthorization: { phase: 'entered' } });
  expect(running.run.continuation).toBeUndefined();
  expect(running.session.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: runRef.runId } });
  const binding = running.run.executionAuthorization;
  if (binding === undefined || !('schemaVersion' in binding) || binding.kernel === null) throw new Error('the Run must hold a Kernel binding');
  // The Kernel ended the Turn yielded in its own store; exactly one send of this Turn waits for a reply (L-5).
  expect(kernelTurnOf(h.database, binding.kernel.runId)?.eventTypes).toContain('run.yielded');
  expect(h.ledgerEventTypes().filter(type => type === 'SessionMessageSent'), 'one saved wait message').toHaveLength(1);
  const atCrash = h.counts();

  // The crash. W-10: the Kernel terminal is yielded and the continuation is rebuilt from the durable facts (RD-3): the
  // one waiting send of the Turn, saved by this Run at the claim generation with waitAfterSend. RUN-18 books it.
  const report = await h.restart({ crash: true });
  const hostInstanceId = report.hostInstanceId;
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
    runs: [{ ref: JSON.stringify(runRef), row: 'W-10', status: 'reconciled', reason: 'terminal yielded' }],
    queries: [], checks: [], controls: [], redriveGoals: [], problems: [] } });
  expect(h.counts(), 'no model request, Kernel Turn or check process during the reconcile').toMatchObject({
    modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted, checksBegun: atCrash.checksBegun,
    kernelRecords: atCrash.kernelRecords });
  const yielded = await execution(h, runRef);
  expect(yielded.run).toMatchObject({ status: 'ended', outcome: 'yielded', executionAuthorization: { phase: 'settled' },
    terminalPayload: { kind: 'yielded', yield: { reason: 'reply_required' } },
    reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId }, observation: { kind: 'runtime_terminal' } },
    continuation: { kind: 'wait_reply', task: { taskId: AG2B_WORK_TASK_ID }, sessionRef: { sessionId: running.session.ref.sessionId } } });
  const continuation = yielded.run.continuation;
  if (continuation === undefined) throw new Error('the yielded Run must carry its continuation');
  expect(await readMessage(h, continuation.messageRef), 'RD-3: the message this Run saved at its claim generation, waiting')
    .toMatchObject({ waitAfterSend: true, recipient: { sessionId: recipient.sessionId },
      sender: { kind: 'work_run', runRef: { runId: runRef.runId }, generation: running.outbox.claim.generation } });
  // The yielded end releases the claim (W-10 成功：是): Attempt ended, Outbox settled, Session free at the Turn's boundary.
  expect(yielded.attempt).toMatchObject({ status: 'ended' });
  expect(yielded.outbox).toMatchObject({ status: 'settled' });
  expect(yielded.session).toMatchObject({ occupancy: null, health: 'available' });
  expect(yielded.session.historyCursor).not.toEqual(running.session.historyCursor);
  // L-5 (several waiting sends → EndedUnknown, no continuation): the frozen Kernel refuses a second waiting send in one
  // Turn (`tool_group_yield_unsettled`), so the state is not reachable; the guarded branch is
  // tests/composition/A2-reconcile-classifier-platform.test.ts:116 (OWED §1 RELATED), not repeated here.
  await expectQuietHarnessRestart(h, 'a8-3b');
}, 180_000);

it('A8-3j (W-18, D-17, W-13, RUN-20(i)): the wait message was saved and the Host stopped before the Kernel recorded the send; the restart ends the Run outcome_unknown on the send still in flight; the message stays as saved and no continuation waits for its reply', async () => {
  const h = await openHostScenario({ automation: redrivePolicy(false), check: 'pass' });
  const recipient = (await createAG2bSession(h.host, 'a8-3j-recipient', AG2B_QUERY_ROLE,
    [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
  await assertInvariants(h, 'a8-3j recipient', stepOf(h, 'other', 'a8-3j recipient'));
  const toStart = await h.advance(h.select('a8-3j', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const prepared = preparedOf(toStart.next);
  // The crash point (§12.10 step 1, 故障注入; D-17: until the yield the wait lives only in the Runtime): right after
  // the wait message is saved the test takes the write locks of the ledger and of the Kernel store, so the Kernel
  // cannot record the send's result (its call stays started) and the Runtime books nothing.
  const lock = lockLedgerAfter(h.database, 'SessionMessageSent', { kernelStore: true });
  const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'a8-3j-send', name: 'send_session_message',
    args: { recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId }, text: A8_3J_QUESTION, replyMode: 'wait' } }] }]);
  const root = await openWorkRoot(h, model, lock.observer);
  let started: unknown;
  try {
    started = await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'a8-3j-start' });
  } finally {
    lock.release();
    await root.close();
  }
  expect(lock.locked(), 'the locks were taken right after the message commit').toBe(true);
  // The start answers the Run as the ledger holds it: every write after the message failed, so nothing is booked.
  expect(started).toMatchObject({ status: 'ready', value: { run: { status: 'running', outcome: null } } });
  expect(model.calls(), 'one model reply: the send').toBe(1);
  await assertInvariants(h, 'a8-3j saved, not yielded', stepOf(h, 'entry_authorized', 'a8-3j saved, not yielded'));
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Task must select its Run');
  const running = await execution(h, runRef);
  expect(running.run).toMatchObject({ status: 'running', outcome: null, executionAuthorization: { phase: 'entered' } });
  expect(running.run.continuation).toBeUndefined();
  const binding = running.run.executionAuthorization;
  if (binding === undefined || !('schemaVersion' in binding) || binding.kernel === null) throw new Error('the Run must hold a Kernel binding');
  // The Kernel recorded the send as started and nothing after it: no result, no yielded terminal.
  const turn = kernelTurnOf(h.database, binding.kernel.runId);
  expect(turn?.eventTypes.at(-1)).toBe('tool.started');
  expect(turn?.eventTypes).not.toContain('run.yielded');
  const messageRefs = readSqlite(join(h.database, 'ledger.sqlite'), ledger => (ledger.prepare(
    "SELECT ref_key FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'SessionMessage'").all() as { ref_key: string }[])
    .map(row => JSON.parse(row.ref_key) as SessionMessageRef), [] as SessionMessageRef[]);
  expect(messageRefs, 'one saved wait message').toHaveLength(1);
  const saved = await readMessage(h, messageRefs[0]!);
  expect(saved).toMatchObject({ status: 'pending', waitAfterSend: true, recipient: { sessionId: recipient.sessionId },
    sender: { kind: 'work_run', runRef: { runId: runRef.runId } } });
  const atCrash = h.counts();

  // The crash. W-18 is handled as W-13 here: the send has no recorded result, so RUN-20(i) ends the Run unknown and
  // keeps its Session and Lease (D-4); the wait association is lost (no continuation), the message is not touched.
  const report = await h.restart({ crash: true });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
    runs: [{ ref: JSON.stringify(runRef), row: 'W-13', status: 'reconciled', reason: 'unknown' }],
    queries: [], checks: [], problems: [] } });
  expect(h.counts(), 'no model request, Kernel Turn or check process during the reconcile').toMatchObject({
    modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted, checksBegun: atCrash.checksBegun,
    kernelRecords: atCrash.kernelRecords });
  const unknown = await execution(h, runRef);
  expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
    reconciliation: { status: 'quarantined', basis: { kind: 'host_instance_takeover', hostInstanceId: report.hostInstanceId },
      observation: { kind: 'unresolved', unresolvedToolCallIds: ['a8-3j-send'] } } });
  expect(unknown.run.continuation, 'the wait association is lost').toBeUndefined();
  expect(unknown.session.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: runRef.runId } });
  expect(await readMessage(h, messageRefs[0]!), 'the message stays as saved').toEqual(saved);
  await expectQuietHarnessRestart(h, 'a8-3j');
}, 180_000);

it('A8-3d (W-12, RUN-23, CI-04, CTL-10, LA-1): a cancel queued on a Run paused at a safe point (submitted on a Host without the lease) stops the Run at the restart; the cancel is applied by the paused stop', async () => {
  let scenario: HostScenario | undefined;
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  const h = await openHostScenario({ automation: redrivePolicy(false), script: {
    replies: [{ kind: 'calls', calls: [{ callId: 'a8-3d-read', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: 'restart scenario A8-3d: never reached, the Run is paused' }],
    duringReply: async (index) => {
      if (index !== 0 || scenario === undefined) return;
      const runRef = (await scenario.taskRow()).execution;
      if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
      pauseRef = (await submitControl(scenario.host, runRef, 'pause', 'restart scenario: pause', 'a8-3d-pause')).intent.ref;
    } } });
  scenario = h;
  expect((await h.advance(h.select('a8-3d', AG2B_WORK_TASK_ID))).state).toBe('waiting');
  const runRef = (await h.taskRow()).execution;
  if (runRef === null || pauseRef === undefined) throw new Error('the paused Run must exist');
  const paused = await execution(h, runRef);
  expect(paused.run).toMatchObject({ status: 'running', controlState: { intentRef: pauseRef, desiredState: 'paused' } });
  expect(await readControl(h.host, pauseRef)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });
  const pauseIntent = await readControl(h.host, pauseRef);

  // The cancel is submitted on a second Host without the lease (HL-07): an entered Run's control stays queued there, so
  // the Kernel Turn is still paused with the cancel queued when the lease Host crashes (on the lease Host the live handle
  // would apply it at once, the in-process RUN-23 of A7-control).
  const peer = await h.startPeer();
  const cancelled = await post<WriteResult<SubmittedControl>>(peer, 'controls/submit', graphWrite(AG2B_SCOPE,
    { runRef, kind: 'cancel', reason: 'restart scenario: stop the paused Run' }, 'a8-3d-cancel', [{ ref: runRef, revision: paused.run.revision }]));
  if (cancelled.status !== 'committed') throw new Error(`cancel: ${JSON.stringify(cancelled)}`);
  const cancelRef = cancelled.value.intent.ref;
  expect(cancelled.value.intent).toMatchObject({ status: 'queued' });
  expect((await execution(h, runRef)).run).toMatchObject({ status: 'running', controlState: { intentRef: cancelRef, desiredState: 'cancelled' } });
  await assertInvariants(h, 'a8-3d cancel queued', stepOf(h, 'other', 'a8-3d cancel queued'));
  const kernelSessionId = paused.session.kernel.kernelSessionId;
  expect(h.kernelSnapshot().sessions.find(session => session.sessionId === kernelSessionId)?.activeRunId,
    'the paused Turn keeps the Kernel Session active').not.toBeNull();
  const atCrash = h.counts();

  // The crash. W-12 (CI-04): the pointer is a queued cancel, the Turn is clean and paused: RUN-23 with CTL-10.
  const report = await h.restart({ crash: true });
  const hostInstanceId = report.hostInstanceId;
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
    runs: [{ ref: JSON.stringify(runRef), row: 'W-12', status: 'reconciled', reason: 'paused_stop' }],
    // Hard limit 3: a person's cancel; nothing is re-driven.
    redriveGoals: [], problems: [] } });
  expect(h.counts(), 'no model request, Kernel Turn or check process during the reconcile').toMatchObject({
    modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted, checksBegun: atCrash.checksBegun,
    kernelRecords: atCrash.kernelRecords });
  const ended = await execution(h, runRef);
  // RUN-23: the synthesized `run_cancelled` says `cancelled_while_paused` (the Kernel is paused; §6 RUN-23).
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled', terminalPayload: { kind: 'cancelled', reason: 'cancelled_while_paused' },
    reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId },
      observation: { kind: 'interrupted_clean', kernelPaused: true } } });
  // CTL-10 (restart variant): applied by the paused stop. `pausedBy` is null at a restart (the A.2 5.6 sync note of
  // §15.2: the pointer names the cancel and the Kernel `run.paused` names no intent; restart notes QUESTION Q11).
  expect(await readControl(h.host, cancelRef)).toMatchObject({ status: 'applied', observation: { origin: 'platform_paused_stop',
    kind: 'cancelled', detail: { basis: 'host_instance_takeover', pausedBy: null } } });
  expect(await readControl(h.host, pauseRef), 'the applied pause is not rewritten').toEqual(pauseIntent);
  // LA-1: the Turn never ended in the Kernel, so the Session is released and retired.
  expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open',
    historyCursor: paused.session.historyCursor });
  expect(ended.attempt).toMatchObject({ status: 'ended', endOutcome: 'cancelled' });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'cancelled',
    automation: { verdict: { kind: 'stopped', reason: 'task_cancelled', detail: { fence: 'human_cancel' } } } } });
  await expectQuietHarnessRestart(h, 'a8-3d');
}, 180_000);

it('A8-3h (W-16, CTL-08(e), CI-08, CD-4): the terminal was booked and the crash lost its control acks; the restart settles the queued steer from its Kernel event and supersedes the pause the Turn never reached', async () => {
  const h = await openHostScenario({ automation: redrivePolicy(false), check: 'pass' });
  const toStart = await h.advance(h.select('a8-3h', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const prepared = preparedOf(toStart.next);
  // A composition root runs the Run (the Host has no seam between the terminal commit and its acks); right after the
  // terminal commit the test takes the ledger's write lock, so the acks of the queued intents fail.
  const lock = lockLedgerAfter(h.database, 'ExecutionRunResultRecorded');
  const intents: { steer?: ControlIntentSnapshotV1['ref']; pause?: ControlIntentSnapshotV1['ref'] } = {};
  const model = createScriptedModel([
    { kind: 'calls', calls: [{ callId: 'a8-3h-read', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 'restart scenario A8-3h: done' }], async (_request, index) => {
    const runRef = (await h.taskRow()).execution;
    if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
    // Call 0: a steer, which the Kernel accepts at the next model boundary. Call 1 (the final answer): a pause, which no
    // safe point reaches (no tool group follows).
    if (index === 0) intents.steer = (await submitControl(h.host, runRef, 'steer', A8_3H_STEER, 'a8-3h-steer')).intent.ref;
    if (index === 1) intents.pause = (await submitControl(h.host, runRef, 'pause', 'restart scenario: too late', 'a8-3h-pause')).intent.ref;
  });
  const root = await openWorkRoot(h, model, lock.observer);
  let started: unknown;
  try {
    started = await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'a8-3h-start' });
  } finally {
    lock.release();
    await root.close();
  }
  expect(lock.locked(), 'the lock was taken right after the terminal commit').toBe(true);
  expect(started).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'completed' } } });
  expect(JSON.stringify(model.requests[1]?.messages ?? []), 'the Kernel accepted the steer').toContain(A8_3H_STEER);
  const { steer, pause } = intents;
  if (steer === undefined || pause === undefined) throw new Error('the steer and the pause must be submitted');
  await assertInvariants(h, 'a8-3h ended, acks lost', stepOf(h, 'other', 'a8-3h ended, acks lost'));
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Task must select its Run');
  const ended = await execution(h, runRef);
  // W-16's facts: Ended (not a yielded wait) with a queued pointer intent and a queued steer.
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed', controlState: { intentRef: pause, desiredState: 'paused' },
    controlInputs: [steer] });
  expect(await readControl(h.host, steer)).toMatchObject({ status: 'queued' });
  expect(await readControl(h.host, pause)).toMatchObject({ status: 'queued' });
  const atCrash = h.counts();

  // The crash. §12.1 step 5, CTL-08(e) in its own commit: the steer the Kernel accepted is applied `steered` from that
  // Kernel event (as (b)); the pause has no Kernel event and is superseded (as (c), terminal_without_cancel).
  const report = await h.restart({ crash: true });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [],
    controls: [{ ref: JSON.stringify(runRef), row: 'W-16', status: 'reconciled', reason: 'queued intents settled' }],
    redriveGoals: [], problems: [] } });
  expect(h.counts(), 'no model request, Kernel Turn or check process during the reconcile').toMatchObject({
    modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted, checksBegun: atCrash.checksBegun,
    kernelRecords: atCrash.kernelRecords });
  const steered = await readControl(h.host, steer);
  expect(steered).toMatchObject({ status: 'applied', observation: { kind: 'steered', source: { position: expect.any(Number) } } });
  expect(steered.status === 'applied' && 'origin' in steered.observation, 'a Kernel observation, not a platform conclusion').toBe(false);
  expect(await readControl(h.host, pause)).toMatchObject({ status: 'superseded', observation: { kind: 'terminal_without_cancel' } });
  // The Run's end is not rewritten (intent ends, Run unchanged).
  expect((await execution(h, runRef)).run).toMatchObject({ status: 'ended', outcome: 'completed', terminalPayload: ended.run.terminalPayload,
    endedAt: ended.run.endedAt });
  await expectQuietHarnessRestart(h, 'a8-3h');
}, 180_000);

// ---------------------------------------------------------------------------
// Moved cases (user decision 31): assertions unchanged; A.2 step 6 adds the invariant checks (and marks them).
// ---------------------------------------------------------------------------

// Moved from tests/app/A2-host-reconcile.test.ts:564 (05125db): A8-1a supplement (W-01) and the start-up re-drive on and off.
it('§12.1 step 6b (LA-6, W-01): a claimed Run left by a stopped Host is re-driven with the same claim at the next start, unless the Host setting turns the re-drive off', async () => {
  for (const resumeOnStartup of [true, false]) {
    const root = await tempDir('a2-redrive-ws-');
    const database = await tempDir('a2-redrive-db-');
    const publicDir = await publicDirectory();
    const first = await startAG2bHost(publicDir, { root, database });
    const inv: InvariantTarget = { database };   // A.2 step 6
    let claimedRun: RunRef;
    try {
      await seedAG2bWorkGraph(first);
      await driveChecked(first, inv, selectWork('a2-redrive'), { stopBefore: 'start' });   // A.2 step 6: checked per step
      await assertInvariantsAt(inv, 'W-01 claimed and prepared');   // A.2 step 6
      const row = await workRow(first);
      if (row.execution === null) throw new Error('the Workflow must have claimed the Task');
      claimedRun = row.execution;
      expect((await readExecution(first, claimedRun)).run).toMatchObject({ status: 'starting' });
    } finally {
      await first.host.close();
    }
    if (!resumeOnStartup) await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
    const second = await startAG2bHost(publicDir, { root, database, replies: [
      { kind: 'calls', calls: [{ callId: 'a2-redrive-edit', name: 'edit', args: { mode: 'create', path: 'src/ag2b-result.txt', newText: 'AG2B_RESULT_FROM_A' } }] },
      { kind: 'text', text: 'A2 re-drive: the same claim completed the Task' }] });
    try {
      // Step 6b selects the active Goal with the not-entered Run either way (W-01); the switch decides whether a driver starts.
      expect(second.host.reconcile, String(resumeOnStartup)).toMatchObject({ lease: 'owned', report: { runs: [],
        redriveGoals: [{ goalRef: { goalId: 'ag2b-goal' }, taskIds: ['ag2b-work'] }], problems: [] } });
      if (resumeOnStartup) {
        let row = await workRow(second);
        for (let attempt = 0; attempt < 200 && row['effectivePhase'] !== 'satisfied'; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
          row = await workRow(second);
        }
        expect(row, 'the start-up re-drive completed the Task without a workflow/advance').toMatchObject({ effectivePhase: 'satisfied' });
        expect(row.execution?.runId, 'the same claim re-driven (W-01)').toBe(claimedRun.runId);
        expect((await readExecution(second, claimedRun)).run).toMatchObject({ status: 'ended', outcome: 'completed' });
        expect(second.scripted.calls()).toBe(2);
        await assertInvariantsAt(inv, 'W-01 re-driven at the start');   // A.2 step 6
      } else {
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(second.scripted.calls(), 'no driver started').toBe(0);
        expect((await readExecution(second, claimedRun)).run).toMatchObject({ status: 'starting' });
        await assertInvariantsAt(inv, 'W-01 after the reconcile');   // A.2 step 6
        // The next workflow/advance continues the same claim.
        const done = (await driveChecked(second, inv, selectWork('a2-redrive-later', true),
          { policy: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false } })).steps;   // A.2 step 6: checked per step
        expect(done.at(-1)).toMatchObject({ state: 'completed' });
        expect((await workRow(second)).execution?.runId).toBe(claimedRun.runId);
        await assertInvariantsAt(inv, 'W-01 continued by workflow/advance');   // A.2 step 6
      }
    } finally {
      await second.host.close();
    }
    await expectQuietRestart(database, publicDir, root, { label: `W-01 ${String(resumeOnStartup)}` });   // A.2 step 6
  }
}, 240_000);

// Moved from tests/app/A2-host-reconcile.test.ts:94 (05125db): A8-3c (W-11, CI-03).
it('W-11 and CTL-08(b): a Run interrupted mid-Turn ends crashed at the restart; the steer the Kernel accepted is applied and the Session retired', async () => {
  const root = await tempDir('a2-crash-steer-ws-');
  const database = await tempDir('a2-crash-steer-db-');
  const publicDir = await publicDirectory();
  let steerRef: ControlIntentSnapshotV1['ref'] | undefined;
  const crashed = await crashMidTurn(root, database, publicDir, {
    beforeBlock: async (host, runRef) => { steerRef = (await submitControl(host, runRef, 'steer', 'A2: also read the tests', 'a2-crash-steer')).intent.ref; },
    // No ack was written before the crash: the observer acks a steer only after the Kernel call returns.
    whileBlocked: async host => { expect(await readControl(host, steerRef!)).toMatchObject({ status: 'queued' }); },
  });
  // Since A.2 step 5.8 the start-up re-drive requeues this interruption automatically (§12.1 step 6b (a));
  // this test reads what the reconcile left, so Host 2 keeps the re-drive off
  // (the moved re-drive case of this file drives the automatic continuation).
  await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    const { runRef } = crashed;
    if (steerRef === undefined) throw new Error('the steer must be submitted');
    // The Kernel accepted the steer at the second model boundary (the blocked request carries it).
    expect(JSON.stringify(crashed.first.scripted.requests[1])).toContain('A2: also read the tests');
    const hostInstanceId = second.host.reconcile.hostInstanceId;
    expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
      runs: [{ ref: JSON.stringify(runRef), row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' }], problems: [],
      // §12.1 step 6b (a) (5.8): the interrupted Task's verdict is requeue, so the Goal is selected either way.
      redriveGoals: [{ goalRef: { goalId: 'ag2b-goal' }, taskIds: ['ag2b-work'] }] } });
    // RUN-19: crashed `host_interrupted` on the takeover basis; the Session is released with its cursor and retired (LA-1).
    const ended = await readExecution(second, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed', terminalPayload: { kind: 'crashed' },
      reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId },
        observation: { kind: 'interrupted_clean', kernelPaused: false, pausedIntentRef: null } } });
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    // CTL-08(b): the steer the Kernel accepted (`control:<sha(intentRef)>`) is applied from that Kernel event.
    const steer = await readControl(second, steerRef);
    expect(steer).toMatchObject({ status: 'applied', observation: { kind: 'steered' } });
    expect(steer.status === 'applied' && 'origin' in steer.observation).toBe(false);
    // W-11: an ordinary interruption (not paused): failed, class interrupted.
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'run_failed' } });
    expect(second.scripted.calls(), 'the reconcile calls no model').toBe(0);
    await assertInvariantsAt({ database }, 'W-11 reconciled');   // A.2 step 6
    // A.2 step 6: §12.10 step 4, while the crashed Host still holds its call (draining it lets its Kernel end the Turn).
    await second.host.close();
    await expectQuietRestart(database, publicDir, root, { label: 'W-11' });
  } finally {
    await crashed.release();
    await second.host.close();
  }
}, 180_000);

// Moved from tests/app/A2-host-reconcile.test.ts:138 (05125db): A8-3d (W-12, CI-04).
it('W-12 (LA-7): a cancel queued while the Turn runs stops the Run at the restart without a Kernel pause; the cancel is applied by the paused stop', async () => {
  const root = await tempDir('a2-crash-cancel-ws-');
  const database = await tempDir('a2-crash-cancel-db-');
  const publicDir = await publicDirectory();
  let cancelRef: ControlIntentSnapshotV1['ref'] | undefined;
  const crashed = await crashMidTurn(root, database, publicDir, {
    whileBlocked: async (host, runRef) => { cancelRef = (await submitControl(host, runRef, 'cancel', 'stop the Run', 'a2-crash-cancel')).intent.ref; },
  });
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    if (cancelRef === undefined) throw new Error('the cancel must be submitted');
    const hostInstanceId = second.host.reconcile.hostInstanceId;
    expect(second.host.reconcile).toMatchObject({ report: {
      runs: [{ ref: JSON.stringify(crashed.runRef), row: 'W-12', status: 'reconciled', reason: 'paused_stop' }], problems: [] } });
    // RUN-23 (restart, Kernel not paused): cancelled `cancelled_at_reconcile`; the Session retired (LA-1).
    const ended = await readExecution(second, crashed.runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled',
      terminalPayload: { kind: 'cancelled', reason: 'cancelled_at_reconcile' },
      reconciliation: { basis: { kind: 'host_instance_takeover', hostInstanceId },
        observation: { kind: 'interrupted_clean', kernelPaused: false, pausedIntentRef: null } } });
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    // CTL-10: the cancel is applied by the paused stop; no pause was in effect (LA-7), so `pausedBy` is null.
    expect(await readControl(second, cancelRef)).toMatchObject({ status: 'applied', observation: { origin: 'platform_paused_stop',
      kind: 'cancelled', detail: { basis: 'host_instance_takeover', pausedBy: null } } });
    await assertInvariantsAt({ database }, 'W-12 reconciled');   // A.2 step 6
    expect(second.scripted.calls(), 'the reconcile calls no model').toBe(0);   // A.2 step 6
    // A.2 step 6: §12.10 step 4, while the crashed Host still holds its call (draining it lets its Kernel end the Turn).
    await second.host.close();
    await expectQuietRestart(database, publicDir, root, { label: 'W-12' });
  } finally {
    await crashed.release();
    await second.host.close();
  }
}, 180_000);

// Moved from tests/app/A2-host-reconcile.test.ts:365 (05125db): A8-3i (W-17, CI-09).
it('§12.1 step 5, W-17 (CI-09): a yielded wait keeps a queued control as its continuation fence at the restart; the report lists it as left', async () => {
  const root = await tempDir('a2-fence-ws-');
  const database = await tempDir('a2-fence-db-');
  const publicDir = await publicDirectory();
  // The work Run sends a wait message to a linked Session that nobody answers, so it really yields (as TD-5).
  let recipient: SessionRef | undefined;
  const send = { callId: 'a2-fence-send', name: 'send_session_message',
    args: { recipient: {}, text: 'A2 fence: a question that nobody answers', replyMode: 'wait' } as Record<string, unknown> };
  const inv: InvariantTarget = { database };   // A.2 step 6
  const first = await startAG2bHost(publicDir, { root, database, replies: [{ kind: 'calls', calls: [send] }],
    beforeReply: async (_request, index) => {
      if (index === 0 && recipient !== undefined) send.args['recipient'] = { projectId: recipient.projectId, sessionId: recipient.sessionId };
    } });
  let runRef: RunRef;
  let pauseRef: ControlIntentSnapshotV1['ref'];
  try {
    const { workTarget } = await seedAG2bWorkGraph(first);
    recipient = (await createAG2bSession(first, 'a2-fence-recipient', AG2B_QUERY_ROLE,
      [{ target: workTarget, relation: 'participates' }])).sessionRef;
    expect((await driveChecked(first, inv, selectWork('a2-fence'))).steps.at(-1)).toMatchObject({ state: 'waiting', next: null });   // A.2 step 6: checked per step
    const selected = (await workRow(first)).execution;
    if (selected === null) throw new Error('the work Run must exist');
    runRef = selected;
    expect((await readExecution(first, runRef)).run).toMatchObject({ status: 'ended', outcome: 'yielded',
      continuation: { kind: 'wait_reply' } });
    // CI-09: a pause on the wait stays queued; it is the fence of the continuation.
    pauseRef = (await submitControl(first, runRef, 'pause', null, 'a2-fence-pause')).intent.ref;
    expect(await readControl(first, pauseRef)).toMatchObject({ status: 'queued' });
    expect(first.scripted.calls(), 'only the wait message called the model').toBe(1);
    await assertInvariantsAt(inv, 'W-17 yielded, pause queued');   // A.2 step 6
  } finally {
    await first.host.close();
  }
  await writeStaleLock(database);
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    // Step 5 reads the queued intent's Run and leaves the fence as it is (CTL-08 "不处理").
    expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { problems: [] } });
    expect(second.host.reconcile.report?.controls).toEqual([
      expect.objectContaining({ ref: JSON.stringify(runRef), row: 'W-17', status: 'left' })]);
    expect(await readControl(second, pauseRef)).toMatchObject({ status: 'queued' });
    expect((await readExecution(second, runRef)).run).toMatchObject({ status: 'ended', outcome: 'yielded',
      controlState: { desiredState: 'paused' } });
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'continuation_paused' } });
    expect(second.scripted.calls(), 'the reconcile calls no model').toBe(0);
    await assertInvariantsAt(inv, 'W-17 left at the restart');   // A.2 step 6
  } finally {
    await second.host.close();
  }
  await expectQuietRestart(database, publicDir, root, { label: 'W-17' });   // A.2 step 6
}, 180_000);

// Moved from tests/app/A2-host-restart.test.ts:285 (05125db): A8-3f (W-14) and RUN-22.
it('W-14 and RUN-22: with the Kernel store gone at the restart the Run ends outcome_unknown and keeps its Session; the operator attests the end over executions/resolve-unknown', async () => {
  const root = await tempDir('a2-attest-ws-');
  const database = await tempDir('a2-attest-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };   // A.2 step 6
  const { runRef, oldSession } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv);   // A.2 step 6: checked per step
  // The mapped Kernel database is lost with the crashed Host: the probe is `missing` (SD-3: no proof of anything).
  await moveKernelAside(database);

  const second = await startAG2bHost(publicDir, { root, database });
  try {
    const hostInstanceId = second.host.reconcile.hostInstanceId;
    expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03',
      report: { sessions: [{ row: 'H-02', status: 'reconciled' }],
        runs: [{ ref: JSON.stringify(runRef), row: 'W-14', status: 'reconciled', reason: 'unknown' }], problems: [] } });
    // RUN-20 (W-14): outcome_unknown with the unreadable Kernel; the unknown holder keeps the Session (I-2, D-4).
    const unknown = await readExecution(second, runRef);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      reconciliation: { status: 'quarantined', observation: { kind: 'unresolved' },
        basis: { kind: 'host_instance_takeover', hostInstanceId } } });
    expect(unknown.session).toMatchObject({ occupancy: { kind: 'execution', executionRef: { runId: runRef.runId } },
      health: 'unavailable', healthConclusion: 'missing' });
    await assertInvariantsAt(inv, 'W-14 reconciled');   // A.2 step 6
    const sessionRef: SessionRef = { projectId: unknown.session.ref.projectId, sessionId: unknown.session.ref.sessionId };
    // LD-4: a missing Kernel history keeps refusing the public read.
    expect(await answer(second, 'sessions/history', plain(AG2B_SCOPE, { sessionRef, afterCursor: null, throughCursor: null, limit: 10 })))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });

    // RUN-22 (U): the attestation needs a reason; then the Run ends crashed `human_attested` and the Session is released.
    expect(await answer(second, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE, { runRef, reason: '   ' },
      'a2-attest-empty', [{ ref: runRef, revision: unknown.run.revision }]))).toMatchObject({ status: 'rejected', code: 'invalid' });
    const attested = await post<WriteResult<unknown>>(second, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
      { runRef, reason: 'checked the workspace by hand: nothing was written' }, 'a2-attest',
      [{ ref: runRef, revision: unknown.run.revision }]));
    expect(attested).toMatchObject({ status: 'committed', replayed: false });
    await assertInvariantsAt(inv, 'W-14 attested', attestedStep);   // A.2 step 6
    const ended = await readExecution(second, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      terminalPayload: { kind: 'crashed', error: 'human_attested: checked the workspace by hand: nothing was written' },
      reconciliation: { status: 'done', observation: { kind: 'human_attested', attestedBy: second.actor,
        reason: 'checked the workspace by hand: nothing was written' }, basis: { kind: 'host_instance_takeover', hostInstanceId } } });
    // SES-07 + LA-1: released with the cursor kept; the unreadable Kernel retires the Session.
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open',
      historyCursor: oldSession.historyCursor });
    // A known terminal is never rewritten.
    expect(await answer(second, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE, { runRef, reason: 'again' },
      'a2-attest-again', [{ ref: runRef, revision: ended.run.revision }]))).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(second.scripted.calls()).toBe(0);
  } finally {
    await second.host.close();
  }
  // A.2 step 6: the Kernel still missing, H-02 meets kernel_turn_open (SES-19 keeps it).
  await expectQuietRestart(database, publicDir, root, { label: 'W-14 attested' });
}, 180_000);

// Moved from tests/app/A2-host-restart.test.ts:335 (05125db): A8-2c (W-07, CI-10), A8-3g (W-15) and RUN-22 (CI-07).
it('W-14 then W-07, W-15 and RUN-22 on a readable Kernel: a probe that proves nothing refuses the attestation without a write; the attestation of the open Turn retires the Session', async () => {
  const root = await tempDir('a2-attest2-ws-');
  const database = await tempDir('a2-attest2-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };   // A.2 step 6
  const { runRef, oldSession } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv);   // A.2 step 6: checked per step
  const aside = await moveKernelAside(database);

  // Host 2: the Kernel is missing (W-14): the unknown end keeps its Session.
  const second = await startAG2bHost(publicDir, { root, database });
  let unknown: TaskExecutionRecord;
  try {
    expect(second.host.reconcile).toMatchObject({ report: { runs: [{ ref: JSON.stringify(runRef), row: 'W-14', status: 'reconciled' }] } });
    unknown = await readExecution(second, runRef);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
    await assertInvariantsAt(inv, 'W-14 reconciled');   // A.2 step 6
  } finally {
    await second.host.close();
  }
  await restoreKernel(database, aside);

  // Host 3 without the Kernel Store registration: the probe is `host_config`, which proves nothing (SD-2):
  // the Session and the Run are left (H-03, W-07) and the attestation is refused `unavailable` without a write.
  const third = await startAG2bHost(publicDir, { root, database, noKernelStores: true });
  try {
    expect(third.host.reconcile).toMatchObject({ lease: 'owned', report: {
      sessions: [{ ref: sessionKey(oldSession), row: 'H-03', status: 'left' }],
      runs: [{ ref: JSON.stringify(runRef), row: 'W-07', status: 'left' }], problems: [] } });
    const refused = await answer(third, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
      { runRef, reason: 'checked by hand' }, 'a2-attest2-host-config', [{ ref: runRef, revision: unknown.run.revision }]));
    expect(refused).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(String(refused['reason'])).toContain('host_config');
    expect((await readExecution(third, runRef)).run).toMatchObject({ revision: unknown.run.revision, outcome: 'outcome_unknown' });
    await assertInvariantsAt(inv, 'W-07 left');   // A.2 step 6
  } finally {
    await third.host.close();
  }

  // Host 4 with the Kernel readable again: the Turn is still paused, no new Kernel terminal (W-15 left);
  // the probe makes the Session available again while the unknown holder keeps it (SES-13).
  const fourth = await startAG2bHost(publicDir, { root, database });
  try {
    expect(fourth.host.reconcile).toMatchObject({ lease: 'owned', report: {
      sessions: [{ ref: sessionKey(oldSession), row: 'H-01', status: 'reconciled' }],
      runs: [{ ref: JSON.stringify(runRef), row: 'W-15', status: 'left' }], problems: [] } });
    const before = await readExecution(fourth, runRef);
    expect(before.session).toMatchObject({ occupancy: { kind: 'execution', executionRef: { runId: runRef.runId } }, health: 'available' });
    // RUN-22 on a readable Kernel: the attested Turn has no Kernel terminal, so the Session is retired (SES-07, LA-1).
    const attested = await post<WriteResult<unknown>>(fourth, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
      { runRef, reason: 'the paused Turn did nothing more' }, 'a2-attest2', [{ ref: runRef, revision: before.run.revision }]));
    expect(attested).toMatchObject({ status: 'committed' });
    await assertInvariantsAt(inv, 'W-15 attested', attestedStep);   // A.2 step 6
    const ended = await readExecution(fourth, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { observation: { kind: 'human_attested', reason: 'the paused Turn did nothing more' } } });
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open',
      historyCursor: oldSession.historyCursor });
    expect(fourth.scripted.calls()).toBe(0);
  } finally {
    await fourth.host.close();
  }
  await expectQuietRestart(database, publicDir, root, { label: 'W-15 attested' });   // A.2 step 6
}, 240_000);

// Moved from tests/app/A2-automation-rework.test.ts:246 (05125db): the start-up re-drive of an interrupted Run (A8-3n row W-11,
// §13.4 #17) on and off; its W-23 half is cited by A4.
it('§12.1 step 6b (a), W-11, RUN-19, §13.4 #17, LA-1: an interrupted Run is requeued by the start-up re-drive, uncounted, in a new Session; off, only a workflow/advance requeues it, with the same identity from any flow (W-23)', async () => {
  for (const resumeOnStartup of [true, false]) {
    const root = await tempDir('a2-redrive-ws-');
    const database = await tempDir('a2-redrive-db-');
    const publicDir = await publicDirectory();
    const inv: InvariantTarget = { database };   // A.2 step 6
    const crashed = await crashMidTurn(root, database, publicDir, {}, 'a2-redrive-crash', inv);   // A.2 step 6: checked per step
    if (!resumeOnStartup) await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
    const second = await startAG2bHost(publicDir, { root, database, replies: editThenText('a2-redrive') });
    try {
      // W-11 at the restart; step 6b selects the Goal by condition (a) (verdict requeue, class interrupted) either way.
      expect(second.host.reconcile, String(resumeOnStartup)).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
        runs: [{ ref: JSON.stringify(crashed.runRef), row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' }],
        redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }], problems: [] } });
      if (resumeOnStartup) {
        let display = await goalDisplay(second);
        for (let attempt = 0; attempt < 300 && display.phase !== 'COMPLETED'; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
          display = await goalDisplay(second);
        }
        expect(display, 'the start-up re-drive completed the Goal without a workflow/advance').toMatchObject({ phase: 'COMPLETED' });
        const done = await workRow(second);
        expect(done).toMatchObject({ effectivePhase: 'satisfied', rework: { requeueAutoCount: 0, entries: [{
          afterRunRef: crashed.runRef, failureClass: 'interrupted', automatic: true, autoCount: 0,
          requestedBy: WORKFLOW_AUTOMATION_ACTOR, reason: 'auto-rework:interrupted#0' }] } });
        const run2Ref = done.execution;
        if (run2Ref === null || run2Ref.runId === crashed.runRef.runId) throw new Error('the continuation Run must be selected');
        const run1 = await readExecution(second, crashed.runRef);
        const run2 = await readExecution(second, run2Ref);
        expect(run1.run).toMatchObject({ status: 'ended', outcome: 'crashed', reconciliation: { observation: { kind: 'interrupted_clean' } } });
        // LA-1: Run 1's Kernel Turn has no terminal, so its Session is retired and the continuation runs in a new one.
        expect(run1.session).toMatchObject({ health: 'unavailable', healthConclusion: 'kernel_turn_open' });
        expect(run2.run).toMatchObject({ outcome: 'completed' });
        expect(run2.session.ref.sessionId).not.toBe(run1.session.ref.sessionId);
        expect(await readBrief(second, run2Ref)).toMatchObject({ mode: 'resume_after_interruption', failureClass: 'interrupted',
          trigger: { actorClass: 'system', requeueNumber: 1 }, previous: { runRef: crashed.runRef } });
        expect(second.scripted.calls(), 'the continuation Run only').toBe(2);
        await assertInvariantsAt(inv, 'W-11 re-driven at the start');   // A.2 step 6
      } else {
        // Off: the reconciliation ran, no driver started; the verdict waits for the next 推进.
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(second.scripted.calls(), 'no driver started').toBe(0);
        expect(await workRow(second)).toMatchObject({ effectivePhase: 'failed', failure: {
          failureClass: 'interrupted', interruption: { kind: 'executing' },
          automation: { verdict: { kind: 'requeue', failureClass: 'interrupted', retryAfterRefusal: false } } } });
        await assertInvariantsAt(inv, 'W-11 after the reconcile');   // A.2 step 6
        const next = await post<{ status: string; value: AdvanceValue }>(second, 'workflow/advance',
          plain(AG2B_SCOPE, selectWork('a2-redrive-later', true)));
        expect(next).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'perform', operation: {
          kind: 'requeue_task', request: { input: { afterRunRef: crashed.runRef, reason: 'auto-rework:interrupted#0' } } } } } });
        // W-23: the request's identity is its own, not the flow's. The same step selected by another flow (another
        // driver, or a retry after a lost answer) replays the first one's receipt; one TaskRequeue is written.
        const other = await post<{ status: string; value: AdvanceValue }>(second, 'workflow/advance',
          plain(AG2B_SCOPE, selectWork('a2-redrive-other')));
        const request = (value: AdvanceValue): unknown =>
          value.next?.kind === 'perform' && value.next.operation.kind === 'requeue_task' ? value.next.operation.request : null;
        expect(request(other.value)).toEqual(request(next.value));
        const first = await post<{ status: string; value: AdvanceValue }>(second, 'workflow/advance', plain(AG2B_SCOPE, next.value.next));
        expect(first).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'select_work' },
          receipt: { kind: 'requeue_task', result: { status: 'committed', replayed: false, value: { kind: 'requeued' } } } } });
        const replayed = await post<{ status: string; value: AdvanceValue }>(second, 'workflow/advance', plain(AG2B_SCOPE, other.value.next));
        const firstResult = first.value.receipt?.kind === 'requeue_task' ? first.value.receipt.result : null;
        expect(replayed).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'select_work', flowId: 'a2-redrive-other' },
          receipt: { kind: 'requeue_task', result: { status: 'committed', replayed: true,
            value: (firstResult as { value?: unknown } | null)?.value } } } });
        expect(await workRow(second)).toMatchObject({ effectivePhase: 'pending',
          rework: { entries: [{ afterRunRef: crashed.runRef, reason: 'auto-rework:interrupted#0' }] } });
        expect(((await workRow(second)).rework as { entries: unknown[] }).entries).toHaveLength(1);
        expect(second.scripted.calls(), 'performing the requeue calls no model').toBe(0);
        await assertInvariantsAt(inv, 'W-11 requeued by workflow/advance', { kind: 'task_requeued',
          actor: { ...WORKFLOW_AUTOMATION_ACTOR }, automationPolicy: redrivePolicy(false) });   // A.2 step 6
      }
      // A.2 step 6: §12.10 step 4, while the crashed Host still holds its call (draining it lets its Kernel end the Turn).
      await second.host.close();
      await expectQuietRestart(database, publicDir, root, { label: `W-11 re-drive ${String(resumeOnStartup)}` });
    } finally {
      await crashed.release();
      await second.host.close();
    }
  }
}, 360_000);
