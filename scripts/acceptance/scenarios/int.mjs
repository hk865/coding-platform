// Direct intervention (draft §1.7; MVP-BEHAVIOR.md:333-343; slice-9-SPEC.md:666, :692): "ask" is a read-only copy
// (`queries/ask`), a direct intervention is `messages/send` with `intent:'action_request'` to the line
// (the UI's `interveneLine`); with a task to continue there is no `intervention_planning`, without one there is;
// a message to a COMPLETED Goal's line is confirmed as a new Goal first; pause only queues.
import { newId, ready } from '../lib/http.mjs';
import { broken, chooseModel, coldStart, executions, lines, openProject, orNull, sessionQueries, sleep, TERMINAL, textOf,
  waitFor, waitGoal, waitRequest } from '../lib/flows.mjs';

const MINUTE = 60_000;
const SEED = {
  'package.json': '{\n  "name": "g6-int",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6 intervention\n\nString helpers.\n',
  'str.js': 'export function upper(text) {\n  return text.toUpperCase();\n}\n',
};
const DONE_REQUEST = '在 str.js 加 lower(text)，并加 test/lower.test.js。验收：node --test 通过。';
const LONG_REQUEST = '在 str.js 加 slugify(text)、truncate(text, n)、capitalize(text) 三个函数，每个函数单独一个任务，'
  + '各加 test/<函数名>.test.js，测试要覆盖空串和中文。验收：node --test 通过。';
const INTERVENE = '顺便把 README.md 的标题改成中文“字符串工具”，别的不变。';
const ASK = '你现在在做哪一步？还剩什么？';

const def = {
  id: 'intervention',
  rows: ['C-199', 'C-200', 'C-201', 'C-202', 'C-203', 'C-114', 'C-189', 'C-192', 'C-197', 'C-198'],
  checks: [
    { id: 'ask-copy', rows: ['C-198'], text: '“问一问”开只读副本，不打扰原线' },
    { id: 'delivery-states', rows: ['C-189', 'C-192'], text: '消息在安全点送达，分别显示已排队/已送达（disposition）' },
    { id: 'continue-no-planning', rows: ['C-199'], text: '有任务接着做时不开 intervention_planning' },
    { id: 'planning-when-idle', rows: ['C-199', 'C-200'], text: '活跃目标、线上没有未完成任务时开 intervention_planning，答案交 plans/propose' },
    { id: 'four-endings', rows: ['C-201', 'C-202', 'C-203'], text: '四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默' },
    { id: 'completed-goal', rows: ['C-114'], text: '已完成 Goal 上加工作，先确认成新 Goal，原完成不变' },
    { id: 'paused-queues', rows: ['C-197'], text: '暂停时干预只排队，不冒充继续；恢复后才送达' },
  ],
};

const sameRef = (left, right) => left !== null && right !== null && typeof left === 'object' && typeof right === 'object'
  && JSON.stringify(Object.keys(left).sort()) === JSON.stringify(Object.keys(right).sort())
  && Object.keys(left).every(key => left[key] === right[key]);

/**
 * The `intervention_planning` Query that started from exactly this message (second review #17): a line Query's job
 * whose `execution.sourceMessageRef` is the message (`query-job.ts:356-357`); null when there is none.
 */
async function planningOf(project, messageRef) {
  for (const row of await lines(project)) {
    for (const snapshot of await sessionQueries(project, row.key)) {
      if (!String(snapshot.ref.queryJobId).startsWith('intervention-planning-')) continue;
      const job = ready(await project.host.client.read('queries/read', project.scope,
        { aggregateType: 'QueryJob', projectId: snapshot.ref.projectId, workspaceId: snapshot.ref.workspaceId, queryJobId: snapshot.ref.queryJobId }));
      if (sameRef(job?.job?.job?.intent?.execution?.sourceMessageRef ?? null, messageRef)) return job;
    }
  }
  return null;
}

/**
 * The line's current Task as the product reads it (quick check #9): `sessions/facts.latestWork.task`
 * (`intervention.ts:114`), and that Task's disposition and effectivePhase now; unfinished = active and not
 * satisfied (`:189-191`). `readable: false` when either read gives no answer: the branch cannot be told.
 */
