// E06: continued work on E05's project, then a handoff with a reason; the successor works from durable material
// only; restarts while a Run works and while the Goal is paused; the predecessor archived, history still readable
// (draft §1.2; MVP-BEHAVIOR.md:358; slice-9-SPEC.md:661, :687). The person never restates the task after the handoff.
import { newId, ready } from '../lib/http.mjs';
import { answerCard, approve, broken, chooseModel, coldStart, driverStart, executions, lines, orNull, runHistory, sessionHistory,
  sessionTurns, sleep, textOf, turnsOf, waitFor, waitGoal, waitingCards } from '../lib/flows.mjs';
import { Abort } from '../lib/report.mjs';

const MINUTE = 60_000;
const EXCLUDED = 'src/legacy';
const REQUEST = '接着上一个目标做：给 src/rules.js 的 isEmail 加长度上限 254，并给 users、orders 各补一个超长邮箱的测试。'
  + `当前理解：${EXCLUDED}/ 下是旧代码，已经排除，不要改也不要引用。`;
const HANDOFF = '请把你这条线手上的工作交给另一位成员接手（用 hand_off），理由写清楚：这条线已经做了很久，换一个新上下文继续。';

const def = {
  id: 'E06',
  rows: ['C-75', 'C-135', 'C-106', 'C-194', 'C-149', 'C-151', 'C-68', 'C-181', 'C-209', 'C-219', 'C-223'],
  checks: [
    { id: 'handoff', rows: ['C-219'], text: '模型 hand_off，人批准，出现接任线' },
    { id: 'successor-input', rows: ['C-75', 'C-209', 'C-219'], text: '接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId' },
    { id: 'successor-frontier', rows: ['C-75'], text: '接任者实际输入含前任的义务/前沿' },
    { id: 'no-restatement', rows: ['C-209'], text: '换手后用户没有重述任务' },
    { id: 'excluded-path', rows: ['C-209'], text: '接任者引用当前理解并避开已排除路径' },
    { id: 'same-task-new-run', rows: ['C-135'], text: '同一 Task 新开 Attempt/Run 优先原 Session，带接续说明' },
    { id: 'history-continuity', rows: ['C-106', 'C-194'], text: '后续输入真正含必要前文（不只同一 Session ID）' },
    { id: 'restart-running', rows: ['C-149'], text: 'Work Run 在跑时正常关闭重启：记被中断，继续在原 Session' },
    { id: 'restart-paused', rows: ['C-151'], text: '暂停中重启：不算失败，可继续，恢复后在原线接着做' },
    { id: 'archive', rows: ['C-219'], text: '归档前任后源线历史可读（sessions/history、executions/history）' },
    { id: 'hand-or-drop', rows: ['C-223'], text: '归档有未完成任务的线：先选交给或放下，同时释放责任与席位' },
    { id: 'wake', rows: ['C-68', 'C-181'], text: '答卡等提交叫醒目标驱动，后继 Run 真的启动' },
  ],
};

async function runningRun(ctx, project, goalRef, minutes, check) {
  return waitFor(ctx, 'a running Work Run', async () => (await executions(project, goalRef)).find(item => item.run.status === 'running') ?? null,
    item => item !== null, { timeoutMs: minutes * MINUTE, check });
}

async function pause(ctx, project, goalRef, control) {
  const goal = ready(await project.host.client.read('goals/read', project.scope, goalRef));
  if (goal === null) throw broken(ctx, `goals/read of ${goalRef.goalId} failed before ${control}`);
  return project.host.client.write('goals/control', project.scope, { goalRef, control, reason: `G6 E06 ${control}` },
    [{ ref: goalRef, revision: goal.goal.revision }, { ref: { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId }, revision: 0 }]);
}

/** Restart W-accept over the same ledger and hand the scenario's project to the new client. */
async function restart(ctx, project, rec, why, check) {
  const { closed, host } = await ctx.close('w-accept', { restart: true, check });
  rec.note(`restart (${why}): ${closed}`);
  project.host = host;
  const settings = ready(await host.client.settings('snapshot', {}));
  rec.note(`resumeOnStartup = ${settings?.automation?.resumeOnStartup}`);
  return host;
}

