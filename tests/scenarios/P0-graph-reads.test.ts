/**
 * P0 写测试方（冻结稿第六节 T7、T10，条件小节 T11）：读图（A8 + B15 收口）。只经公开步骤，不读库。
 * - T7：没有目标的问一问副本（`queries/ask`）用记忆写法读人的模块注记（A8，`p0-frozen.md:334`）。
 * - T10：计划审阅轮用 input 写法读一份声明成任务输入的检查报告，B15 拒（`p0-frozen.md:337`）。
 * - T11（Q6 选甲）：带目标的轮读到一条不挂目标、没审过的已接受 agent 注记（`p0-frozen.md:520`）。
 * 期望值都是冻结稿的字面量或手算；名字和顺序按第四节手推。今天没施工，三行各红在自己那一步。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { g8Check, g8PlanDraft, g8PlanForm, g8SplitChecks } from '../helpers/G8-world.js';
import { adoptWithChecks, expectB15, expectNoteRead, G8B_ROLE, G8B_TEMPLATE, openG8BWorld, p0Lookup, p0PersonNote,
  type G8BWorld } from '../helpers/G8B-world.js';
import { adviserToolResult } from '../helpers/K3L3-adviser-world.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openS7D2ColdStartWorld } from '../helpers/S7D2-coldstart-world.js';
import { sendRoundOf } from '../helpers/XWS2A-world.js';
import { waitFor } from './harness.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });

/** 世界的模型请求里按 callId 取工具结果（世界级脚本的副本 Query，先例 `S6A-secretary-context-memory.test.ts:424`）。 */
function worldToolResult(w: G8BWorld, callId: string): unknown {
  for (const request of w.world.model.requests) {
    const message = request.messages.find(entry => entry.role === 'tool' && entry.callId === callId);
    if (message?.role === 'tool') return message.result;
  }
  return undefined;
}

