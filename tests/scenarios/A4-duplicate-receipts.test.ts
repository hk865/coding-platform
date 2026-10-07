/**
 * A.2 step 6, scenario A4 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步"
 * row A4; ORCHESTRATION §3.1 "同幂等键、同输入重复" and §11 A4; §12.2 W-23,
 * §12.4 C-05, §12.9 "单笔提交中途崩溃"; §13.2 point 5, §13.3 "同一 requestId 再次请求")
 * through the real Host over HTTP on one SQLite ledger and Kernel store, with the
 * scripted model of the shared harness (tests/scenarios/harness.ts):
 *
 * 1. 领取、发信、记录结果: every Workflow step of a Run, of its round and of the
 *    gate (Session, claim, prepare, start, open, check, finalize, completion) and
 *    of the Goal completion is sent a second time as if its answer was lost; the
 *    claim and the Goal completion a third time on the next Host after a crash.
 *    A write replays its original receipt, a read-shaped step answers the same
 *    record, and no Kernel start, model call, check process or ledger write is
 *    added. An operator message (`messages/send`) to an idle Session is sent twice
 *    and again after a crash: one message.
 * 2. requeue and its committed refusal (W-23): the requeue commit fails inside its
 *    transaction (the Host stops before COMMIT) and leaves nothing; after the
 *    restart the same request commits once; a copy on the same Host and one after
 *    another crash replay it. The second automatic requeue's refusal goes the same
 *    way, and its replay is the same `refused` value. The operator's requeue
 *    (`tasks/requeue`, refused @2) fails inside its commit the same way, commits
 *    once with the same body after a crash, and replays on that Host and the next.
 * 3. reverify and its committed refusal (C-05): the same for the automatic
 *    successor round of a timed-out check, and for the `no_new_basis{reverify}`
 *    refusal of the next one; each failed commit is re-derived as the same request.
 * 4. 控制、发信与核对: a steer on a claimed Run and an operator message to its
 *    Session, each re-sent, reach the Turn once (once in the model request, once in
 *    the Kernel); the copies after the Run entered and after the crashes replay
 *    them. The next Host's W-11 reconcile fails inside its commit and leaves
 *    nothing; the Host after it completes the reconcile once; the one after that
 *    writes nothing. The `start` whose answer the first crash lost starts no
 *    Kernel Turn and calls no model.
 * 5. 发信 by an Agent: the running Run's `send_session_message` write (the owner call
 *    its tool makes, one requestId per tool call) fails inside its commit and leaves
 *    nothing; the same request commits once and every copy replays it.
 * 6. 记录结果: the Runtime's result write fails (the ledger locked while the Kernel
 *    ends the Turn, as A8-3a); the re-sent `start` makes the Runtime retry the SAME
 *    submission (one identity per terminal boundary): the terminal is written once,
 *    no Kernel Turn or model call is added, and a further copy writes nothing. The
 *    owner's replay of an already committed result write has no public seam (only the
 *    Runtime sends it); it is service-level (below).
 *
 * Cited, not repeated (user decision 31): the cross-flow half of W-23 (another
 * flow selects the same `requeue_task` and replays the first one's receipt) is the
 * moved `tests/app/A2-automation-rework.test.ts` test 3 in
 * tests/scenarios/A8-host-restart.test.ts ("§12.1 step 6b (a), W-11, RUN-19, §13.4
 * #17 …"); the Runtime's own result write (`recordRunResult`, one identity per
 * terminal) replayed with the same identity is tests/work-graph/B2-execution-result.test.ts
 * ("one complete Turn atomically ends …") and retried after a failed commit is
 * tests/runtime/B2-runtime-execution.test.ts ("the same observer retries a failed
 * genuine terminal commit …"); the agent's `send_session_message` keeps one
 * requestId per tool call (tests/runtime/C1-communication-tools.test.ts "derives
 * one requestId from the trusted call id …"). After every step that changes
 * records the §11 invariants are checked (`advance()`, `performOnce`, every
 * restart). No real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { SubmittedControl } from '../../src/contracts/control-intent.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import { WORKFLOW_AUTOMATION_ACTOR, type TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { SessionMessage } from '../../src/core/work-graph/communication/contracts.js';
import {
  AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  assertInvariants, cleanupScenarios, openHostScenario, performs, SCENARIO_OPERATOR, workRunCtx, type HostScenario,
} from './harness.js';
import {
  NO_REDRIVE, WORK_TARGET, committedOutcomesOf, editThenText, execution, lockLedger, openWorkRoot, replayOf, requeueBodyOf, selectedRun,
  stepOf, textReply,
} from './support/common.js';
import {
  OPERATOR_RETRY, eventCount, failCommitOf, kernelRecordsContaining, performOnce, rawAdvance, rawPost, writeStatusOf,
} from './support/receipts.js';

afterEach(cleanupScenarios);

const W = AG2B_WORK_TASK_ID;

/** The operation a `perform` names (its owner request with the request identity); null for anything else. */
function operationOf(input: WorkflowAdvanceInput | null): unknown {
  return input?.kind === 'perform' ? input.operation : null;
}

