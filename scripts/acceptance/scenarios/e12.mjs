// E12: look through both graphs, history, messages and completion evidence; reads change nothing; then a normal
// close, a new Host on the same ledger, and related new work through the old line (draft §1.5; slice-9-SPEC.md:664,
// :690). New work is never `driver-start(oldGoalRef)`: a person's message to a COMPLETED Goal's line becomes the
// Workflow's own `intervention_new_goal` request (`intervention.ts:169-176`), then confirm → adopt → the new Goal.
import { newId, ready } from '../lib/http.mjs';
import { adoptBinding, broken, chooseModel, coldStart, driverStart, executions, lines, openProject, runHistory, sessionHistory,
  sessionQueries, settleAutonomy, textOf, turnsOf, waitFor, waitGoal, waitRequest } from '../lib/flows.mjs';

const MINUTE = 60_000;
const SEED = {
  'package.json': '{\n  "name": "g6-e12",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6-e12\n\nGreeting helpers.\n',
  'greet.js': 'export function greet(name) {\n  return `hello ${name}`;\n}\n',
};
const REQUEST = '给 greet.js 的 greet 加一个可选参数 punctuation（默认 "!"），并加 test/greet.test.js。验收：node --test 通过。';
const FOLLOW = '在这个基础上再加一个 farewell(name)，同样加测试。';

const def = {
  id: 'E12',
  rows: ['C-36', 'C-42', 'C-157', 'C-88', 'C-89', 'C-104', 'C-145', 'C-146', 'C-158', 'C-147', 'C-155', 'C-207', 'C-114', 'C-215', 'C-220'],
  checks: [
    { id: 'reads-quiet', rows: ['C-36'], text: '读、展开、分页前后：没有新 QueryRun、用量不增、changes 游标不动' },
    { id: 'graph-cards', rows: ['C-88', 'C-89'], text: 'graph/look、graph/find 从已存事实拼出节点卡（路径/版本可回指）' },
    { id: 'raw-history', rows: ['C-42', 'C-157'], text: '能读到实际保存的完整原历史' },
    { id: 'completion-chain', rows: ['C-104'], text: '从 Goal 完成走到义务、证据、原检查和文件版本' },
    { id: 'restart-state', rows: ['C-145', 'C-215'], text: '同 ledger 新 Host 读回原 Goal（仍 COMPLETED）、计划和执行' },
    { id: 'reconcile', rows: ['C-146'], text: '持租约的 Host 启动先核对、写出报告' },
    { id: 'redrive-sets', rows: ['C-155'], text: '已完成 Goal 不进被中断集（不写 GoalInterruption）' },
    { id: 'new-goal', rows: ['C-114', 'C-158'], text: '旧线的消息先确认成新 Goal，旧 Goal 完成不变，新 Goal 不继承完成事实' },
    { id: 'history-reuse', rows: ['C-220'], text: '重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用）' },
    { id: 'stale-premise', rows: ['C-220'], text: '保留适用范围，过期前提不升级' },
    { id: 'replay', rows: ['C-147'], text: '同一次 driver-start 重放只读原来的执行' },
    { id: 'wait-registry', rows: ['C-207'], text: '目标等待登记表启动时只读重建' },
  ],
};

async function queryCount(project) {
  let count = 0;
  let input = 0;
  for (const row of await lines(project)) {
    for (const snapshot of await sessionQueries(project, row.key)) {
      count += 1;
      for (const request of snapshot.run?.executionState?.requests ?? []) input += request.inputTokens ?? 0;
    }
  }
  return { count, input };
}