async function currentWork(project, sessionRef) {
  const facts = ready(await project.host.client.read('sessions/facts', project.scope, sessionRef));
  if (facts === null) return { readable: false, text: 'sessions/facts 没有回答' };
  const task = facts.latestWork?.task ?? null;
  if (task === null) return { readable: true, task: null, unfinished: false, text: '没有 latestWork' };
  const goalRef = { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId };
  const row = (ready(await project.host.client.read('tasks/query', project.scope, { goalRef }))?.tasks ?? []).find(entry => entry.ref.taskId === task.taskId);
  if (row === undefined) return { readable: false, task, text: `tasks/query 里找不到 ${task.taskId}` };
  return { readable: true, task, unfinished: row.disposition === 'active' && row.effectivePhase !== 'satisfied',
    text: `${task.goalId}/${task.taskId} ${row.disposition}/${row.effectivePhase}` };
}
/** `messages/view` disposition is `{kind}` (`session-message.ts:126-131`). */
async function disposition(project, messageRef) {
  return ready(await project.host.client.read('messages/view', project.scope, messageRef))?.disposition?.kind ?? null;
}

async function control(ctx, project, goalRef, kind) {
  const goal = ready(await project.host.client.read('goals/read', project.scope, goalRef));
  if (goal === null) throw broken(ctx, `goals/read of ${goalRef.goalId} failed before ${kind}`);
  return project.host.client.write('goals/control', project.scope, { goalRef, control: kind, reason: `G6 intervention ${kind}` },
    [{ ref: goalRef, revision: goal.goal.revision }, { ref: { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId }, revision: 0 }]);
}

