/**
 * A.2 step 6, scenario C3 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/scenarios/C3-not-entered-chain.test.ts`; §6.1 contract (e) `factsFrom`, `checks`,
 * `workspace.selfChanged` and the rendering of a not-entered Run; §6 RUN-09 / D-7; §4 TASK-16, C2).
 *
 * Run 1 writes a notes file through its tools and answers without the result file, so the registered
 * static check FAILs; the Workflow requeues the Task automatically and claims the requeue: Run 2 is
 * `Claimed`. A person cancels Run 2 before it starts (D-7: a Run that never began ends cancelled at
 * once, with no Kernel Turn). The person then requeues the Task after Run 2, and Run 3's brief says
 * that Run 2 never entered the Kernel and lists the failed check and the changed file from the earlier
 * Run 1, the nearest entered ancestor on the requeue chain. Run 3 writes the result file and the Goal
 * completes; only Run 1 and Run 3 call the model.
 *
 * The §11 invariants are checked after every step that changes records. Scripted model replies only;
 * no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import { AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { submitControl } from '../helpers/A2-restart-fixture.js';
import { assertInvariants, cleanupScenarios, openHostScenario, SCENARIO_OPERATOR } from './harness.js';
import { notesThenText } from './support/brief.js';
import {
  NOTES_FILE, briefOf, editThenText, execution, operatorRequeue, performsAfterRequeues, selectedRun, stepOf, turnStarts,
} from './support/common.js';

afterEach(cleanupScenarios);

it('C3 (D-7, factsFrom): Run 2 cancelled while Claimed never enters the Kernel; the person\'s requeue opens Run 3 whose brief says so and lists the failed check and the changed file from the earlier Run 1; only Run 1 and Run 3 call the model', async () => {
  const h = await openHostScenario({ script: { replies: [...notesThenText('c3-chain'), ...editThenText('c3-chain-run3')] } });

  // Run 1 writes the notes file and FAILs; the automatic requeue is claimed (Run 2); stop before Run 2's prepare.
  const toPrepare = await h.advance(h.select('c3-chain-1', AG2B_WORK_TASK_ID), { stopBefore: performsAfterRequeues(h, 'prepare', 1) });
  expect(toPrepare.state).toBe('stopped');
  const [automatic] = h.lastWorld?.requeues ?? [];
  if (automatic === undefined) throw new Error('the Workflow must have requeued Run 1');
  const run1Ref = automatic.afterRunRef;
  const round1 = h.lastWorld?.rounds.find(round => round.subjectRunRef.runId === run1Ref.runId);
  expect(round1).toMatchObject({ status: 'finalized', outcome: 'FAIL', checks: [{ checkId: 'ag2b-static', outcome: 'FAIL' }] });
  const reportRef = round1?.checks[0]?.reportRef;
  if (round1 === undefined || reportRef === null || reportRef === undefined) throw new Error('Run 1\'s FAILed check must have a report');
  const run2Ref = await selectedRun(h);
  expect(run2Ref.runId).not.toBe(run1Ref.runId);
  expect((await execution(h, run2Ref)).run).toMatchObject({ status: 'starting', requeueRef: automatic.ref, envelope: null });
  expect(h.counts()).toMatchObject({ modelCalls: 2, kernelTurnsStarted: 1 });

  // D-7: the person cancels Run 2 while it is Claimed; it ends cancelled at once and never reaches the Kernel.
  const cancel = await submitControl(h.host, run2Ref, 'cancel', 'the person stops Run 2 before it starts', 'c3-chain-cancel');
  expect(cancel.intent).toMatchObject({ kind: 'cancel', status: 'applied' });
  await assertInvariants(h, 'Run 2 cancelled while Claimed', stepOf(h, 'other', 'Run 2 cancelled while Claimed'));
  const run2 = await execution(h, run2Ref);
  expect(run2.run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
  expect(run2.run.executionHistory, 'no Kernel Turn').toBeUndefined();
  expect(h.counts()).toMatchObject({ modelCalls: 2, kernelTurnsStarted: 1 });

  // The person requeues the Task after Run 2 (class `cancelled`, a person's stop: a person's requeue).
  const requeued = await operatorRequeue(h.host, run2Ref, 'c3-chain-requeue', 'the person continues after stopping Run 2');
  expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { afterRunRef: run2Ref,
    failureClass: 'cancelled', stopRequester: 'human', requestedBy: SCENARIO_OPERATOR } } });
  await assertInvariants(h, 'the person requeues after Run 2', stepOf(h, 'task_requeued', 'the person requeues after Run 2'));

  // Run 3 runs with the brief, writes the result file and the Goal completes.
  const done = await h.advance(h.select('c3-chain-2', AG2B_WORK_TASK_ID));
  expect(done.state).toBe('completed');
  const run3Ref = await selectedRun(h);
  expect([run1Ref.runId, run2Ref.runId]).not.toContain(run3Ref.runId);
  const bound = await briefOf(h.host, run3Ref);
  if (bound === null) throw new Error('Run 3 must bind its brief');
  const { brief, digest } = bound;

  // The previous Run is Run 2, which never entered the Kernel; the execution facts come from Run 1, one hop back.
  expect(brief).toMatchObject({ mode: 'rework', failureClass: 'cancelled',
    trigger: { actorClass: 'human', requeueNumber: 2, autoRework: null,
      earlierRequeues: [{ afterRunId: run1Ref.runId, failureClass: 'check_failed' }] },
    previous: { runRef: run2Ref, outcome: 'cancelled', origin: 'observed', cancelledBy: 'human', interruption: null },
    factsFrom: { runRef: run1Ref, hops: 1, truncated: false },
    stoppedAt: { kernel: 'read', turnStatus: 'completed' } });
  // Run 1's failed check with its report, and the file Run 1 changed through its tools (§15.2 row: 列出“来自更早的
  // Run Run1”的失败检查与改动文件; §6.1 contract (e) `factsFrom` and `checks`).
  expect(brief.checks, 'the failed check of the earlier Run 1').toMatchObject({ roundRef: round1.ref, roundOrdinal: 1,
    failing: [{ checkId: 'ag2b-static', phase: 'finished', outcome: 'FAIL', reportRef }] });
  expect(brief.toolCalls.confirmed).toMatchObject([{ callId: 'c3-chain-notes', name: 'edit', result: 'success',
    changedPaths: [NOTES_FILE] }]);
  expect(brief.workspace.selfChanged).toEqual({ status: 'known', confirmed: [NOTES_FILE], possible: [], omitted: 0 });

  // The rendered brief in Run 3's first model request.
  const rendered = renderContinuationBriefZh(brief, digest);
  const firstRequest = h.modelRequests()[2]?.messages.at(-1);
  if (firstRequest?.role !== 'user') throw new Error('Run 3\'s first model request must end with its input');
  expect(firstRequest.content.endsWith(`\n\n${rendered}`)).toBe(true);
  const lines = rendered.split('\n');
  expect(lines).toContain(`- 执行 ${run2Ref.runId}（Session ${run2.outbox.claim.sessionRef.sessionId}）没有进入 Kernel 就结束（cancelled）。`);
  expect(lines).toContain(`- 下面的执行事实来自更早的执行 ${run1Ref.runId}（向前第 1 次）。`);
  expect(lines.some(line => line.startsWith('  - ag2b-static：阶段 finished，结果 FAIL') && line.endsWith(`报告 sha256:${reportRef.digest}`)),
    'the rendered failed check of Run 1').toBe(true);
  expect(lines).toContain(`- 上一次执行经工具改动的文件（完整）：${NOTES_FILE}`);

  // Only Run 1 and Run 3 called the model, each in its own Kernel Turn; Run 2 has none.
  expect(h.modelCalls(), 'Run 1 (notes edit, text), Run 3 (edit, text)').toBe(4);
  const run1 = await execution(h, run1Ref);
  const run3 = await execution(h, run3Ref);
  expect(turnStarts(h.database).map(turn => turn.runId)).toEqual([run1.run.executionHistory?.kernel.runId,
    run3.run.executionHistory?.kernel.runId]);
}, 120_000);