async function run(ctx, rec) {
  let host = ctx.hosts['w-accept'];
  const project = await openProject(ctx, host, 'e12', SEED);
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, host, project);
  rec.facts.userCommand = [REQUEST];
  const started = await coldStart(ctx, project, REQUEST, rec);
  const oldGoal = started.goalRef;
  const done = await waitGoal(ctx, project, oldGoal, { timeoutMs: 90 * MINUTE, rec });
  // The work ran and did not complete: the platform's failure, judged on the completion chain (lead ruling 11-14 #6).
  if (done.display.phase !== 'COMPLETED') throw broken(ctx, `the E12 Goal ended ${done.display.phase}, not COMPLETED`, 'completion-chain');

  // Reads only: nothing may start a model, mark a message read or write state.
  const before = { ...(await queryCount(project)), head: (await host.client.get('/api/real/core/bootstrap'))?.changesHead ?? null };
  const tasks = ready(await host.client.read('tasks/query', project.scope, { goalRef: oldGoal }));
  const page = { afterCursor: null, limit: 20 };
  const look = ready(await host.client.read('graph/look', project.scope,
    { goalRef: oldGoal, target: { kind: 'node', node: { kind: 'goal', ref: oldGoal } }, relation: 'children', page }));
  const find = ready(await host.client.read('graph/find', project.scope, { goalRef: oldGoal, needle: 'greet', page }));
  const pathCard = ready(await host.client.read('graph/look', project.scope,
    { goalRef: null, target: { kind: 'path', path: 'greet.js' }, relation: 'card', page }));
  const runs = await executions(project, oldGoal);
  let historyItems = 0;
  for (const item of runs) {
    rec.link('run', item.run.ref);
    const history = ready(await host.client.read('executions/history', project.scope, { runRef: item.run.ref, afterCursor: null, limit: 200 }));
    historyItems += history?.items?.length ?? 0;
    await host.client.read('executions/brief', project.scope, { runRef: item.run.ref });
  }
  await host.client.read('activity/runs', project.scope, { runRefs: runs.map(item => item.run.ref).slice(0, 200) });
  const line = (await lines(project)).find(row => runs.some(item => item.outbox?.claim?.sessionRef?.sessionId === row.key.sessionId));
  const raw = line === undefined ? [] : await sessionHistory(project, line.key);
  const checkCards = [];
  for (const task of tasks?.tasks ?? []) {
    const checks = ready(await host.client.read('graph/look', project.scope, { goalRef: oldGoal,
      target: { kind: 'node', node: { kind: 'task', ref: task.ref, planRef: tasks.plan.ref } }, relation: 'checks', page }));
    checkCards.push(...(checks?.items ?? []));
  }
  const after = { ...(await queryCount(project)), head: (await host.client.get('/api/real/core/bootstrap'))?.changesHead ?? null };
  rec.check('reads-quiet', before.count === after.count && before.input === after.input && before.head === after.head,
    `QueryRun ${before.count}→${after.count}，输入 ${before.input}→${after.input}，changesHead ${before.head}→${after.head}`);
  rec.check('graph-cards', (look?.items?.length ?? 0) > 0 && (find?.items?.length ?? 0) > 0 && pathCard !== null,
    `goal children ${look?.items?.length ?? 0}，find ${find?.items?.length ?? 0}，path 卡 ${pathCard === null ? '无' : '有'}`);
  rec.check('raw-history', raw.length > 0 && historyItems > 0, `线的原历史 ${raw.length} 条，Run 历史 ${historyItems} 条`);
  const withEvidence = /"evidenceRefs":\[\{/.test(textOf(checkCards));
  rec.check('completion-chain', checkCards.length > 0 && withEvidence, `检查轮卡 ${checkCards.length} 张，有非空 evidenceRefs：${withEvidence}`);

  // Normal close and a new Host on the same ledger.
  const closing = await ctx.close('w-accept', { restart: true, check: 'restart-state' });
  host = closing.host;
  project.host = host;
  rec.note(`restart: ${closing.closed}`);
  const old = ready(await host.client.read('goals/display', project.scope, { goalRef: oldGoal }));
  const plan = ready(await host.client.read('tasks/query', project.scope, { goalRef: oldGoal }));
  const runsAfter = await executions(project, oldGoal);
  rec.check('restart-state', old?.display?.phase === 'COMPLETED' && plan?.plan !== undefined && runsAfter.length === runs.length,
    `重启后旧 Goal ${old?.display?.phase}，计划 ${plan?.plan?.ref?.planId ?? '无'}，Run ${runsAfter.length}/${runs.length}`);
  const reconcile = ready(await host.client.read('host/reconcile-report', project.scope, {}));
  rec.check('reconcile', reconcile?.lease === 'owned', `host/reconcile-report：lease ${reconcile?.lease ?? '读不到'}`);
  rec.check('redrive-sets', !textOf(old?.display?.causes).includes('interrupted_pending_resume'),
    `旧 Goal 的 causes：${textOf(old?.display?.causes).slice(0, 200)}`);

  // New related work through the old line.
  if (line === undefined) throw broken(ctx, 'lines/list shows no line for the old Goal', 'new-goal');
  const mainBefore = ready(await host.client.read('main/read', project.scope, { goalId: null, cursor: null }));
  const known = new Set((mainBefore?.requests ?? []).map(entry => JSON.stringify(entry.requestRoot)));
  const sent = await host.client.write('messages/send', project.scope,
    { recipient: line.key, text: FOLLOW, intent: 'action_request', needsReply: true }, []);
  rec.link('message', sent?.value?.ref ?? null);
  rec.facts.userCommand.push(FOLLOW);
  const request = await waitFor(ctx, 'the intervention_new_goal request', async () => {
    const main = ready(await host.client.read('main/read', project.scope, { goalId: null, cursor: null }));
    return (main?.requests ?? []).find(entry => !known.has(JSON.stringify(entry.requestRoot))) ?? null;
  }, value => value !== null, { timeoutMs: 20 * MINUTE });
  const view = await waitRequest(ctx, project, request.requestRoot);
  const round = [...view.rounds].reverse().find(entry => entry.goalCardDrafts.length > 0);
  if (round === undefined) throw broken(ctx, 'the new request gave no Goal card draft', 'new-goal');
  const confirmed = await host.client.command('goals/confirm-draft', project.scope,
    { commandId: newId('confirm'), round: round.ref, index: round.goalCardDrafts[0].index });
  const binding = confirmed?.value?.binding;
  if (binding === undefined) throw broken(ctx, `goals/confirm-draft: ${confirmed?.code} ${confirmed?.reason}`, 'new-goal');
  const newGoal = binding.goalRef;
  rec.ownGoal(project, newGoal, binding.goalRevision);
  const adopted = await adoptBinding(ctx, project, binding);
  await settleAutonomy(ctx, project, newGoal, rec);
  const fresh = ready(await host.client.read('tasks/query', project.scope, { goalRef: newGoal }));
  const flowId = newId('e12-new');
  const first = await driverStart(ctx, project, newGoal, { flowId });
  const replay = await driverStart(ctx, project, newGoal, { flowId });
  rec.check('replay', replay?.status === first?.status && JSON.stringify(first?.value?.goalRef) === JSON.stringify(newGoal)
    && first?.value?.flowId === replay?.value?.flowId && first?.value?.state === replay?.value?.state,
  `同一 flowId 两次 driver-start：${first?.status}/${replay?.status}，state ${first?.value?.state}/${replay?.value?.state}`);
  const newDone = await waitGoal(ctx, project, newGoal, { timeoutMs: 90 * MINUTE, rec });
  const oldAgain = ready(await host.client.read('goals/display', project.scope, { goalRef: oldGoal }));
  rec.check('new-goal', newGoal.goalId !== oldGoal.goalId && oldAgain?.display?.phase === 'COMPLETED' && fresh !== null
    && fresh.tasks.length > 0 && fresh.tasks.every(task => task.effectivePhase !== 'satisfied') && newDone.display.phase === 'COMPLETED',
  `新 Goal ${newGoal.goalId}（采用 ${adopted.status}，起步时 ${fresh?.tasks?.length ?? 0} 个任务都没满足）→ ${newDone.display.phase}；旧 Goal 仍 ${oldAgain?.display?.phase}`);
  // C-220, judged on what the new work actually got back (#12): a successful tool result of its Runs that names the
  // old Goal or one of its Runs is a query of the completed work with its source kept.
  const oldIds = [oldGoal.goalId, ...runs.map(item => item.run.ref.runId)];
  const reused = [];
  for (const item of await executions(project, newGoal)) {
    for (const result of turnsOf(await runHistory(project, item.run.ref)).flatMap(turn => turn.results)) {
      const named = oldIds.filter(id => result.text.includes(id));
      if (named.length > 0) reused.push(`${item.run.ref.runId}: ${result.name} → ${named.join(', ')}`);
    }
  }
  if (reused.length === 0) rec.uncover('history-reuse', 'not-run', '新 Goal 的 Run 没有一个成功的工具结果引用旧 Goal 或旧 Run（这次新工作没有查询已完成工作）');
  else rec.pass('history-reuse', `新工作查询已完成工作且带来源：${reused.slice(0, 5).join('；')}`);
  rec.uncover('stale-premise', 'entry-missing', '适用范围和“过期前提不升级”是模型对已查到事实的取舍，公开读口没有逐项可判的字段，不判通过');
  rec.uncover('wait-registry', 'entry-missing', '目标等待登记表只在 Host 内存里，没有公开读口；重启后只能看到它的效果（等待的线被叫醒），看不到登记表本身');
}

export default { ...def, run };