async function run(ctx, rec) {
  const host = ctx.hosts['w-accept'];
  const project = await openProject(ctx, host, 'int', SEED);
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, host, project);
  rec.facts.userCommand = [DONE_REQUEST, LONG_REQUEST];
  const done = await coldStart(ctx, project, DONE_REQUEST, rec);
  const doneEnd = await waitGoal(ctx, project, done.goalRef, { timeoutMs: 60 * MINUTE, rec, check: 'completed-goal' });
  if (doneEnd.display.phase !== 'COMPLETED') throw broken(ctx, `the first Goal ended ${doneEnd.display.phase}, not COMPLETED`, 'completed-goal');
  // The line that worked on the completed Goal: the claim Session of its Runs.
  const doneRuns = await executions(project, done.goalRef);
  const doneLine = (await lines(project)).find(row => doneRuns.some(item => item.outbox?.claim?.sessionRef?.sessionId === row.key.sessionId));

  const busy = await coldStart(ctx, project, LONG_REQUEST, rec);
  const running = await waitFor(ctx, 'a running Run on the long Goal', async () =>
    (await executions(project, busy.goalRef)).find(item => item.run.status === 'running') ?? null, value => value !== null, { timeoutMs: 40 * MINUTE });
  const line = (await lines(project)).find(row => row.key.sessionId === running.outbox?.claim?.sessionRef?.sessionId);
  if (line === undefined) throw broken(ctx, 'lines/list shows no row for the working Session');

  // "Ask": a read-only copy answers; the working line is not disturbed: its Run is not cancelled or interrupted by
  // the ask (it may finish normally meanwhile) and no message is put into its inbox (lead ruling 11-14 #14).
  const inbox = async () => ready(await host.client.read('messages/inbox', project.scope, { recipient: line.key, page: { limit: 100 } }))?.items ?? [];
  const inboxBefore = new Set((await inbox()).map(item => JSON.stringify(item.ref ?? item)));
  const asked = await host.client.read('queries/ask', project.scope, { sessionRef: line.key, question: ASK, commandId: newId('ask') });
  const askRound = asked?.round;
  if (askRound === undefined) throw broken(ctx, `queries/ask: ${asked?.status} ${asked?.code ?? ''} ${asked?.reason ?? ''}`, 'ask-copy');
  const askJob = await waitFor(ctx, 'the ask answer', async () =>
    ready(await host.client.read('queries/read', project.scope, askRound)), value => value?.run?.run?.status === 'answered' || value?.run?.run?.status === 'closed',
  { timeoutMs: 20 * MINUTE, check: 'ask-copy' });
  const original = (await executions(project, busy.goalRef)).find(item => item.run.ref.runId === running.run.ref.runId);
  const undisturbed = original?.run.status === 'running' || (original?.run.status === 'ended' && original.run.outcome === 'completed');
  const inserted = (await inbox()).filter(item => !inboxBefore.has(JSON.stringify(item.ref ?? item)) && textOf(item).includes(ASK));
  rec.check('ask-copy', askJob.run.run.status === 'answered' && undisturbed && inserted.length === 0,
    `问一问 ${asked?.status} → ${askJob.run.run.status}；原线 Run ${original?.run.status}/${original?.run.outcome ?? '-'}；问题进了原线收件箱：${inserted.length} 条`);

  // A direct intervention while the task is working: delivered at a safe point, and no intervention_planning Query
  // for this message (found by the Query's own sourceMessageRef, not by counting the line's Queries).
  // The branch condition is read before the send, as the product reads it when the message arrives.
  const workAtSend = await currentWork(project, line.key);
  const sent = await host.client.write('messages/send', project.scope,
    { recipient: line.key, text: INTERVENE, intent: 'action_request', needsReply: true }, []);
  rec.facts.userCommand.push(INTERVENE);
  const messageRef = sent?.value?.ref;
  if (messageRef === undefined) throw broken(ctx, `messages/send to the working line: ${sent?.status} ${sent?.code ?? ''} ${sent?.reason ?? ''}`, 'delivery-states');
  rec.link('message', messageRef, sent.value.revision ?? null);
  const states = [];
  await waitFor(ctx, 'the intervention to be delivered', async () => {
    const kind = await disposition(project, messageRef);
    if (kind !== null && states.at(-1) !== kind) states.push(kind);
    return kind;
  }, kind => kind === 'delivered', { timeoutMs: 30 * MINUTE, check: 'delivery-states' });
  rec.check('delivery-states', states.includes('delivered'), `disposition 依次：${states.join(' → ') || '无'}（发送回执 ${sent?.sendStatus}）`);
  await sleep(30_000);
  // Second review #9: this check is about the "a Task to continue" branch only; it is judged only when the line held
  // an unfinished Task when the message was sent.
  if (!workAtSend.readable) rec.uncover('continue-no-planning', 'entry-missing', `发送前读不到这条线当前对应的任务（${workAtSend.text}），分支无从确定`);
  else if (!workAtSend.unfinished) rec.uncover('continue-no-planning', 'not-run', `发送时这条线当前的任务不是未完成（${workAtSend.text}），不是“有任务接着做”的分支`);
  else {
    const planningForSent = await planningOf(project, messageRef);
    rec.check('continue-no-planning', planningForSent === null,
      `发送时线上当前任务 ${workAtSend.text}；这条消息的 intervention_planning Query：${planningForSent === null ? '没有' : planningForSent.job?.job?.status}`);
  }

  // Pause: an intervention only queues; resume delivers it.
  const paused = await control(ctx, project, busy.goalRef, 'pause');
  const queued = await host.client.write('messages/send', project.scope,
    { recipient: line.key, text: '暂停期间的补充：测试名统一用英文。', intent: 'action_request', needsReply: true }, []);
  await sleep(60_000);
  if (queued?.value?.ref === undefined) throw broken(ctx, `messages/send while paused: ${queued?.code} ${queued?.reason}`, 'paused-queues');
  const whilePaused = await disposition(project, queued.value.ref);
  const resumed = await control(ctx, project, busy.goalRef, 'resume');
  const afterResume = await orNull(waitFor(ctx, 'delivery after resume', () => disposition(project, queued.value.ref),
    kind => kind === 'delivered', { timeoutMs: 30 * MINUTE, check: 'paused-queues' }));
  rec.check('paused-queues', paused?.status === 'committed' && whilePaused !== null && whilePaused !== 'delivered' && afterResume === 'delivered',
    `暂停 ${paused?.status}：暂停中 ${whilePaused}；恢复 ${resumed?.status} 后 ${afterResume ?? '没送达'}`);

  // The idle branch (lead ruling 11-14 #15; second review #9/#10): while the long Goal is active, the first time a
  // line that worked on it holds no unfinished Task (active and not satisfied), the person sends that line one
  // intervention; only the Query that started from exactly that message can judge C-199/C-200. A refused send is the
  // platform's answer: `fail` with its code and reason.
  let idle = null;
  const busyEnd = await waitGoal(ctx, project, busy.goalRef, { timeoutMs: 150 * MINUTE, rec, onPoll: async display => {
    const phase = display?.display?.phase;
    if (idle !== null || phase === undefined || TERMINAL.includes(phase) || phase === 'PAUSED') return;
    const workers = new Set((await executions(project, busy.goalRef)).map(item => item.outbox?.claim?.sessionRef?.sessionId).filter(Boolean));
    for (const row of (await lines(project)).filter(entry => workers.has(entry.key.sessionId))) {
      const now = await currentWork(project, row.key);
      if (!now.readable || now.task === null || now.task.goalId !== busy.goalRef.goalId || now.unfinished) continue;
      const idleSent = await host.client.write('messages/send', project.scope,
        { recipient: row.key, text: '再补一个 kebabCase(text)，同样单独一个任务并加测试。', intent: 'action_request', needsReply: true }, []);
      idle = { messageRef: idleSent?.value?.ref ?? null, line: row.key.sessionId, phase, work: now.text, at: new Date().toISOString(),
        refused: idleSent?.value?.ref === undefined ? `${idleSent?.status} ${idleSent?.code ?? ''} ${idleSent?.reason ?? ''}` : null };
      rec.link('message', idle.messageRef);
      return;
    }
  } });
  if (idle === null) rec.uncover('planning-when-idle', 'not-run', '长目标活跃期间没有出现“干过活的线上没有未完成任务”的时刻，没走到这个分支');
  else if (idle.refused !== null) rec.fail('planning-when-idle', `${idle.at} 发给闲线 ${idle.line} 的消息被拒：${idle.refused}`);
  else {
    const job = await orNull(waitFor(ctx, 'the planning Query of the idle-line message', () => planningOf(project, idle.messageRef),
      value => value !== null && ['answered', 'closed'].includes(value.run?.run?.status), { timeoutMs: 20 * MINUTE, check: 'planning-when-idle' }));
    rec.check('planning-when-idle', job !== null && job.run.run.status === 'answered' && (job.job?.job?.answerRefs?.length ?? 0) > 0,
      `${idle.at} 发给 ${idle.line}（目标 ${idle.phase}，线上当前任务 ${idle.work}，不是未完成）；它的 intervention_planning：${
        job === null ? '没有' : `${job.run.run.status}，answerRefs ${job.job?.job?.answerRefs?.length ?? 0}，closeReason ${job.job?.job?.closeReason?.code ?? '-'}`}`);
    idle.ending = job?.job?.job?.closeReason?.code ?? job?.run?.run?.status ?? null;
  }
  // "Asks back" and "illegal answer" cannot be caused through a public entry, so the row stays uncovered; the ending
  // that was seen is listed.
  rec.uncover('four-endings', 'entry-missing', `“反问”“非法”两种收尾没有公开入口能造出；这次看到的结局：${idle?.ending ?? '无'}`);
  rec.note(`长目标结束 ${busyEnd.display.phase}`);

  // A message to the COMPLETED Goal's line: confirmed as a new Goal first; the old completion stays.
  if (doneLine === undefined) throw broken(ctx, 'no work line of the completed Goal in lines/list', 'completed-goal');
  const main = ready(await host.client.read('main/read', project.scope, { goalId: null, cursor: null }));
  const known = new Set((main?.requests ?? []).map(entry => JSON.stringify(entry.requestRoot)));
  await host.client.write('messages/send', project.scope,
    { recipient: doneLine.key, text: '再加一个 reverse(text)，同样加测试。', intent: 'action_request', needsReply: true }, []);
  const request = await waitFor(ctx, 'the new-Goal request', async () =>
    (ready(await host.client.read('main/read', project.scope, { goalId: null, cursor: null }))?.requests ?? [])
      .find(entry => !known.has(JSON.stringify(entry.requestRoot))) ?? null, value => value !== null, { timeoutMs: 20 * MINUTE });
  const requestView = await waitRequest(ctx, project, request.requestRoot);
  const draftRound = [...requestView.rounds].reverse().find(round => round.goalCardDrafts.length > 0);
  const confirmed = draftRound === undefined ? null : await host.client.command('goals/confirm-draft', project.scope,
    { commandId: newId('confirm'), round: draftRound.ref, index: draftRound.goalCardDrafts[0].index });
  const oldAfter = ready(await host.client.read('goals/display', project.scope, { goalRef: done.goalRef }));
  rec.check('completed-goal', confirmed?.status === 'committed' && confirmed.value.binding.goalRef.goalId !== done.goalRef.goalId
    && oldAfter?.display?.phase === 'COMPLETED',
  `新 Goal ${confirmed?.value?.binding?.goalRef?.goalId ?? '无'}；原 Goal 仍 ${oldAfter?.display?.phase}`);
}

export default { ...def, run };