describe('P0: the graph reads of the plan review, the copy and the goal rounds', () => {
  it('T7: a no-goal consultation copy reads the person\'s module note', async () => {
    const w = await openG8BWorld('p0-t7');
    cleanup.push(w.close);
    const executor = await w.line('p0-t7-executor', G8B_TEMPLATE.executor);
    const note = await p0PersonNote(w, 'p0-t7-note');
    await w.world.scriptReplies([{ kind: 'calls', calls: [p0Lookup('p0-t7-mem')] },
      { kind: 'text', text: 'P0 T7' }]);
    expect((await w.world.post('queries/ask', plain(w.scope, { sessionRef: executor.ref,
      question: 'P0 T7', commandId: 'p0-t7' }))).httpStatus).toBe(200);
    const memo = await waitFor(async () => worldToolResult(w, 'p0-t7-mem'), value => value !== undefined,
      'T7: the copy Query tool result');
    expectNoteRead(memo, note, 'T7: the copy');
  }, 180_000);

  it('T10: a plan review round cannot read a check report declared as a task input', async () => {
    const w = await openG8BWorld('p0-t10');
    cleanup.push(w.close);
    const adviserA = await w.line('p0-t10-adviser-a', G8B_TEMPLATE.adviser);
    const adviserB = await w.line('p0-t10-adviser-b', G8B_TEMPLATE.adviser);
    const reviewer = await w.line('p0-t10-reviewer', G8B_TEMPLATE.reviewer);
    const executor = await w.line('p0-t10-executor', G8B_TEMPLATE.executor);
    // 目标 A 跑出一个带检查的验证轮；轮次卡上的 `reportRef`（`verification.ts:157`）等它非空。
    const goalA = await w.goal('p0-t10-a', 'P0 检查报告', { adviser: adviserA });
    await adoptWithChecks(w.world, w.scope, goalA, 'p0-t10-a', [g8Check('p0-t10-check', ['p0-t10-a-work'], 'true')]);
    const opened = await w.firstCheckRound(goalA, executor, 'p0-t10-a-work', 'P0 T10 做完了');
    const reportRef = (await waitFor(async () => (await w.steps.read<{ checks: { reportRef: ArtifactRef | null }[] }>(
      'verification/round', { roundRef: opened.roundRef })).checks[0]?.reportRef,
    value => value !== null && value !== undefined, 'T10: the check report'))!;
    // 目标 B 的第一份计划把报告声明成 `p0-t10-in-work` 的输入（`plan.ts:210-215`），任务 plan_only 让目标先出计划审阅轮。
    const goalB = await w.goal('p0-t10-b', 'P0 输入计划', { adviser: adviserB });
    const checks = [g8Check('p0-t10-in-static', ['p0-t10-in-work', 'p0-t10-in-gate'], 'true')];
    const { draft } = g8SplitChecks(g8PlanDraft(goalB, 'p0-t10-in', G8B_ROLE, checks));
    const tasks = draft.tasks.map(task => task.taskId === 'p0-t10-in-work'
      ? { ...task, executionIntent: 'plan_only' as const } : task);
    await adoptWithChecks(w.world, w.scope, goalB, 'p0-t10-b', checks, { ...draft, tasks,
      inputRequirements: [{ requirementId: 'p0-t10-report', consumerTaskId: 'p0-t10-in-work', kind: 'artifact',
        artifactRef: reportRef }] });
    const planRef = (await w.ws.activePlan(goalB))!.ref;
    await w.world.scripted.script(adviserB, [{ kind: 'calls', calls: [{ callId: 'p0-t10-refine',
      name: 'submit_plan_round', args: { answerKind: 'plan', summary: 'P0 T10',
        reason: { text: 'P0 T10', affectedTaskIds: ['p0-t10-in-work'] }, plan: g8PlanForm('p0-t10-in', G8B_ROLE) } }] }],
    w.scope);
    expect(await sendRoundOf(w.ws, goalB, 'p0-t10-refine'), 'T10: no refine round').toMatchObject({
      recipient: adviserB.ref });
    const refine = (await w.rounds(adviserB, 'refine:'))[0]!;
    expect((await w.settled(refine.message.ref)).response, 'T10: the refine round was not replied').not.toBeNull();
    await w.world.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: 'p0-t10-input', name: 'look_graph',
      args: { mode: 'input', consumer: { projectId: goalB.projectId, goalId: goalB.goalId, taskId: 'p0-t10-in-work' },
        planRef, declarationId: 'legacy:p0-t10-report' } }] }, { kind: 'calls', calls: [{ callId: 'p0-t10-submit',
      name: 'submit_plan_review', args: { verdict: 'pass', findings: [] } }] }], w.scope);
    expect(await sendRoundOf(w.ws, goalB, 'p0-t10-review'), 'T10: no plan review round').toMatchObject({
      round: { kind: 'planreview' }, recipient: reviewer.ref });
    const review = (await w.rounds(reviewer, 'planreview:'))[0]!;
    expect((await w.settled(review.message.ref)).response, 'T10: the plan review was not replied').not.toBeNull();
    const result = await adviserToolResult({ world: w.world, adviser: reviewer }, 'p0-t10-input', reviewer, w.scope);
    expectB15(result, 'T10: the plan review');
  }, 240_000);

  it('T11: a goal round reads a goal-less accepted note the scribe has not reviewed (Q6)', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory', extraBindings: [
      { binding: { id: 's6a-secretary-binding' } as WorkbenchRuntimeBinding,
        mergeTools: ['look_graph', 'find_graph', 'record_note'] }] });
    cleanup.push(cold.close);
    // 不挂目标的初始轮（`goalId: null`）写一条 agent 注记：`record_note`，锚点是项目；写回执带 `noteId`。
    await cold.host.scripted.script(cold.lines.secretary, [{ kind: 'calls', calls: [{ callId: 'p0-t11-note',
      name: 'record_note', args: { op: 'write', kind: 'pitfall', topic: 'p0-t11', conclusion: 'P0 T11', body: 'p0',
        anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], replaces: [], contradicts: [],
        coexistWith: [], structural: false } }] }]);
    const candidate = await cold.submitInitialPlan();
    const written = await waitFor(async () => {
      try { return await adviserToolResult({ world: cold.host, adviser: cold.lines.secretary }, 'p0-t11-note',
        cold.lines.secretary); } catch { return undefined; }
    }, value => value !== undefined, 'T11: the initial round note write');
    const noteId = (written!.output?.[0] as { value?: { write?: { noteId?: string } } } | undefined)?.value?.write?.noteId;
    if (noteId === undefined) throw new Error(`T11: no note id: ${JSON.stringify(written)}`);
    await cold.adoptGovernance();
    const goal = await cold.confirmDraft(candidate);
    // 带目标的秘书轮用记忆写法读同一条注记（`goalId` 是这一轮的目标）。
    await cold.host.scripted.script(cold.lines.secretary, [{ kind: 'calls', calls: [{ callId: 'p0-t11-mem',
      name: 'look_graph', args: { memory: { v: 1, op: 'lookup', anchor: { kind: 'project' } } } }] },
    { kind: 'text', text: 'P0 T11' }]);
    expect((await cold.host.submit({ commandId: 'p0-t11-read', goalId: goal.goalId, text: 'P0 T11 读注记',
      recipient: cold.lines.secretary })).status).toBe('queued');
    const memo = await waitFor(async () => {
      try { return await adviserToolResult({ world: cold.host, adviser: cold.lines.secretary }, 'p0-t11-mem',
        cold.lines.secretary); } catch { return undefined; }
    }, value => value !== undefined, 'T11: the goal round read the note');
    const item = expectNoteRead(memo, noteId, 'T11: the goal round');
    expect(item, 'T11: the goal-less accepted note').toMatchObject({ goalId: null, storedState: 'accepted',
      confirmedByUser: false });
  }, 180_000);
});