it('A4 (领取、发信、记录结果): every step of a Run, its rounds and the Goal completion, sent again after its answer is lost — on the same Host or after a crash — returns the original receipt; no Kernel start, model call, check process or write is added', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, script: { replies: editThenText('a4-steps') } });
  await assertInvariants(h, 'seeded');
  let input: WorkflowAdvanceInput = h.select('a4-steps');
  const resent: string[] = [];
  for (let step = 0; ; step += 1) {
    if (step > 40) throw new Error('the Workflow did not settle');
    const first = await performOnce(h, input, `a4-steps#${step}`);
    let answer = first;
    if (input.kind === 'perform') {
      const kind = input.operation.kind;
      const before = h.counts();
      const kernel = h.kernelSnapshot();
      // The first answer is lost: the driver sends the same request again and goes on with this answer.
      const again = await performOnce(h, input, `a4-steps#${step} ${kind} again`);
      expect(h.counts(), `${kind}: the copy started nothing and wrote nothing`).toEqual(before);
      expect(h.kernelSnapshot(), `${kind}: the Kernel store is unchanged, byte for byte`).toEqual(kernel);
      if (kind === 'prepare') {
        // A preparation writes nothing, so there is no receipt to replay: it is rebuilt from the same claim
        // with the same manifest and input binding; only the per-call envelope id is new.
        expect(again.receipt).toMatchObject({ kind: 'prepare', result: { status: 'ready' } });
        const preparedOf = (value: typeof first) => {
          const receipt = value.receipt;
          if (receipt?.kind !== 'prepare' || receipt.result.status !== 'ready') throw new Error('prepare must be ready');
          const { envelope, ...rest } = receipt.result.value as unknown as { envelope: Record<string, unknown> } & Record<string, unknown>;
          const { envelopeId: _envelopeId, ...envelopeRest } = envelope;
          return { ...rest, envelope: envelopeRest };
        };
        expect(preparedOf(again)).toEqual(preparedOf(first));
      } else {
        expect(again, `${kind}: the same request answers the original receipt`).toEqual({ ...first, receipt: replayOf(first.receipt) });
      }
      if (kind === 'claim_task' || kind === 'complete_goal') {
        // The Host crashes before the answer reaches the driver; the next Host answers the same request.
        await h.restart({ crash: true });
        expect(h.counts(), `${kind}: the reconcile after the crash wrote nothing`).toEqual(before);
        const afterCrash = await performOnce(h, input, `a4-steps#${step} ${kind} after a crash`);
        expect(afterCrash, `${kind}: replayed by the next Host`).toEqual({ ...first, receipt: replayOf(first.receipt) });
        expect(h.counts()).toEqual(before);
      }
      resent.push(kind);
      answer = again;
    }
    if (answer.state === 'completed' || answer.next === null) {
      expect(answer.state).toBe('completed');
      break;
    }
    input = answer.next;
  }
  expect(resent).toEqual(['create_session', 'claim_task', 'prepare', 'start', 'open_checks', 'run_check', 'finalize_checks',
    'complete_task', 'open_checks', 'run_check', 'finalize_checks', 'complete_task', 'complete_goal']);
  // One Turn, two model calls, one check process per round, one claim, one Goal completion.
  expect(h.counts()).toMatchObject({ modelCalls: 2, kernelTurnsStarted: 1, checksBegun: 2 });
  expect(eventCount(h, 'TaskClaimed')).toBe(1);
  expect(eventCount(h, 'ExecutionEntryAuthorized')).toBe(1);
  expect(h.lastWorld?.runs).toHaveLength(1);
  expect(await h.goalDisplay()).toMatchObject({ phase: 'COMPLETED' });
  expect(h.abandonedCalls()).toEqual([]);

  // 发信: an operator message to the work Session, its answer lost, then again after a crash: one message.
  const session = (await execution(h, await selectedRun(h))).session.ref;
  const recipient = { projectId: session.projectId, sessionId: session.sessionId };
  const body = graphWrite(AG2B_SCOPE, { recipient, text: 'A4: the work is accepted' }, 'a4-message', []);
  const sent = await h.post<WriteResult<SessionMessage>>('messages/send', body);
  expect(sent).toMatchObject({ status: 'committed', replayed: false, value: { status: 'pending', recipient } });
  await assertInvariants(h, 'message sent', stepOf(h, 'other', 'message sent', SCENARIO_OPERATOR));
  const afterMessage = h.counts();
  expect(await h.post('messages/send', body), 'the same message request replays').toEqual({ ...sent, replayed: true });
  await h.restart({ crash: true });
  expect(await h.post('messages/send', body), 'and replays on the next Host').toEqual({ ...sent, replayed: true });
  expect(h.counts()).toEqual(afterMessage);
  const inbox = await h.post<ReadResult<{ items: SessionMessage[] }>>('messages/inbox', plain(AG2B_SCOPE, { recipient, page: { limit: 20 } }));
  expect(inbox).toMatchObject({ status: 'ready', value: { items: [{ ref: sent.status === 'committed' ? sent.value.ref : null }] } });
  expect(inbox.status === 'ready' && inbox.value.items).toHaveLength(1);
}, 120_000);

