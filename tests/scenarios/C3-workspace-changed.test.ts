/**
 * A.2 step 6, scenario C3 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/scenarios/C3-workspace-changed.test.ts`; §6.1 contract (e) `workspace`; §16 GAP-49; lead
 * decision LA-5 for the digest-only source checkpoints).
 *
 * The workspace is a Git repository with one baseline commit. Run 1 writes a notes file through its
 * tools and answers without the result file, so the registered static check FAILs; the Workflow
 * requeues the Task automatically, capturing the workspace source as D1, and claims the requeue. Before
 * Run 2's prepare the workspace changes (D2 ≠ D1). The brief the prepare assembles cannot say which
 * files changed between the two durable checkpoints, and says so; it also lists the files that differ
 * from the Git baseline, and never claims "no change" for the window it cannot observe (the previous
 * Run's end to the round's open). Run 2 then writes the result file and the Goal completes.
 *
 * The §11 invariants are checked after every Workflow step with a receipt (the harness). Scripted
 * model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import { AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, openHostScenario } from './harness.js';
import { gitBaseline, notesThenText } from './support/brief.js';
import {
  NOTES_FILE, briefOf, editThenText, execution, performsAfterRequeues, selectedRun, sourceDigestOf, turnStarts,
} from './support/common.js';

afterEach(cleanupScenarios);

/** The file that changes after the requeue and before the prepare (not by a Run's tools). */
const OPERATOR_FILE = 'src/c3-operator-change.txt';

it('C3 (GAP-49): the source is D1 at the requeue and D2 at the prepare; the brief says "重新入队 → 本次执行开始前：有变化（具体文件无法从持久记录确定）" and lists the uncommitted files', async () => {
  const h = await openHostScenario({ script: { replies: [...notesThenText('c3-ws'), ...editThenText('c3-ws-run2')] } });
  const baseCommit = await gitBaseline(h.root);

  // Run 1 writes the notes file and FAILs; the Workflow requeues the Task and claims the requeue; stop before the prepare.
  const toPrepare = await h.advance(h.select('c3-ws-1', AG2B_WORK_TASK_ID), { stopBefore: performsAfterRequeues(h, 'prepare', 1) });
  expect(toPrepare.state).toBe('stopped');
  const [requeue] = h.lastWorld?.requeues ?? [];
  if (requeue === undefined) throw new Error('the Workflow must have requeued Run 1');
  const run1Ref = requeue.afterRunRef;
  const d1 = await sourceDigestOf(h.root);
  expect(requeue.basis.source.sourceDigest, 'the requeue captured the workspace as it is now (D1)').toBe(d1);

  // The workspace changes before Run 2's prepare (D2).
  await writeFile(join(h.root, OPERATOR_FILE), 'C3: changed between the requeue and the prepare\n');
  const d2 = await sourceDigestOf(h.root);
  expect(d2).not.toBe(d1);

  // The prepare assembles the brief; Run 2 writes the result file and the Goal completes.
  const done = await h.advance(toPrepare.next!);
  expect(done.state).toBe('completed');
  const run2Ref = await selectedRun(h);
  expect(run2Ref.runId).not.toBe(run1Ref.runId);
  const bound = await briefOf(h.host, run2Ref);
  if (bound === null) throw new Error('Run 2 must bind its brief');
  const { brief, digest } = bound;
  const run1 = await execution(h, run1Ref);

  // The durable checkpoints: the FAILed round's open and the requeue saw D1; the brief's own checkpoint saw D2.
  expect(brief.workspace.checkpoints).toMatchObject([
    { kind: 'round_open', sourceDigest: d1, unavailableReason: null },
    { kind: 'requeue', sourceDigest: d1, unavailableReason: null },
    { kind: 'brief', sourceDigest: d2, unavailableReason: null }]);
  expect(brief.workspace.segments).toEqual([
    { from: 0, to: 1, verdict: 'unchanged', reason: 'the workspace source digest is identical' },
    { from: 1, to: 2, verdict: 'changed', reason: 'the workspace source digest differs' }]);
  // GAP-49: the window from the previous Run's end to the first checkpoint is never observed, and says so.
  expect(brief.workspace.unobserved).toEqual({ from: 'previous_run_end', to: 0, previousEndedAt: run1.run.endedAt });
  // The files that differ from the Git baseline at the prepare: the one Run 1 wrote and the later change.
  expect(brief.workspace.uncommitted).toEqual({ status: 'git', baseCommit, paths: [NOTES_FILE, OPERATOR_FILE], omitted: 0, reason: null });
  // The file Run 1 changed through its tools (the only per-file fact the records hold).
  expect(brief.workspace.selfChanged).toEqual({ status: 'known', confirmed: [NOTES_FILE], possible: [], omitted: 0 });

  // The rendered brief, as the last section of Run 2's input in its Kernel Turn and its first model request.
  const rendered = renderContinuationBriefZh(brief, digest);
  const run2 = await execution(h, run2Ref);
  const turn = turnStarts(h.database).find(candidate => candidate.runId === run2.run.executionHistory?.kernel.runId);
  if (turn === undefined) throw new Error('Run 2 must have started a Kernel Turn');
  expect(turn.content.endsWith(`\n\n${rendered}`)).toBe(true);
  const firstRequest = h.modelRequests()[2]?.messages.at(-1);
  if (firstRequest?.role !== 'user') throw new Error('Run 2\'s first model request must end with its input');
  expect(firstRequest.content.endsWith(`\n\n${rendered}`)).toBe(true);
  const lines = rendered.split('\n');
  expect(lines).toContain('- 重新入队 → 本次执行开始前：有变化（具体文件无法从持久记录确定）');
  expect(lines).toContain(`- 未提交的改动（相对 ${baseCommit}）：${NOTES_FILE}、${OPERATOR_FILE}`);
  expect(lines).toContain('- 检查轮次开始 → 重新入队：源码摘要相同');
  expect(lines).toContain(`- 上一次执行结束（${String(run1.run.endedAt)}）到“检查轮次开始”之间：无法从持久记录确定是否有改动。`);
  expect(lines).toContain(`- 上一次执行经工具改动的文件（完整）：${NOTES_FILE}`);
  // No line claims the requeue → prepare window unchanged.
  expect(lines.filter(line => line.startsWith('- 重新入队 → 本次执行开始前：'))).toHaveLength(1);
  expect(h.counts()).toMatchObject({ modelCalls: 4, kernelTurnsStarted: 2 });
}, 120_000);