async function run(ctx, rec) {
  const e05 = ctx.shared.e05;
  if (e05 === undefined) throw new Abort('not-run', 'E05 left no project/work line to continue');
  // Second review #3: E05's late work must never be counted as E06's; a project with work still in flight is not
  // taken over.
  if (ctx.units.get('E05')?.facts.settled !== true) throw new Abort('not-run', 'E05 still had work in flight at its end; E06 does not take its project over');
  const project = e05.project;
  project.host = ctx.hosts['w-accept'];
  rec.facts.project = project;
  // From here on, what this project spends is E06's (E05's own work settled at E05's end).
  ctx.budget.own(project.scope, rec.id);
  rec.projects.push(project);
  rec.facts.model = await chooseModel(ctx, project.host, project);
  rec.facts.userCommand = [REQUEST, HANDOFF];
  const started = await coldStart(ctx, project, REQUEST, rec);
  const goalRef = started.goalRef;

  // 1. A Run works: normal close and restart (C-149). Under the default `ask` the Goal waits for the person.
  const first = await runningRun(ctx, project, goalRef, 30);
  const firstSession = first.outbox?.claim?.sessionRef ?? null;
  await restart(ctx, project, rec, 'Work Run running', 'restart-running');
  const shown = ready(await project.host.client.read('goals/display', project.scope, { goalRef }));
  rec.note(`after restart: ${shown?.display?.phase}/${shown?.display?.row} causes ${textOf(shown?.display?.causes)}`);
  await driverStart(ctx, project, goalRef, { flowId: newId('e06-resume') });
  const resumed = await orNull(runningRun(ctx, project, goalRef, 20, 'restart-running'));
  const firstRun = (await executions(project, goalRef)).find(item => item.run.ref.runId === first.run.ref.runId);
  rec.check('restart-running', firstRun?.run.status === 'ended' && resumed !== null
    && resumed.outbox?.claim?.sessionRef?.sessionId === firstSession?.sessionId,
  `重启前 Run ${first.run.ref.runId} → ${firstRun?.run.outcome}；继续的 Run ${resumed?.run.ref.runId ?? '无'} 在 ${resumed?.outbox?.claim?.sessionRef?.sessionId ?? '-'}（原 ${firstSession?.sessionId}）`);

  // 2. The person asks the working line to hand off; the model's `hand_off` raises a card the person approves.
  const workLine = (await lines(project)).find(row => row.key.sessionId === (resumed ?? first).outbox?.claim?.sessionRef?.sessionId);
  if (workLine === undefined) throw broken(ctx, 'lines/list shows no row for the working Session');
  const sent = await project.host.client.write('messages/send', project.scope,
    { recipient: workLine.key, text: HANDOFF, intent: 'action_request', needsReply: true }, []);
  rec.link('message', sent?.value?.ref ?? null, sent?.value?.revision ?? null);
  // Under `after_plan_confirmation` a short-term line's handoff is an automatic notice, not a card
  // (`decision-policy.ts:120-121`); a `handoff_approval` card that does appear gets the person's approval.
  let approved = 0;
  const chain = await waitFor(ctx, 'a successor on the line', async () => {
    for (const card of await waitingCards(project)) {
      if (card.source.kind !== 'handoff_approval') continue;
      if (await answerCard(ctx, project, card, { kind: 'option', optionId: 'approve' }, '', rec)) approved += 1;
    }
    return (await lines(project)).find(row => row.key.sessionId !== workLine.key.sessionId
      && row.chainSessions?.some(entry => (entry.sessionId ?? entry.ref?.sessionId) === workLine.key.sessionId)) ?? null;
  }, row => row !== null, { timeoutMs: 40 * MINUTE });
  rec.check('handoff', chain !== null, `前任 ${workLine.key.sessionId} → 接任 ${chain.key.sessionId}（批准的交接卡 ${approved} 张）`);
  rec.link('session', chain.key);

  // 3. Pause, restart while paused (C-151), resume.
  const pausedAnswer = await pause(ctx, project, goalRef, 'pause');
  rec.note(`pause: ${pausedAnswer?.status} ${pausedAnswer?.code ?? ''}`);
  await sleep(20_000);
  await restart(ctx, project, rec, 'Goal paused', 'restart-paused');
  const pausedShown = ready(await project.host.client.read('goals/display', project.scope, { goalRef }));
  const resume = await pause(ctx, project, goalRef, 'resume');
  const done = await waitGoal(ctx, project, goalRef, { timeoutMs: 120 * MINUTE, rec, answer: card => (card.source.kind === 'handoff_approval' ? null : approve(card)) });
  rec.check('restart-paused', pausedShown?.display?.phase === 'PAUSED' && resume?.status === 'committed' && done.display.phase === 'COMPLETED',
    `重启后 ${pausedShown?.display?.phase}/${pausedShown?.display?.row}；恢复 ${resume?.status}；最后 ${done.display.phase}`);

  // 4. What the successor actually received, judged by turn identity (lead ruling 11-14 #9): only its turns' input,
  // never a tool result it read or an answer it wrote; the reason is the predecessor's own `hand_off` argument.
  const successorTurns = await sessionTurns(project, chain.key);
  const successorInput = successorTurns.map(turn => turn.input).join('\n');
  const predecessorTurns = await sessionTurns(project, workLine.key);
  const handOff = predecessorTurns.flatMap(turn => [...turn.calls.values()])
    .filter(call => call.name === 'hand_off' && call.status === 'tool.completed' && typeof call.args?.reason === 'string').at(-1);
  const objectiveWords = ['254', 'isEmail'];
  const hasGoal = objectiveWords.every(word => successorInput.includes(word));
  if (handOff === undefined) {
    rec.uncover('successor-input', 'not-run', `前任没有成功的 hand_off 调用（交接不是工具触发），理由原文无从比对；接任输入含目标词：${hasGoal}`);
  } else {
    const reason = handOff.args.reason.trim();
    rec.check('successor-input', hasGoal && successorInput.includes(reason),
      `接任者 turn 输入（${successorTurns.length} 轮）含目标词 ${objectiveWords.join('/')}：${hasGoal}；含 hand_off 理由原文「${reason}」：${successorInput.includes(reason)}`);
  }
  rec.uncover('successor-frontier', 'entry-missing', '前任的义务/前沿没有一份可逐字比对的公开原文（hand_off 只给 reason 和 understanding 注记引用），不判通过');
  rec.pass('no-restatement', '驱动在换手批准之后没有再给这条线发任何消息（http.jsonl 可核）');
  const runs = await executions(project, goalRef);
  // Avoided = no successful tool result of the successor's Runs changed a path under the excluded folder.
  const touched = [];
  for (const item of runs.filter(entry => entry.outbox?.claim?.sessionRef?.sessionId === chain.key.sessionId)) {
    const changed = turnsOf(await runHistory(project, item.run.ref)).flatMap(turn => turn.results).flatMap(result => result.changedPaths);
    if (changed.some(path => path.startsWith(EXCLUDED))) touched.push(item.run.ref.runId);
  }
  rec.check('excluded-path', successorInput.includes(EXCLUDED) && touched.length === 0,
    `接任者 turn 输入提到 ${EXCLUDED}：${successorInput.includes(EXCLUDED)}；成功写过它的 Run：${touched.join(', ') || '无'}`);
  const byTask = new Map();
  for (const item of runs) byTask.set(item.run.task.taskId, [...(byTask.get(item.run.task.taskId) ?? []), item]);
  const repeated = [...byTask.values()].find(list => list.length > 1);
  if (repeated === undefined) rec.uncover('same-task-new-run', 'not-run', '这次没有出现同一 Task 的第二个 Run');
  else {
    const brief = ready(await project.host.client.read('executions/brief', project.scope, { runRef: repeated.at(-1).run.ref }));
    rec.check('same-task-new-run', brief !== null, `Task ${repeated[0].run.task.taskId}：${repeated.length} 个 Run；接续说明 ${brief === null ? '无' : 'digest ' + brief.digest}`);
  }
  // Necessary prior text: the predecessor's last final answer, quoted into a later turn's input of the successor.
  const lastFinal = predecessorTurns.map(turn => turn.final).filter(text => text !== null).at(-1) ?? null;
  const quote = lastFinal === null ? null : lastFinal.trim().slice(0, 40);
  if (quote === null || quote.length === 0) rec.uncover('history-continuity', 'not-run', '前任没有完成的一轮最终答复，前文无从比对');
  else rec.check('history-continuity', successorInput.includes(quote), `前任最后的最终答复开头「${quote}」在接任者 turn 输入里：${successorInput.includes(quote)}`);
  rec.check('wake', runs.some(item => item.outbox?.claim?.sessionRef?.sessionId === chain.key.sessionId),
    `交接（批准的卡 ${approved} 张）之后接任线上有 Run：后继真的启动`);

  // 5. Archive the predecessor (no tasks left: plain archive-line with no choices), then read its history.
  const record = ready(await project.host.client.read('sessions/read', project.scope, workLine.key));
  if (record === null) throw broken(ctx, 'sessions/read of the predecessor failed');
  const archived = await project.host.client.write('sessions/archive-line', project.scope,
    { sessionRef: workLine.key, reason: 'G6 E06: 换手后归档前任', tasks: [], wait: null },
    [{ ref: { aggregateType: 'Session', ...workLine.key }, revision: record.record.revision }]);
  const after = await sessionHistory(project, workLine.key);
  const firstHistory = ready(await project.host.client.read('executions/history', project.scope, { runRef: first.run.ref, afterCursor: null, limit: 50 }));
  rec.check('archive', archived?.status === 'ready' && archived.value?.state === 'archived' && after.length > 0 && firstHistory !== null,
    `archive-line ${archived?.status} ${archived?.value?.state ?? archived?.code ?? ''}；归档后 sessions/history ${after.length} 条，executions/history ${firstHistory === null ? '读不到' : '可读'}`);
  // The predecessor's work was done before the archive (no Task to hand or drop), so C-223's choice never happened.
  rec.uncover('hand-or-drop', 'not-run', '归档时前任线上没有未完成任务（tasks: []），没有实际发生“交给/放下”');
  ctx.shared.e06 = { project, goalRef, predecessor: workLine.key, successor: chain.key };
}

export default { ...def, run };