it('A4, W-23: a requeue and its committed refusal that fail inside the commit leave nothing; after the restart the same request commits once, and every later copy — same Host, after a crash, from the operator — replays the original receipt', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'fail',
    script: { replies: [textReply('A4 requeue: Run 1 changes nothing'), textReply('A4 requeue: Run 2 changes nothing')] } });
  // Run 1's round FAILs; the Workflow's next request is the automatic requeue (#1 of 3).
  const toRequeue = await h.advance(h.select('a4-requeue', W), { stopBefore: performs('requeue_task') });
  expect(toRequeue.state).toBe('stopped');
  expect(committedOutcomesOf(toRequeue)).toEqual(['FAIL']);
  const requeueInput = toRequeue.next!;
  const run1Ref = await selectedRun(h);

  // W-23: the Host stops inside the requeue's transaction (after its event and records were written, before
  // COMMIT): nothing is committed and the transaction leaves no event, record or receipt.
  const beforeRequeue = h.counts();
  const requeueFault = failCommitOf(h.database, 'TaskRequeued');
  const failed = await rawAdvance(h, requeueInput);
  requeueFault.drop();
  expect(writeStatusOf(failed), 'no committed receipt').toBe('rejected');
  expect(h.counts(), 'the rolled-back requeue left nothing').toEqual(beforeRequeue);
  const untouched = await h.taskRow();
  expect(untouched).toMatchObject({ effectivePhase: 'failed', failure: { automation: { coveringRequeue: null, lastRefusal: null,
    verdict: { kind: 'requeue', failureClass: 'check_failed' } } } });
  expect(untouched.rework).toBeUndefined();
  await assertInvariants(h, 'W-23: the requeue rolled back');
  // The crash: the next Host has nothing to reconcile (§12.2 W-23 "不需要核对").
  const report = await h.restart({ crash: true });
  expect(report.report).toMatchObject({ runs: [], queries: [], checks: [], controls: [], problems: [] });
  expect(h.counts()).toEqual(beforeRequeue);
  // The new Host's Workflow derives the same request from the pins, whatever the flow: the same identity.
  const derivedRequeue = await performOnce(h, h.select('a4-requeue-after-crash', W), 'W-23 re-derived');
  expect(operationOf(derivedRequeue.next)).toEqual(operationOf(requeueInput));

  // The same request: the first commit (nothing was committed before).
  const requeued = await performOnce(h, requeueInput, 'W-23 retry');
  expect(requeued).toMatchObject({ state: 'advance', next: { kind: 'select_work' }, receipt: { kind: 'requeue_task',
    result: { status: 'committed', replayed: false, value: { kind: 'requeued', requeue: { afterRunRef: run1Ref,
      failureClass: 'check_failed', basisComparison: 'compared', reason: 'auto-rework:check_failed#1',
      requestedBy: WORKFLOW_AUTOMATION_ACTOR, automation: { automatic: true, counted: true, autoCount: 1, cap: 3 } } } } } });
  expect(eventCount(h, 'TaskRequeued')).toBe(1);
  const requeue1Ref = (requeued.receipt?.result as { value: { requeue: { ref: TaskRequeueRef } } }).value.requeue.ref;
  const afterRequeue = h.counts();
  // Its answer is lost: the same request replays on the same Host, and again after a crash.
  expect(await performOnce(h, requeueInput, 'W-23 answer lost')).toEqual({ ...requeued, receipt: replayOf(requeued.receipt) });
  await h.restart({ crash: true });
  expect(await performOnce(h, requeueInput, 'W-23 after a crash')).toEqual({ ...requeued, receipt: replayOf(requeued.receipt) });
  expect(h.counts()).toEqual(afterRequeue);

  // Run 2 claims the requeue and FAILs the same way: the next request is the second automatic requeue.
  const toRefusal = await h.advance(requeued.next!, { stopBefore: performs('requeue_task') });
  expect(committedOutcomesOf(toRefusal)).toEqual(['FAIL']);
  const refusalInput = toRefusal.next!;
  const run2Ref = await selectedRun(h);
  expect(run2Ref.runId).not.toBe(run1Ref.runId);
  // W-23 for the refusal: its commit fails inside the transaction and leaves no refusal record.
  const beforeRefusal = h.counts();
  const refusalFault = failCommitOf(h.database, 'TaskReworkRefused');
  const refusalFailed = await rawAdvance(h, refusalInput);
  refusalFault.drop();
  expect(writeStatusOf(refusalFailed), 'no committed receipt').toBe('rejected');
  expect(h.counts(), 'the rolled-back refusal left nothing').toEqual(beforeRefusal);
  expect(await h.taskRow()).toMatchObject({ failure: { automation: { lastRefusal: null } } });
  await assertInvariants(h, 'W-23: the refusal rolled back');
  await h.restart({ crash: true });
  expect(h.counts()).toEqual(beforeRefusal);
  const derivedRefusal = await performOnce(h, h.select('a4-refusal-after-crash', W), 'W-23 refusal re-derived');
  expect(operationOf(derivedRefusal.next)).toEqual(operationOf(refusalInput));
  const refused = await performOnce(h, refusalInput, 'W-23 refusal retry');
  expect(refused).toMatchObject({ state: 'advance', next: { kind: 'select_work' }, receipt: { kind: 'requeue_task',
    result: { status: 'committed', replayed: false, value: { kind: 'refused', refusal: { revision: 1, code: 'no_new_basis',
      afterRunRef: run2Ref, matchedRequeueRef: requeue1Ref, requestedBy: WORKFLOW_AUTOMATION_ACTOR } } } } });
  const afterRefusal = h.counts();
  // The committed refusal replays as the same `refused` value, on the same Host and after a crash (§13.3).
  expect(await performOnce(h, refusalInput, 'refusal answer lost')).toEqual({ ...refused, receipt: replayOf(refused.receipt) });
  await h.restart({ crash: true });
  expect(await performOnce(h, refusalInput, 'refusal after a crash')).toEqual({ ...refused, receipt: replayOf(refused.receipt) });
  expect(h.counts()).toEqual(afterRefusal);

  // W-23 for a person's request ("人工请求同样按同一身份重试"): the operator's requeue with nothing new is refused
  // too (@2, hard limit 2). Its commit fails inside the transaction and leaves nothing; after the crash the same
  // body commits once, and every later copy, on that Host and after another crash, replays it.
  const operatorBody = await requeueBodyOf(h.host, run2Ref, 'a4-operator-requeue', OPERATOR_RETRY, W);
  const operatorFault = failCommitOf(h.database, 'TaskReworkRefused');
  const operatorFailed = await rawPost(h, 'tasks/requeue', operatorBody);
  operatorFault.drop();
  expect(writeStatusOf(operatorFailed), 'no committed receipt').toBe('rejected');
  expect(h.counts(), 'the rolled-back operator refusal left nothing').toEqual(afterRefusal);
  expect(await h.taskRow()).toMatchObject({ failure: { automation: { lastRefusal: { revision: 1 } } } });
  await assertInvariants(h, 'W-23: the operator refusal rolled back');
  await h.restart({ crash: true });
  expect(h.counts()).toEqual(afterRefusal);
  const operator = await h.answer('tasks/requeue', operatorBody);
  expect(operator).toMatchObject({ status: 'committed', replayed: false, value: { kind: 'refused', refusal: {
    revision: 2, code: 'no_new_basis', afterRunRef: run2Ref, requestedBy: SCENARIO_OPERATOR } } });
  await assertInvariants(h, 'operator refusal', stepOf(h, 'task_rework_refused', 'operator refusal', SCENARIO_OPERATOR));
  const afterOperator = h.counts();
  expect(await h.answer('tasks/requeue', operatorBody), 'its answer lost: the same body replays').toEqual({ ...operator, replayed: true });
  await h.restart({ crash: true });
  expect(await h.answer('tasks/requeue', operatorBody), 'and replays on the next Host').toEqual({ ...operator, replayed: true });
  expect(h.counts()).toEqual(afterOperator);

  // One TaskRequeue, two refusals, two Runs: every copy above was answered from the ledger.
  expect(eventCount(h, 'TaskRequeued')).toBe(1);
  expect(eventCount(h, 'TaskReworkRefused')).toBe(2);
  expect(h.counts()).toMatchObject({ modelCalls: 2, kernelTurnsStarted: 2, checksBegun: 2 });
  expect(h.lastWorld?.requeues).toHaveLength(1);
  expect(h.lastWorld?.refusals).toMatchObject([{ revision: 2 }]);
}, 120_000);

