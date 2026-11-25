// Direct intervention (draft §1.7; MVP-BEHAVIOR.md:333-343; slice-9-SPEC.md:666, :692): "ask" is a read-only copy
// (`queries/ask`); a direct intervention is the UI's `messages/send` to the line with `entry: 'person_intervention'`
// (`boot.ts:1583-1597`, flows `interveneLine`; P2 removed `intent`); with a task to continue there is no
// `intervention_planning`, without one there is; a message to a COMPLETED Goal's line is confirmed as a new Goal
// first; pause only queues.
import { newId, ready } from '../lib/http.mjs';
import { broken, chooseModel, coldStart, confirmNewGoal, driverStart, executions, interveneLine, lines, messageBody, messageView,
  newGoalInProject, openProject, orNull, runHistory, sessionQueries, sleep, submitRequest, TERMINAL, turnsOf, unreadableSources,
  waitFor, waitGoal } from '../lib/flows.mjs';

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
const PAUSED_TEXT = '暂停期间的补充：测试名统一用英文。';
const IDLE_TEXT = '再补一个 kebabCase(text)，同样单独一个任务并加测试。';
const CLAIM_TEXT = '继续做你手上这个任务；测试里记得覆盖空串和中文。';
const DONE_TEXT = '再加一个 reverse(text)，同样加测试。';
const ASK = '你现在在做哪一步？还剩什么？';
/** A message's disposition after which it is no longer waiting for a safe point (`session-message.ts:134-140`). */
const SETTLED = ['delivered', 'answered', 'withdrawn', 'undelivered'];

const def = {
  id: 'intervention',
  rows: ['C-199', 'C-200', 'C-201', 'C-202', 'C-203', 'C-114', 'C-189', 'C-192', 'C-197', 'C-198'],
  checks: [
    { id: 'ask-copy', rows: ['C-198'], text: '“问一问”开只读副本，不占原线：问件 answeredBy 为 copy，没送进原线的 Run，原 Run 的输入里没有这个问题' },
    { id: 'delivery-states', rows: ['C-189', 'C-192'], text: '消息在安全点送达，分别显示已排队/已送达（disposition）' },
    { id: 'busy-original-words', rows: ['C-189', 'C-199'], text: '忙线收到原话：送达的是发信时在跑的那个 Run，它的一轮输入含原话' },
    { id: 'continue-no-planning', rows: ['C-199'], text: '有任务接着做时不开 intervention_planning' },
    { id: 'planning-when-idle', rows: ['C-199', 'C-200'], text: '活跃目标、线上没有未完成任务时在原线开 intervention_planning，答案交 plans/propose' },
    { id: 'claim-once', rows: ['C-199'], text: '空闲线上有未完成任务：直接干预领一次（送进因它新开的 Run，这条线上这个任务只新增 1 个 Run，不开规划）' },
    { id: 'four-endings', rows: ['C-201', 'C-202', 'C-203'], text: '四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默' },
    { id: 'review-packet', rows: ['C-199'], text: '直接干预的原话进入这个目标的执行审阅包（execreview）' },
    { id: 'completed-goal', rows: ['C-114'], text: '已完成 Goal 上加工作，先确认成新 Goal，原完成不变' },
    { id: 'paused-queues', rows: ['C-197'], text: '暂停时干预只排队，不冒充继续；恢复后才送达' },
  ],
};

const sameRef = (left, right) => left !== null && right !== null && typeof left === 'object' && typeof right === 'object'
  && JSON.stringify(Object.keys(left).sort()) === JSON.stringify(Object.keys(right).sort())
  && Object.keys(left).every(key => left[key] === right[key]);
const claimSession = item => item.outbox?.claim?.sessionRef?.sessionId ?? null;
/** Where a message was accepted (`deliveredTo.executionRef`, `session-message.ts:128-133`): a Run or a QueryRun. */
const describe = into => (into === null || into === undefined ? '无' : `${into.aggregateType} ${into.runId ?? into.queryJobId ?? JSON.stringify(into)}`);

/**
 * The `intervention_planning` Query that started from exactly this message (second review #17): a line Query's job
 * whose `execution.sourceMessageRef` is the message (`query-job.ts:362`), with the line it runs on (P6: the candidate
 * must come from the original line); null when there is none.
 */
