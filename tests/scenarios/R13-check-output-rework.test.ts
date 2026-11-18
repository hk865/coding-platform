/**
 * R13 冻结稿第五节 C1、C5（冻结稿 A1–A4，L1、L6）：检查没过、自动返工领到新 Run 时，接续说明带上那条检查的命令原文、出处、
 * 退出码和输出末尾（`checks.outputs`）。只走公开入口，脚本模型；业务规则行，只跑 memory（RULES S3）。
 * - C1：AG2b 场景（真实 Host，启动配置的 `ag2b-static` 换成带反斜杠的命令），照 A1 让检查轮 FAIL、返工领到 Run 2；读
 *   `executions/brief`，再读 Run 2 那次模型请求的 `messages[].content` 原文（不经 JSON.stringify）。
 * - C5：G8 世界：初始化装的种子检查（taskIds all）出处是已批准清单，绑着初始化那次回答；人采用的计划带来的检查出处是
 *   那份候选，批准者是人。
 */
import { afterEach, expect, it } from 'vitest';
import { LOCAL_WORKBENCH_ROLE } from '../../src/app/runtime-configuration.js';
import type { ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { g8Check, g8NewGoal, g8PlanCall, g8PlanForm, openG8Project } from '../helpers/G8-world.js';
import { R13_COMMAND, R13_HINT, R13_STDERR, fencedAfter } from '../helpers/R13-verbatim.js';
import { cleanupScenarios, openHostScenario, performs, waitFor } from './harness.js';
import { requiredBriefOf } from './support/common.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await cleanupScenarios();
});

it('C1：命令检查 FAIL → 返工的 Run 2：接续说明带命令原文、出处、退出码和 stderr；模型输入里照原样', async () => {
  const h = await openHostScenario({ check: { command: R13_COMMAND },
    script: { replies: [{ kind: 'text', text: 'R13 C1 Run 1' }, { kind: 'text', text: 'R13 C1 Run 2' }] } });
  const toRequeue = await h.advance(h.select('r13-c1'), { stopBefore: performs('requeue_task') });
  await h.advance(toRequeue.next!, { stopBefore: performs('open_checks') });
  const run2 = (await h.taskRow()).execution;
  if (run2 === null) throw new Error('R13 C1: Run 2 must be selected');
  const { brief } = await requiredBriefOf(h.host, run2);
  expect(brief.checks?.outputs).toEqual([{ checkId: 'ag2b-static', kind: 'static', command: { text: R13_COMMAND, truncated: false },
    taskIds: 'all', origin: { kind: 'startup' }, unreadable: null,
    observed: expect.objectContaining({ outcome: 'failed', exitCode: 5, stdoutTail: '', stderrTail: R13_STDERR }) }]);
  const request = h.modelRequests().at(-1)!;
  const input = [request.systemPrompt,
    ...request.messages.flatMap(message => message.role === 'tool' ? [] : [message.content])].join('\n\n');
  expect(fencedAfter(input, '命令原文（照原样，不是 JSON）：'), 'two backslashes, not four').toBe(R13_COMMAND);
  expect(fencedAfter(input, 'stderr 末尾：')).toBe(R13_STDERR.slice(0, -1));
  expect(input.split('\n')).toContain(R13_HINT);
}, 180_000);

it('C5：种子检查的出处是已批准清单（初始化那次回答），人采用的计划带来的检查出处是那份候选、批准者是人', async () => {
  const project = await openG8Project('r13-c5', [g8Check('r13-c5-seed', 'all', 'exit 6')]);
  closers.push(project.close);
  const check = g8Check('r13-c5-check', ['r13-c5-work', 'r13-c5-gate'], 'exit 7');
  const flow = await g8NewGoal(project, 'r13-c5', [g8PlanCall('r13-c5-plan', g8PlanForm('r13-c5', 'local-workbench', [check]))]);
  const head = await project.candidate(flow.goal, flow.requestRoot);
  expect(await project.apply(flow.goal, head, 'r13-c5-apply')).toMatchObject({ status: 'committed' });
  const executor = await project.line('r13-c5-executor', LOCAL_WORKBENCH_ROLE);
  await project.world.scripted.script(executor,
    [{ kind: 'text', text: 'R13 C5 Run 1' }, { kind: 'text', text: 'R13 C5 Run 2' }], project.scope);
  await project.read('workflow/driver-start', { advance: { schemaVersion: 1, goalRef: flow.goal, flowId: 'r13-c5-driver',
    sessionHint: null, kind: 'select_work' }, queryProfileIds: [] });
  // 检查都没过，自动返工领到 Run 2：Task 选中的 Run 绑好接续说明之前，`executions/brief` 答 incomplete 或 null。
  const bound = await waitFor(async () => {
    const tasks = (await project.read<{ tasks: { ref: { taskId: string }; execution: RunRef | null }[] }>('tasks/query',
      { goalRef: flow.goal })).tasks;
    const runRef = tasks.find(task => task.ref.taskId === 'r13-c5-work')?.execution ?? null;
    if (runRef === null) return null;
    const read = await project.post('executions/brief', plain(project.scope, { runRef })) as
      { status: string; value?: { brief: ContinuationBriefV1 } | null };
    return read.status === 'ready' ? read.value ?? null : null;
  }, read => read !== null, 'the rework brief of r13-c5-work');
  expect(bound?.brief.checks?.failing.map(entry => entry.checkId).sort()).toEqual(['r13-c5-check', 'r13-c5-seed']);
  expect(Object.fromEntries((bound?.brief.checks?.outputs ?? []).map(entry => [entry.checkId, entry.origin]))).toEqual({
    'r13-c5-check': { kind: 'plan', proposalRef: head.ref, approvedBy: 'person' },
    'r13-c5-seed': { kind: 'approved_list', answerRef: project.seedAnswer } });
}, 180_000);