it('A4, C-05: an automatic reverify and its committed refusal that fail inside the commit leave nothing; after the restart the same request commits once and every later copy replays the original receipt', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, check: { timeoutAfterMs: 1_000 },
    script: { replies: [textReply('A4 reverify: Run 1 changes nothing')] } });
  // Round 1's check times out (INCONCLUSIVE); the next request is the automatic successor round.
  const toReverify = await h.advance(h.select('a4-reverify', W), { stopBefore: performs('reverify_round') });
  expect(toReverify.state).toBe('stopped');
  expect(committedOutcomesOf(toReverify)).toEqual(['INCONCLUSIVE']);
  const reverifyInput = toReverify.next!;
  const round1Ref = (await h.taskRow()).failure?.round?.roundRef;
  expect(round1Ref).toBeDefined();

  // C-05: the reverify's transaction (successor round, slot CAS, superseded ids, event) fails before COMMIT;
  // the owner answers that the commit result is unknown and nothing is left.
  const beforeReverify = h.counts();
  const reverifyFault = failCommitOf(h.database, 'VerificationRoundReverified');
  const failed = await performOnce(h, reverifyInput, 'C-05 mid-commit');
  reverifyFault.drop();
  expect(failed).toMatchObject({ state: 'waiting', next: null, receipt: { kind: 'reverify_round',
    result: { status: 'rejected', code: 'unavailable' } } });
  expect(h.counts(), 'the rolled-back reverify left nothing').toEqual(beforeReverify);
  expect(h.lastWorld?.rounds).toHaveLength(1);
  const report = await h.restart({ crash: true });
  expect(report.report).toMatchObject({ runs: [], checks: [], controls: [], problems: [] });
  expect(h.counts()).toEqual(beforeReverify);
  // The requestId is derived from the predecessor and refusal pins: the new Host's Workflow derives the same request.
  const derivedReverify = await performOnce(h, h.select('a4-reverify-after-crash', W), 'C-05 re-derived');
  expect(operationOf(derivedReverify.next)).toEqual(operationOf(reverifyInput));

  const reverified = await performOnce(h, reverifyInput, 'C-05 retry');
  expect(reverified).toMatchObject({ state: 'advance', next: { kind: 'select_work' }, receipt: { kind: 'reverify_round',
    result: { status: 'committed', replayed: false, value: { kind: 'reverified', round: { status: 'open',
      chain: { ordinal: 2, predecessorRoundRef: round1Ref, autoCount: 1 } } } } } });
  expect(eventCount(h, 'VerificationRoundReverified')).toBe(1);
  const afterReverify = h.counts();
  expect(await performOnce(h, reverifyInput, 'C-05 answer lost')).toEqual({ ...reverified, receipt: replayOf(reverified.receipt) });
  await h.restart({ crash: true });
  expect(await performOnce(h, reverifyInput, 'C-05 after a crash')).toEqual({ ...reverified, receipt: replayOf(reverified.receipt) });
  expect(h.counts()).toEqual(afterReverify);
  expect(h.lastWorld?.rounds).toHaveLength(2);

  // The successor's check times out the same way on the same source: the next automatic reverify is the
  // committed `no_new_basis{reverify}` refusal; its commit fails once inside the transaction, then commits.
  const toRefusal = await h.advance(reverified.next!, { stopBefore: performs('reverify_round') });
  expect(committedOutcomesOf(toRefusal)).toEqual(['INCONCLUSIVE']);
  const refusalInput = toRefusal.next!;
  const beforeRefusal = h.counts();
  const refusalFault = failCommitOf(h.database, 'TaskReworkRefused');
  const refusalFailed = await performOnce(h, refusalInput, 'C-05 refusal mid-commit');
  refusalFault.drop();
  expect(refusalFailed).toMatchObject({ state: 'waiting', receipt: { kind: 'reverify_round', result: { status: 'rejected', code: 'unavailable' } } });
  expect(h.counts()).toEqual(beforeRefusal);
  await h.restart({ crash: true });
  expect(h.counts(), 'the restart after the rolled-back refusal wrote nothing').toEqual(beforeRefusal);
  // 13.7 / C-05: the refusal's requestId comes from the predecessor and refusal pins, so a new flow derives the same request.
  const derivedRefusal = await performOnce(h, h.select('a4-reverify-refusal-after-crash', W), 'C-05 refusal re-derived');
  expect(operationOf(derivedRefusal.next)).toEqual(operationOf(refusalInput));
  const refused = await performOnce(h, refusalInput, 'C-05 refusal retry');
  expect(refused).toMatchObject({ receipt: { kind: 'reverify_round', result: { status: 'committed', replayed: false,
    value: { kind: 'refused', refusal: { revision: 1, code: 'no_new_basis', ref: { operation: 'reverify' },
      requestedBy: WORKFLOW_AUTOMATION_ACTOR } } } } });
  const afterRefusal = h.counts();
  expect(await performOnce(h, refusalInput, 'reverify refusal answer lost')).toEqual({ ...refused, receipt: replayOf(refused.receipt) });
  await h.restart({ crash: true });
  expect(await performOnce(h, refusalInput, 'reverify refusal after a crash')).toEqual({ ...refused, receipt: replayOf(refused.receipt) });
  expect(h.counts()).toEqual(afterRefusal);

  // One successor round, one refusal, two check processes, one Turn and one model call in all.
  expect(eventCount(h, 'VerificationRoundReverified')).toBe(1);
  expect(eventCount(h, 'TaskReworkRefused')).toBe(1);
  expect(h.counts()).toMatchObject({ modelCalls: 1, kernelTurnsStarted: 1, checksBegun: 2 });
}, 120_000);