async function planningOf(project, messageRef) {
  for (const row of await lines(project)) {
    for (const snapshot of await sessionQueries(project, row.key)) {
      if (!String(snapshot.ref.queryJobId).startsWith('intervention-planning-')) continue;
      const job = ready(await project.host.client.read('queries/read', project.scope,
        { aggregateType: 'QueryJob', projectId: snapshot.ref.projectId, workspaceId: snapshot.ref.workspaceId, queryJobId: snapshot.ref.queryJobId }));
      if (sameRef(job?.job?.job?.intent?.execution?.sourceMessageRef ?? null, messageRef)) return { job, line: row.key.sessionId };
    }
  }
  return null;
}

/**
 * The line's current Task as the product reads it (quick check #9): `sessions/facts.latestWork.task`
 * (`intervention.ts:114`), and that Task's disposition and effectivePhase now; unfinished = active and not
 * satisfied (`:189-191`). `readable: false` when either read gives no answer: the branch cannot be told.
 * A direct intervention is the person's `entry: 'person_intervention'` message (flows `interveneLine`); only that
 * entry claims the line's Task or opens the planning round (`mailbox-send.ts:575-576`).
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

/** A line is busy when one of its Work Runs has not ended or one of its Queries is pending or running. */
async function lineBusy(project, runs, sessionRef) {
  if (runs.some(item => claimSession(item) === sessionRef.sessionId && item.run.status !== 'ended')) return true;
  return (await sessionQueries(project, sessionRef)).some(snapshot => ['running', 'pending'].includes(snapshot.run?.status));
}

/**
 * P6 Q7 (claim once): once the message to an idle line with an unfinished Task was accepted or settled, the Runs of
 * that Task on that line opened since the send and the planning Query of the message; null while it is still waiting.
 */