it('A4 (控制、发信、核对): a steer and an operator message re-sent before and after the Run entered reach the Turn once; a reconcile that fails inside its commit is completed once by the next Host and repeated by none; the start whose answer the crash lost starts no Turn', async () => {
  const STEER = 'A4 steer: read src/module.ts before anything else';
  const MESSAGE = 'A4 message: the module marker must stay as it is';
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass',
    script: { replies: [{ kind: 'calls', calls: [{ callId: 'a4-read', name: 'read', args: { path: 'src/module.ts' } }] },
      textReply('A4 control: never answered, the Host crashes first')] } });
  const toStart = await h.advance(h.select('a4-control', W), { stopBefore: performs('start') });
  const startInput = toStart.next!;
  const runRef = await selectedRun(h);
  const run = await execution(h, runRef);
  expect(run.run.status).toBe('starting');
  /** How many times `text` occurs in one model request (its history and new inputs). */
  const occurrences = (request: unknown, text: string): number => JSON.stringify(request).split(text).length - 1;

  // A steer on the claimed Run is queued; its answer is lost and the same request replays the original receipt.
  const steerBody = graphWrite(AG2B_SCOPE, { runRef, kind: 'steer', reason: STEER }, 'a4-steer', [{ ref: runRef, revision: run.run.revision }]);
  const steer = await h.post<WriteResult<SubmittedControl>>('controls/submit', steerBody);
  expect(steer).toMatchObject({ status: 'committed', replayed: false, value: { intent: { kind: 'steer', status: 'queued', revision: 1 } } });
  await assertInvariants(h, 'steer submitted', stepOf(h, 'other', 'steer submitted', SCENARIO_OPERATOR));
  const afterSteer = h.counts();
  expect(await h.post('controls/submit', steerBody)).toEqual({ ...steer, replayed: true });
  expect(h.counts()).toEqual(afterSteer);
  // 发信 (ORCHESTRATION §3.1 "不再投递"): an operator message to the Run's Session, its answer lost: one message.
  const recipient = { projectId: run.session.ref.projectId, sessionId: run.session.ref.sessionId };
  const messageBody = graphWrite(AG2B_SCOPE, { recipient, text: MESSAGE }, 'a4-turn-message', []);
  const message = await h.post<WriteResult<SessionMessage>>('messages/send', messageBody);
  expect(message).toMatchObject({ status: 'committed', replayed: false, value: { status: 'pending', recipient } });
  await assertInvariants(h, 'message sent', stepOf(h, 'other', 'message sent', SCENARIO_OPERATOR));
  const afterMessage = h.counts();
  expect(await h.post('messages/send', messageBody)).toEqual({ ...message, replayed: true });
  expect(h.counts()).toEqual(afterMessage);

  // The Run enters; the steer and the message reach the Turn once each. The second model call is held: the Turn stays open.
  const held = h.holdReply(1);
  void h.post('workflow/advance', plain(AG2B_SCOPE, startInput)).catch(() => undefined);
  const request = await held.reached;
  expect(occurrences(request, STEER), 'the steer is in the model request once').toBe(1);
  expect(occurrences(request, MESSAGE), 'the message is in the model request once').toBe(1);
  expect(kernelRecordsContaining(h.database, STEER), 'the steer entered the Kernel once').toBe(1);
  expect(kernelRecordsContaining(h.database, MESSAGE), 'the message entered the Kernel once').toBe(1);
  await assertInvariants(h, 'mid-Turn');
  // Re-sent while the Turn runs: the original receipts again, nothing delivered twice.
  const atCrash = h.counts();
  expect(await h.post('controls/submit', steerBody)).toEqual({ ...steer, replayed: true });
  expect(await h.post('messages/send', messageBody)).toEqual({ ...message, replayed: true });
  expect(h.counts()).toEqual(atCrash);
  expect(kernelRecordsContaining(h.database, STEER)).toBe(1);
  expect(kernelRecordsContaining(h.database, MESSAGE)).toBe(1);

  // The crash; the next Host's reconcile of the Run (W-11) fails inside its commit (§12.9): no reconcile record is
  // left and the Run is as the crash left it.
  const reconcileFault = failCommitOf(h.database, 'ExecutionRunReconciled');
  const failedReconcile = await h.restart({ crash: true });
  reconcileFault.drop();
  expect(failedReconcile.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-11', status: 'failed' }], problems: [] });
  expect(eventCount(h, 'ExecutionRunReconciled')).toBe(0);
  expect((await execution(h, runRef)).run).toMatchObject({ status: 'running' });
  expect(await h.post('controls/submit', steerBody), 'the steer replays on the next Host').toEqual({ ...steer, replayed: true });
  expect(await h.post('messages/send', messageBody), 'so does the message').toEqual({ ...message, replayed: true });
  // That Host crashes too; the third Host completes the reconcile once, without a model call or a Kernel start.
  const completed = await h.restart({ crash: true });
  expect(completed.report).toMatchObject({ runs: [{ ref: JSON.stringify(runRef), row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' }],
    checks: [], problems: [] });
  expect(eventCount(h, 'ExecutionRunReconciled')).toBe(1);
  const afterReconcile = h.counts();
  expect(afterReconcile).toMatchObject({ modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted,
    kernelRecords: atCrash.kernelRecords, checksBegun: 0 });
  // 核对 repeated: that Host crashes right after its reconcile; the fourth Host finds nothing left and writes nothing.
  const repeated = await h.restart({ crash: true });
  expect(repeated.report).toMatchObject({ runs: [], queries: [], checks: [], controls: [], problems: [] });
  expect(h.counts(), 'the repeated reconcile wrote nothing').toEqual(afterReconcile);
  expect(eventCount(h, 'ExecutionRunReconciled')).toBe(1);
  // The `start` whose answer the first crash lost: the fourth Host answers the ended Run; no Turn, no model call.
  const kernel = h.kernelSnapshot();
  const started = await performOnce(h, startInput, 'the lost start sent again');
  expect(started).toMatchObject({ receipt: { kind: 'start', result: { status: 'ready', value: { run: { ref: runRef,
    status: 'ended', outcome: 'crashed' } } } } });
  expect(h.counts()).toEqual(afterReconcile);
  expect(h.kernelSnapshot()).toEqual(kernel);
  expect(kernelRecordsContaining(h.database, STEER)).toBe(1);
  expect(kernelRecordsContaining(h.database, MESSAGE)).toBe(1);
  const inbox = await h.post<ReadResult<{ items: SessionMessage[] }>>('messages/inbox', plain(AG2B_SCOPE, { recipient, page: { limit: 20 } }));
  expect(inbox.status === 'ready' && inbox.value.items.map(item => item.ref)).toEqual([message.status === 'committed' ? message.value.ref : null]);
  expect(h.abandonedCalls(), 'the abandoned Hosts started no model call').toEqual([]);
  await h.drainAbandoned();
  await assertInvariants(h, 'after draining the abandoned Hosts');
}, 120_000);

it('A4 (发信 by an Agent): the running Run\'s `send_session_message` write, failed inside its commit, then sent again with the same requestId (its answer lost), is written once and replays its original receipt', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass',
    script: { replies: [textReply('A4 agent send: the work is done')] } });
  const recipient = (await createAG2bSession(h.host, 'a4-agent-recipient', AG2B_QUERY_ROLE,
    [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
  await assertInvariants(h, 'a4 agent recipient', stepOf(h, 'other', 'a4 agent recipient', SCENARIO_OPERATOR));
  // The work Run is entered and holds its Turn on the model call: an Agent (work_run principal) of a live Run.
  const held = h.holdReply(0);
  const toStart = await h.advance(h.select('a4-agent', W), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  const inFlight = h.answer('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = await selectedRun(h);
  expect((await execution(h, runRef)).run).toMatchObject({ status: 'running' });
  // The Agent's write as its tool sends it (`communication-tools.ts`: one requestId per tool call), through the owner of a
  // composition root with the Host's Runtime grant (an Agent caller is admitted only with one; support/common.ts `openWorkRoot`).
  const agentPlatform = await openWorkRoot(h);
  const request = { input: { recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId }, text: 'A4: one question' },
    meta: { requestId: 'a4-agent-send', expected: [] } };
  const send = async (): Promise<WriteResult<SessionMessage>> => {
    const written = await agentPlatform.messages.sendMessage(workRunCtx(runRef), structuredClone(request) as never);
    return written as WriteResult<SessionMessage>;
  };

  // §12.9: the commit fails inside its transaction and leaves nothing.
  const fault = failCommitOf(h.database, 'SessionMessageSent');
  const before = h.counts();
  try {
    expect((await send()).status, 'a commit that failed inside its transaction is not committed').not.toBe('committed');
  } finally {
    fault.drop();
  }
  expect(h.counts(), 'the failed commit left nothing').toEqual(before);
  // The same request commits once; every later copy (the answer lost) replays the original receipt.
  const first = await send();
  expect(first).toMatchObject({ status: 'committed', replayed: false, value: { sender: { kind: 'work_run', runRef: { runId: runRef.runId } },
    recipient: { sessionId: recipient.sessionId } } });
  await assertInvariants(h, 'a4 agent send', stepOf(h, 'other', 'a4 agent send', { kind: 'agent', id: runRef.runId, runRef }));
  const afterFirst = h.counts();
  for (const copy of [1, 2]) {
    expect(await send(), `copy ${String(copy)}`).toEqual({ ...first, replayed: true });
  }
  expect(h.counts(), 'the copies write nothing').toEqual(afterFirst);
  expect(eventCount(h, 'SessionMessageSent'), 'one message').toBe(1);
  await agentPlatform.close();
  held.release();
  await inFlight;
  await assertInvariants(h, 'a4 agent Run ended');
  expect(h.modelCalls()).toBe(1);
}, 120_000);

it('A4 (记录结果): the Runtime\'s result write that failed (the ledger locked while the Kernel ended the Turn) is retried with the same identity by the re-sent start: the terminal is written once, no Kernel Turn or model call is added, a further copy writes nothing', async () => {
  let scenario: HostScenario | undefined;
  let ledger: { release(): void } | undefined;
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass', script: { replies: editThenText('a4-result'),
    // During the final model call the test takes the ledger's write lock (as A8-3a): the Kernel writes the Turn's
    // terminal in its own store and the observer's `recordRunResult` fails after the store's busy wait.
    duringReply: async (index) => { if (index === 1 && scenario !== undefined) ledger = lockLedger(scenario.database); } } });
  scenario = h;
  const toStart = await h.advance(h.select('a4-result', W), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  let failed: Record<string, unknown>;
  try {
    failed = await h.answer('workflow/advance', plain(AG2B_SCOPE, toStart.next));
  } finally {
    ledger?.release();
  }
  expect(failed).toMatchObject({ status: 'ready', value: { receipt: { kind: 'start', result: { status: 'rejected', code: 'unavailable' } } } });
  const runRef = await selectedRun(h);
  expect((await execution(h, runRef)).run).toMatchObject({ status: 'running', outcome: null });
  await assertInvariants(h, 'a4 result write failed');
  expect(eventCount(h, 'ExecutionRunResultRecorded')).toBe(0);
  const beforeRetry = h.counts();

  // The same start again: the Run is entered, so the Runtime only observes it and retries the SAME result submission it
  // kept (`execution-observation.ts` pendingTerminals: one requestId per terminal boundary): written once.
  const retried = await h.answer('workflow/advance', plain(AG2B_SCOPE, toStart.next));
  expect(retried).toMatchObject({ status: 'ready', value: { receipt: { kind: 'start', result: { status: 'ready',
    value: { run: { ref: runRef, status: 'ended', outcome: 'completed' } } } } } });
  const writtenByRetry = 'a4 result written by the retry';
  await assertInvariants(h, writtenByRetry, stepOf(h, 'entry_authorized', writtenByRetry));
  expect(eventCount(h, 'ExecutionRunResultRecorded'), 'the terminal is written once').toBe(1);
  expect(h.counts(), 'no model call or Kernel Turn is added').toMatchObject({ modelCalls: beforeRetry.modelCalls,
    kernelTurnsStarted: beforeRetry.kernelTurnsStarted, kernelRecords: beforeRetry.kernelRecords });
  // A further copy finds the result booked and writes nothing.
  const booked = h.counts();
  expect(await h.answer('workflow/advance', plain(AG2B_SCOPE, toStart.next))).toMatchObject({ status: 'ready',
    value: { receipt: { kind: 'start', result: { status: 'ready', value: { run: { ref: runRef, status: 'ended' } } } } } });
  expect(h.counts()).toEqual(booked);
  expect((await h.advance(h.select('a4-result-goal'))).state).toBe('completed');
}, 120_000);