async function claimSnapshot(project, goalRef, claim) {
  const view = await messageView(project, claim.messageRef);
  const kind = view?.disposition?.kind ?? null;
  if (view === null || ((view.delivery?.deliveredTo ?? null) === null && !['answered', 'withdrawn', 'undelivered'].includes(kind))) return null;
  const runs = (await executions(project, goalRef)).filter(item => item.run.task.taskId === claim.taskId
    && claimSession(item) === claim.line && !claim.before.has(item.run.ref.runId));
  return { view, runs, planning: await planningOf(project, claim.messageRef), at: new Date().toISOString() };
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
  const doneEnd = await waitGoal(ctx, project, done.goalRef, {
    timeoutMs: 60 * MINUTE, rec, adoptCandidates: true, check: null,
  });
  if (doneEnd.display.phase !== 'COMPLETED') throw broken(ctx, `the first Goal ended ${doneEnd.display.phase}`, null);
  // The lines that worked on the completed Goal: the claim Sessions of its Runs (the one to message is picked when it is sent).
  const doneWorkers = new Set((await executions(project, done.goalRef)).map(claimSession).filter(Boolean));

  // The project is initialized now: the second Goal takes the product's request path on one request (G6F F3), and
  // the person starts it (`plans/apply` does not start the Goal driver; the cold start's adoption did).
  const longSubmitted = await submitRequest(project, LONG_REQUEST);
  if (longSubmitted?.status !== 'queued') throw broken(ctx, `requests/submit: ${longSubmitted?.code} ${longSubmitted?.reason}`);
  const busy = await newGoalInProject(ctx, project, longSubmitted.requestRoot, rec);
  const busyStart = await driverStart(ctx, project, busy.goalRef, { flowId: newId('int-long') });
  rec.note(`driver-start ${busy.goalRef.goalId}: ${busyStart?.status} ${busyStart?.value?.state ?? busyStart?.code ?? ''}`);
  const running = await waitFor(ctx, 'a running Run on the long Goal', async () =>
    (await executions(project, busy.goalRef)).find(item => item.run.status === 'running') ?? null, value => value !== null, { timeoutMs: 40 * MINUTE });
  const line = (await lines(project)).find(row => row.key.sessionId === running.outbox?.claim?.sessionRef?.sessionId);
  if (line === undefined) throw broken(ctx, 'lines/list shows no row for the working Session');
  /** The person's direct interventions on the long Goal (text and message), for the review-packet scan. */
  const interventions = [];

  // Two idle branches while the long Goal is active, each sent once (lead ruling 11-14 #15; second review #9/#10;
  // P6 Q7): the first time a line that worked on it holds no unfinished Task, the person sends that line one
  // intervention (planning-when-idle); the first time such a line is idle and its current Task is unfinished, one more
  // (claim-once). Only what started from exactly that message judges a branch. A refused send is the platform's
  // answer: `fail` with its own words.
  // P6 diagnosis 2 #21 (11-25): the long Goal's idle gaps (95 s, 39 s) all came before the pause, while this watcher
  // only started after it, when the Goal had already completed. It now runs beside the scenario from the long Goal's
  // start (every 10 s, until both branches fired, the Goal ended or this unit ended) and in the long wait's poll; one
  // pass at a time. 核对 11-18（d-check 3.1）：目标还没到终态时这条消息已经回复或撤回，就在这里记下 endedWhileOpen。
  let idle = null;
  let claim = null;
  let watchBusy = false;
  let watchStop = false;
  const idleWatch = async phase => {
    if (watchBusy) return;
    watchBusy = true;
    try {
      if (idle !== null && idle.messageRef !== null && idle.endedWhileOpen !== true && phase !== undefined && !TERMINAL.includes(phase)) {
        const message = ready(await host.client.read('messages/read', project.scope, idle.messageRef));
        if (message?.status === 'responded' || (message?.withdrawnAt ?? null) !== null) idle.endedWhileOpen = true;
      }
      // Claim once: the facts are taken the first time the message was accepted or settled (never by blocking here).
      if (claim !== null && claim.messageRef !== null && claim.snap === null) claim.snap = await claimSnapshot(project, busy.goalRef, claim);
      if ((idle !== null && claim !== null) || phase === undefined || TERMINAL.includes(phase) || phase === 'PAUSED') return;
      const runs = await executions(project, busy.goalRef);
      const workers = new Set(runs.map(claimSession).filter(Boolean));
      for (const row of (await lines(project)).filter(entry => workers.has(entry.key.sessionId))) {
        const now = await currentWork(project, row.key);
        if (!now.readable || now.task === null || now.task.goalId !== busy.goalRef.goalId) continue;
        if (!now.unfinished && idle === null) {
          const idleSent = await interveneLine(project, row.key, IDLE_TEXT);
          idle = { messageRef: idleSent.value?.ref ?? null, line: row.key.sessionId, phase, work: now.text, at: new Date().toISOString(),
            refused: idleSent.ok ? null : idleSent.said };
          rec.link('message', idle.messageRef);
          if (idle.messageRef !== null) interventions.push({ text: IDLE_TEXT, ref: idle.messageRef });
          return;
        }
        if (now.unfinished && claim === null && !await lineBusy(project, runs, row.key)) {
          const before = new Set(runs.filter(item => item.run.task.taskId === now.task.taskId && claimSession(item) === row.key.sessionId)
            .map(item => item.run.ref.runId));
          const claimSent = await interveneLine(project, row.key, CLAIM_TEXT);
          claim = { messageRef: claimSent.value?.ref ?? null, line: row.key.sessionId, taskId: now.task.taskId, work: now.text,
            at: new Date().toISOString(), before, snap: null, refused: claimSent.ok ? null : claimSent.said };
          rec.link('message', claim.messageRef);
          if (claim.messageRef !== null) interventions.push({ text: CLAIM_TEXT, ref: claim.messageRef });
          return;
        }
      }
    } finally { watchBusy = false; }
  };
  (async () => {
    while (!watchStop && ctx.report.current === rec && (idle === null || claim === null)) {
      const phase = ready(await host.client.read('goals/display', project.scope, { goalRef: busy.goalRef }))?.display?.phase;
      if (phase !== undefined && TERMINAL.includes(phase)) return;
      await idleWatch(phase);
      await sleep(10_000);
    }
  })().catch(error => rec.note(`idle watcher stopped: ${error.message}`));

  // "Ask": a read-only copy answers; the working line is not disturbed (lead ruling 11-14 #14). P6 #19: the copy
  // question IS in the line's inbox (`line-ask.ts:69-72` sends it to the line with `answeredBy: 'copy'`, `wake:
  // false`), and inbox items carry no body, so "not in the inbox" proves nothing. It does not occupy the line when the
  // question is a copy question, was not accepted by a Run, and no turn of the original Run received its text.
  const asked = await host.client.read('queries/ask', project.scope, { sessionRef: line.key, question: ASK, commandId: newId('ask') });
  const askRound = asked?.round;
  if (askRound === undefined) throw broken(ctx, `queries/ask: ${asked?.status} ${asked?.code ?? ''} ${asked?.reason ?? ''}`, 'ask-copy');
  const askJob = await waitFor(ctx, 'the ask answer', async () =>
    ready(await host.client.read('queries/read', project.scope, askRound)), value => value?.run?.run?.status === 'answered' || value?.run?.run?.status === 'closed',
  { timeoutMs: 20 * MINUTE, check: 'ask-copy' });
  const original = (await executions(project, busy.goalRef)).find(item => item.run.ref.runId === running.run.ref.runId);
  const undisturbed = original?.run.status === 'running' || (original?.run.status === 'ended' && original.run.outcome === 'completed');
  // `query-job.ts:341-343`: the copy Query's own question message.
  const askRef = askJob.job?.job?.intent?.execution?.consultation?.messageRef ?? null;
  const askView = askRef === null ? null : await messageView(project, askRef);
  const askedIn = turnsOf(await runHistory(project, running.run.ref)).filter(turn => turn.input.includes(ASK)).map(turn => turn.turnId);
  const askFacts = `问一问 ${asked?.status} → ${askJob.run.run.status}；原线 Run ${original?.run.status}/${original?.run.outcome ?? '-'}，输入含这个问题的轮 ${askedIn.join(', ') || '无'}`;
  if (askView === null) {
    rec.uncover('ask-copy', 'env-unavailable', `${askFacts}；读不到问件（consultation.messageRef ${askRef?.messageId ?? '无'}），认不出它有没有占原线`);
  } else {
    const into = askView.delivery?.deliveredTo?.executionRef ?? null;
    const occupied = askView.message.answeredBy !== 'copy' || into?.aggregateType === 'Run' || askedIn.length > 0;
    rec.check('ask-copy', askJob.run.run.status === 'answered' && undisturbed && !occupied,
      `${askFacts}；问件 ${askRef.messageId} answeredBy ${askView.message.answeredBy}，送进 ${describe(into)}`);
  }

  // A direct intervention while the task is working (P6 #3, #20): delivered at a safe point into the Run that was
  // working when it was sent, and no intervention_planning Query for this message (found by the Query's own
  // sourceMessageRef). The branch condition is read before the send, as the product reads it when the message arrives.
  const workAtSend = await currentWork(project, line.key);
  const busyRun = (await executions(project, busy.goalRef)).find(item => claimSession(item) === line.key.sessionId && item.run.status !== 'ended') ?? null;
  const sent = await interveneLine(project, line.key, INTERVENE);
  rec.facts.userCommand.push(INTERVENE);
  if (!sent.ok) throw broken(ctx, `to the working line: ${sent.said}`, 'delivery-states');
  const messageRef = sent.value.ref;
  rec.link('message', messageRef, sent.value.revision ?? null);
  interventions.push({ text: INTERVENE, ref: messageRef });
  const states = [];
  // P6 #20: a Run that finishes before its next safe point leaves the message to the no-task branch (answered or
  // withdrawn, never delivered, `execution-inputs.ts:315-316`): every settled disposition ends the wait.
  const view = await waitFor(ctx, 'the intervention to be delivered or settled', async () => {
    const value = await messageView(project, messageRef);
    const kind = value?.disposition?.kind ?? null;
    if (kind !== null && states.at(-1) !== kind) states.push(kind);
    return value;
  }, value => SETTLED.includes(value?.disposition?.kind), { timeoutMs: 30 * MINUTE, check: 'delivery-states' });
  const into = view.delivery?.deliveredTo?.executionRef ?? null;
  const toBusy = into?.aggregateType === 'Run' && busyRun !== null && into.runId === busyRun.run.ref.runId;
  const stateText = `disposition 依次：${states.join(' → ') || '无'}（发送回执 ${sent.sendStatus}）；发信时在跑的 Run ${busyRun?.run.ref.runId ?? '无'}；送进 ${describe(into)}`;
  if (view.disposition.kind === 'undelivered') rec.fail('delivery-states', `${stateText}；未送达：${view.disposition.reason}`);
  else if (toBusy) rec.check('delivery-states', states.includes('delivered'), stateText);
  else {
    rec.uncover('delivery-states', 'not-run', `${stateText}：不是忙线那一支（发信时在跑的 Run 在下一个安全点之前就结束了，消息${
      view.disposition.kind === 'delivered' ? '送进了另一个执行' : `走了无任务那一支，收尾为 ${view.disposition.kind}`}）`);
  }
  // P6 observation "忙线收到原话": the Run that was working at the send received the person's words in one of its turns.
  if (!toBusy) rec.uncover('busy-original-words', 'not-run', `${stateText}：消息没有送进发信时在跑的 Run`);
  else {
    const heard = turnsOf(await runHistory(project, busyRun.run.ref)).filter(turn => turn.input.includes(INTERVENE)).map(turn => turn.turnId);
    rec.check('busy-original-words', heard.length > 0, `送进发信时在跑的 Run ${busyRun.run.ref.runId}（接受于 ${
      view.delivery.deliveredTo.acceptedAt}）；这个 Run 输入含原话的轮：${heard.join(', ') || '无'}`);
  }
  // Pause: an intervention only queues; resume delivers it (P6 #4). P2: a paused Goal takes every message in.
  // lead 11-25 (P6 run: the pause went out 5 s after the long Goal completed and was rightly refused `invalid`, GOAL-04):
  // the pause goes out right after the busy branch is judged, while the Goal still works; a Goal already finished or a
  // pause the platform does not commit leaves this branch not reached — no "while paused" message, no resume, no wait.
  const phaseAtPause = ready(await host.client.read('goals/display', project.scope, { goalRef: busy.goalRef }))?.display?.phase ?? null;
  const paused = phaseAtPause === null || TERMINAL.includes(phaseAtPause) || phaseAtPause === 'PAUSED' ? null
    : await control(ctx, project, busy.goalRef, 'pause');
  if (paused?.status !== 'committed') {
    rec.uncover('paused-queues', 'not-run', paused === null
      ? `暂停前长目标已是 ${phaseAtPause ?? '读不到'}，没有可暂停的工作，这一支没走到`
      : `暂停没有提交（目标当时 ${phaseAtPause}）：${paused?.status ?? 'no answer'} ${paused?.code ?? ''} ${paused?.reason ?? ''}；不发暂停中的消息、不恢复`);
  } else {
    const queued = await interveneLine(project, line.key, PAUSED_TEXT);
    rec.facts.userCommand.push(PAUSED_TEXT);
    if (!queued.ok) throw broken(ctx, `while paused: ${queued.said}`, 'paused-queues');
    interventions.push({ text: PAUSED_TEXT, ref: queued.value.ref });
    await sleep(60_000);
    const whilePaused = (await messageView(project, queued.value.ref))?.disposition?.kind ?? null;
    const resumed = await control(ctx, project, busy.goalRef, 'resume');
    const afterResume = await orNull(waitFor(ctx, 'delivery after resume', async () => (await messageView(project, queued.value.ref))?.disposition?.kind ?? null,
      kind => SETTLED.includes(kind), { timeoutMs: 30 * MINUTE, check: 'paused-queues' }));
    const pausedOk = whilePaused !== null && whilePaused !== 'delivered';
    const pausedText = `暂停 ${paused.status}（目标当时 ${phaseAtPause}）：暂停中 ${whilePaused}；恢复 ${resumed?.status} ${resumed?.code ?? ''} 后 ${afterResume ?? '30 分钟里没有收尾'}`;
    if (pausedOk && (afterResume === 'answered' || afterResume === 'withdrawn')) {
      rec.uncover('paused-queues', 'not-run', `${pausedText}：恢复时这条线已没有在跑的工作，消息走了无任务那一支，不是“恢复后送达”`);
    } else rec.check('paused-queues', pausedOk && afterResume === 'delivered', pausedText);
  }

  // Second review #9: this check is about the "a Task to continue" branch only; it is judged only when the line held
  // an unfinished Task when the message was sent (read after the pause branch, which gave any planning time to show).
  if (!workAtSend.readable) rec.uncover('continue-no-planning', 'entry-missing', `发送前读不到这条线当前对应的任务（${workAtSend.text}），分支无从确定`);
  else if (!workAtSend.unfinished) rec.uncover('continue-no-planning', 'not-run', `发送时这条线当前的任务不是未完成（${workAtSend.text}），不是“有任务接着做”的分支`);
  else {
    if (paused?.status !== 'committed') await sleep(30_000);
    const planningForSent = await planningOf(project, messageRef);
    rec.check('continue-no-planning', planningForSent === null,
      `发送时线上当前任务 ${workAtSend.text}；这条消息的 intervention_planning Query：${planningForSent === null ? '没有' : `${planningForSent.job?.job?.job?.status ?? '-'}（线 ${planningForSent.line}）`}`);
  }

  // Two idle branches while the long Goal is active, each sent once (lead ruling 11-14 #15; second review #9/#10;
  // P6 Q7): the first time a line that worked on it holds no unfinished Task, the person sends that line one
  // intervention (planning-when-idle); the first time such a line is idle and its current Task is unfinished, one more
  // (claim-once). Only what started from exactly that message judges a branch. A refused send is the platform's
  // answer: `fail` with its own words.
  const busyEnd = await waitGoal(ctx, project, busy.goalRef, { timeoutMs: 150 * MINUTE, rec, returnOnDecide: true,
    onPoll: display => idleWatch(display?.display?.phase) });
  watchStop = true;
  if (busyEnd.stoppedFor !== null) rec.note(`长目标停下等人：${busyEnd.stoppedFor}`);
  if (idle === null) rec.uncover('planning-when-idle', 'not-run', '长目标活跃期间没有出现“干过活的线上没有未完成任务”的时刻，没走到这个分支');
  else if (idle.refused !== null) rec.fail('planning-when-idle', `${idle.at} 发给闲线 ${idle.line} 的消息被拒：${idle.refused}`);
  else {
    // lead 11-18：C-200 要的是“答案交 plans/propose”。Query 答完以后，候选、问题卡、回复由 Host 下一趟消费写出
    // （intervention.ts:558-643），判法等这条消息有了收尾：候选卡、问题卡、消息被回复或被撤回，四样出现一样就算。
    // 候选按 requestRef 认（干预候选的 requestRef 就是这个 Query，intervention.ts:635；叠树 decision-read-model.ts:2264-2285）；
    // “方案确认后自动”下候选可能已被采用，所以连已关的一起读。P6：规划 Query 要开在原线上（`planningOf` 带线）。
    const endingOf = async () => {
      const found = await planningOf(project, idle.messageRef);
      const job = found?.job ?? null;
      if (job === null || !['answered', 'closed'].includes(job.run?.run?.status)) return null;
      const qid = job.job.job.queryJobId;
      const queue = ready(await host.client.read('decisions/queue', project.scope, { workspace: project.scope,
        goalRef: busy.goalRef, sections: ['waiting_answer', 'history'], page: { limit: 100 } }));
      const cards = [...(queue?.waitingAnswer ?? []), ...(queue?.history ?? [])];
      const candidate = cards.find(card => card.source.kind === 'candidate' && card.requestRef?.queryJobId === qid);
      const asked = cards.some(card => card.source.kind === 'planning_question' && String(card.source.key).includes(qid));
      const message = ready(await host.client.read('messages/read', project.scope, idle.messageRef));   // 写法同 e09.mjs:88
      const replied = message?.status === 'responded' || (message?.withdrawnAt ?? null) !== null;
      return { job, line: found.line, queue, candidate, asked, settled: job.run.run.status !== 'answered' || candidate !== undefined || asked || replied };
    };
    const seen = await orNull(waitFor(ctx, 'the ending of the idle-line message', endingOf,
      value => value?.settled === true, { timeoutMs: 20 * MINUTE, check: 'planning-when-idle' }));
    const phaseNow = (ready(await host.client.read('goals/display', project.scope, { goalRef: busy.goalRef })))?.display?.phase;

    const job = seen?.job ?? null;
    const queryJobId = job?.job?.job?.queryJobId ?? null;
    const facts = `${idle.at} 发给 ${idle.line}（目标 ${idle.phase}，线上当前任务 ${idle.work}）；Query ${queryJobId ?? '-'}（开在 ${seen?.line ?? '-'}）${job?.run?.run?.status ?? '-'}`;
    // 121-146：队列里候选或规划问题来源暂时读不到时，队列不是全貌，不算证据（同叠树 flows.mjs:388）。
    const blind = seen?.queue == null ? [] : unreadableSources(seen.queue)
      .filter(entry => entry.source === 'candidate' || entry.source === 'planning_question');
    // seen 为 null：waitFor 已记 fail（20 分钟里没有收尾）；这一句只把事实补进 notes（Record.set：fail 不会被改掉）。
    if (seen === null) rec.fail('planning-when-idle', `${facts}；20 分钟里这条消息没有收尾`);
    else if (job.run.run.status !== 'answered') rec.fail('planning-when-idle', `${facts}，没有答完`);
    else if (seen.queue === null) rec.uncover('planning-when-idle', 'env-unavailable', `${facts}；decisions/queue 读不到，认不出有没有候选`);
    else if (blind.length > 0) rec.uncover('planning-when-idle', 'env-unavailable',
      `${facts}；决定队列暂时读不到 ${blind.map(entry => `${entry.source}（${entry.reason ?? ''}）`).join('、')}，认不出有没有候选`);
    else if (seen.candidate !== undefined) {
      rec.check('planning-when-idle', seen.line === idle.line, `${facts}；候选 ${seen.candidate.cardKey}（${seen.candidate.state}）；规划 Query ${
        seen.line === idle.line ? '开在原线' : `没开在原线 ${idle.line}`}`);
    } else if (seen.asked) rec.uncover('planning-when-idle', 'not-run', `${facts}；模型反问（规划问题卡），没走到交 plans/propose`);
    // 目标还活着时这条消息已经收尾（上面 onPoll 记的 endedWhileOpen）：没有候选就是非法收尾，不因为现在目标已结束改记 not-run。
    else if (TERMINAL.includes(phaseNow) && idle.endedWhileOpen !== true) rec.uncover('planning-when-idle', 'not-run', `${facts}；规划收尾前长目标已结束（${phaseNow}），平台不写候选`);
    else rec.fail('planning-when-idle', `${facts}；非法收尾，没有候选`);
    idle.ending = seen?.candidate !== undefined ? 'candidate' : seen?.asked ? 'questions' : job?.run?.run?.status ?? null;
  }
  // P6 Q7, claim once: accepted by a Run that this message opened (`consumedWait.kind === 'intervention'` naming it,
  // `dispatch.ts:330`), the only new Run of that Task on that line, and no planning Query for it (`intervention.ts:256-276`).
  if (claim === null) rec.uncover('claim-once', 'not-run', '长目标活跃期间没有出现“干过活的线空闲、它当前的任务没完成”的时刻，没走到这个分支');
  else if (claim.refused !== null) rec.fail('claim-once', `${claim.at} 发给空闲线 ${claim.line}（任务 ${claim.work}）的消息被拒：${claim.refused}`);
  else {
    if (claim.snap === null) claim.snap = await claimSnapshot(project, busy.goalRef, claim);
    const snap = claim.snap;
    const base = `${claim.at} 发给空闲线 ${claim.line}（当前任务 ${claim.work}）`;
    if (snap === null) rec.fail('claim-once', `${base}；长目标结束后这条消息既没送进执行，也没有收尾`);
    else {
      const to = snap.view.delivery?.deliveredTo?.executionRef ?? null;
      const opened = snap.runs.filter(item => item.run.consumedWait?.kind === 'intervention'
        && item.run.consumedWait.messageRef?.messageId === claim.messageRef.messageId);
      const text = `${base}；${snap.at} 读到 ${snap.view.disposition?.kind}，送进 ${describe(to)}；之后这条线上这个任务新开的 Run ${
        snap.runs.map(item => item.run.ref.runId).join(', ') || '无'}（因这条消息开的 ${opened.length} 个）；这条消息的规划 Query ${
        snap.planning === null ? '没有' : snap.planning.job?.job?.job?.queryJobId}`;
      if (opened.length === 0 && snap.planning === null && to?.aggregateType === 'Run') {
        rec.uncover('claim-once', 'not-run', `${text}：目标循环先领了这个任务，消息在安全点送进它的 Run，不是“空闲线领一次”这一支`);
      } else {
        rec.check('claim-once', opened.length === 1 && snap.runs.length === 1 && to?.aggregateType === 'Run'
          && to.runId === opened[0].run.ref.runId && snap.planning === null, text);
      }
    }
  }
  // "Asks back" and "illegal answer" cannot be caused through a public entry, so the row stays uncovered; the ending
  // that was seen is listed.
  rec.uncover('four-endings', 'entry-missing', `“反问”“非法”两种收尾没有公开入口能造出；这次看到的结局：${idle?.ending ?? '无'}`);
  rec.note(`长目标结束 ${busyEnd.display.phase}`);

  // P6 observation "原话进入审阅包": a reviewer line's `execreview:` packet of this Goal quotes the person's words
  // verbatim (`exec-review-packet.ts:95`, `:106-111`); only interventions a Run accepted are quoted, and a packet exists
  // only when the check plan has a review item (`workflow.ts:434`, `:443`). Scanned once, after the long Goal.
  const accepted = [];
  for (const entry of interventions) {
    const to = (await messageView(project, entry.ref))?.delivery?.deliveredTo ?? null;
    if (to?.executionRef?.aggregateType === 'Run') accepted.push({ ...entry, acceptedAt: to.acceptedAt, runRef: to.executionRef });
  }
  const reviewers = (await lines(project)).filter(row => row.duty === 'reviewer');
  const packets = [];
  for (const row of reviewers) {
    const items = ready(await host.client.read('messages/inbox', project.scope, { recipient: row.key, page: { limit: 100 } }))?.items ?? [];
    for (const item of items) {
      const body = await messageBody(project, item.ref);
      if (body?.startsWith('execreview:') && body.includes(busy.goalRef.goalId)) packets.push({ line: row.key.sessionId, item, body });
    }
  }
  // lead 11-25 (P6 ruling on review-packet): only the packet of the Task whose Run consumed this intervention counts.
  // A packet names its Task and subject Run in its header (`taskRef: …`, `subjectRunRef: …`,
  // `exec-review-packet.ts:94-101`); the packet for that Task judging that Run must quote the words, other packets are
  // not read; no such packet (or the consuming Run's Task cannot be told) → uncovered.
  const headerOf = (body, key) => {
    const line = body.split('\n').find(entry => entry.startsWith(`${key}: `));
    try { return line === undefined ? null : JSON.parse(line.slice(key.length + 2)); } catch { return null; }
  };
  const longRuns = await executions(project, busy.goalRef);
  const judged = accepted.map(entry => {
    const runId = entry.runRef?.runId ?? null;
    const taskId = longRuns.find(item => item.run.ref.runId === runId)?.run.task.taskId ?? null;
    const own = taskId === null ? [] : packets.filter(packet => headerOf(packet.body, 'taskRef')?.taskId === taskId
      && headerOf(packet.body, 'subjectRunRef')?.runId === runId);
    const head = `${entry.ref.messageId}（Run ${runId ?? '-'}，任务 ${taskId ?? '认不出'}）`;
    if (own.length === 0) return { verdict: 'uncovered', text: `${head}：没有对上这个任务和 Run 的审阅包` };
    const missing = own.filter(packet => !packet.body.includes(entry.text));
    return { verdict: missing.length === 0 ? 'pass' : 'fail',
      text: `${head}：审阅包 ${own.map(packet => packet.item.ref.messageId).join(', ')}；不带原话的 ${missing.map(packet => packet.item.ref.messageId).join(', ') || '无'}` };
  });
  const packetFacts = `被 Run 接受的直接干预 ${accepted.length} 条；审阅线 ${reviewers.map(row => row.key.sessionId).join(', ') || '无'}；这个目标的 execreview 包 ${
    packets.length} 个；逐条：${judged.map(entry => entry.text).join('；') || '无'}`;
  if (accepted.length === 0) rec.uncover('review-packet', 'not-run', `${packetFacts}：没有被 Run 接受的直接干预，审阅包不收没进 Run 的原话`);
  else if (judged.some(entry => entry.verdict === 'fail')) rec.fail('review-packet', packetFacts);
  else if (judged.some(entry => entry.verdict === 'pass')) rec.pass('review-packet', packetFacts);
  else rec.uncover('review-packet', 'not-run', `${packetFacts}（检查计划里没有审阅项时不出包）`);

  // A message to the COMPLETED Goal's line: confirmed as a new Goal first; the old completion stays. P6 #5 / 风险:
  // the line must still have the completed Goal as its latest work (a line the long Goal reused addresses that
  // Goal instead, `intervention.ts:195`, and no new-Goal request comes).
  let doneLine = null;
  for (const row of (await lines(project)).filter(entry => doneWorkers.has(entry.key.sessionId))) {
    const facts = ready(await host.client.read('sessions/facts', project.scope, row.key));
    if (facts?.latestWork?.task?.goalId === done.goalRef.goalId) { doneLine = row; break; }
  }
  if (doneLine === null) {
    rec.uncover('completed-goal', 'not-run', `干过已完成目标 ${done.goalRef.goalId} 的线（${[...doneWorkers].join(', ') || '无'}）现在的 latestWork 都不是它（被别的目标复用），发给它们的消息不会成为新目标请求`);
    return;
  }
  const main = ready(await host.client.read('main/read', project.scope, { goalId: null, cursor: null }));
  const known = new Set((main?.requests ?? []).map(entry => JSON.stringify(entry.requestRoot)));
  const toDone = await interveneLine(project, doneLine.key, DONE_TEXT);
  rec.facts.userCommand.push(DONE_TEXT);
  if (!toDone.ok) throw broken(ctx, `to the completed Goal's line ${doneLine.key.sessionId}: ${toDone.said}`, 'completed-goal');
  rec.link('message', toDone.value.ref, toDone.value.revision ?? null);
  const request = await waitFor(ctx, 'the new-Goal request', async () =>
    (ready(await host.client.read('main/read', project.scope, { goalId: null, cursor: null }))?.requests ?? [])
      .find(entry => !known.has(JSON.stringify(entry.requestRoot))) ?? null, value => value !== null, { timeoutMs: 20 * MINUTE, check: 'completed-goal' });
  // The same card step as every new Goal in an initialized project (G6F F3/F4): a round without a card gets a follow-up.
  const confirmed = await confirmNewGoal(ctx, project, request.requestRoot, rec, 'completed-goal');
  const oldAfter = ready(await host.client.read('goals/display', project.scope, { goalRef: done.goalRef }));
  rec.check('completed-goal', confirmed.goalRef.goalId !== done.goalRef.goalId && oldAfter?.display?.phase === 'COMPLETED',
    `发给 ${doneLine.key.sessionId}；新 Goal ${confirmed.goalRef.goalId}；原 Goal 仍 ${oldAfter?.display?.phase}`);
}

export default { ...def, run };
