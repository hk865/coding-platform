// Direct intervention (draft §1.7; MVP-BEHAVIOR.md:333-343; slice-9-SPEC.md:666, :692): "ask" is a read-only copy
// (`queries/ask`); a direct intervention is the UI's `messages/send` to the line with `entry: 'person_intervention'`
// (`boot.ts:1583-1597`, flows `interveneLine`; P2 removed `intent`); with a task to continue there is no
// `intervention_planning`, without one there is; a message to a COMPLETED Goal's line is confirmed as a new Goal
// first; pause only queues.
import { BudgetStop } from '../lib/budget.mjs';
import { newId, ready } from '../lib/http.mjs';
import { broken, chooseModel, coldStart, confirmNewGoal, driverStart, executions, interveneLine, lines, longGoalStop, messageBody, messageView,
  newGoalInProject, openProject, orNull, pageGoalRef, runHistory, sessionQueries, sleep, submitRequest, TERMINAL, turnsOf, unreadableSources,
  WaitTimeout, waitFor, waitGoal } from '../lib/flows.mjs';

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
/** P6L3 B11: one Task is its project, Goal and task id; a missing field is not a pass. */
const sameTask = (left, right) => left !== null && left !== undefined && right !== null && right !== undefined
  && left.projectId === right.projectId && left.goalId === right.goalId && left.taskId === right.taskId;
const claimSession = item => item.outbox?.claim?.sessionRef?.sessionId ?? null;
/** Where a message was accepted (`deliveredTo.executionRef`, `session-message.ts:128-133`): a Run or a QueryRun. */
const describe = into => (into === null || into === undefined ? '无' : `${into.aggregateType} ${into.runId ?? into.queryJobId ?? JSON.stringify(into)}`);

/**
 * P6J item 6 (intervention): one moment of the paused intervention — the same message, receiving line and Run. The
 * fields are the diagnosis's attribution set: `deliveredTo`, `acceptedInputs`, whether the line can consume (its
 * SessionCard's availability and occupancy), the Run's last event, and each control intent the Run points at with its
 * own state. A missing message ref is the moment before it was sent.
 */
export async function messagePoint(project, ref, lineKey, runRef, goalRef = null, known = [], shared = null) {
  const gaps = [];
  const read = async (what, call) => {
    const body = await call();
    const value = ready(body);
    if (value === null && body?.status !== 'not_found') gaps.push(`${what}: ${body?.status ?? 'no answer'} ${body?.code ?? ''}`.trim());
    return value;
  };
  const view = ref === null ? null : shared === null
    ? await read(`messages/view ${ref.messageId}`, () => project.host.client.read('messages/view', project.scope, ref))
    : shared.view;
  const session = await read(`sessions/read ${lineKey.sessionId}`, () => project.host.client.read('sessions/read', project.scope, lineKey));
  const execution = runRef === null ? null : await read(`executions/read ${runRef.runId}`, () => project.host.client.read('executions/read', project.scope, runRef));
  // P6J item 6: a moment names what the line can consume, what occupies it, its archive request and pending controls,
  // not only the message pointer. These reads are extra evidence, so a failure is a named gap, never a clean blank.
  const line = goalRef === null ? null : await read('lines/list', () => project.host.client.read('lines/list', project.scope,
    { workspace: project.scope }));
  const row = line?.rows?.find(entry => entry.key.sessionId === lineKey.sessionId) ?? null;
  const runGaps = [];
  const runs = goalRef === null ? [] : shared === null ? await executions(project, goalRef, runGaps) : shared.runs ?? [];
  if (shared === null) gaps.push(...runGaps);
  const tasks = goalRef === null ? null : await read(`tasks/query ${goalRef.goalId}`,
    () => project.host.client.read('tasks/query', project.scope, { goalRef }));
  const running = runs.filter(item => item.run.status !== 'ended' && claimSession(item) === lineKey.sessionId);
  const executionCard = runRef === null ? null
    : (tasks?.tasks ?? []).find(task => task.execution?.runId === runRef.runId)?.execution ?? null;
  const archive = session?.record?.archiveRequest ?? null;
  const archiveMarker = (row?.status?.markers ?? []).find(marker => marker.kind === 'archiving') ?? null;
  // P6J4 (quick check row 7): every control intent of the Run, read for its own state (`controls/read`,
  // `control-intent.ts:102-109`: queued, or applied/superseded/outcome_unknown with the observation). P6J4b: a pause,
  // resume or cancel moves the Run's pointer `controlState.intentRef`; only a steer is appended to `controlInputs`
  // (`control-intent-machine.ts:181-190`). So the intents read are the pointer, the inputs and every pointer an earlier
  // moment saw (`known`: the pause the resume has since replaced), each once.
  const intents = [];
  for (const intentRef of [...runIntentRefs(execution?.run), ...known]) {
    if (!intents.some(entry => entry.intentId === intentRef.intentId)) intents.push(intentRef);
  }
  const controlIntents = [];
  for (const intentRef of intents) {
    const intent = await read(`controls/read ${intentRef.intentId}`, () => project.host.client.read('controls/read', project.scope, intentRef));
    controlIntents.push(intent === null ? { ref: intentRef, status: null, unreadable: true }
      : { ref: intentRef, kind: intent.kind, status: intent.status, requestedAt: intent.requestedAt ?? null,
        observation: intent.observation === undefined ? null : { kind: intent.observation.kind ?? null, observedAt: intent.observation.observedAt ?? null } });
  }
  return {
    at: new Date().toISOString(),
    messageRef: ref,
    lineKey,
    runRef,
    gaps,
    // P6J4: the line's own SessionCard (`session-contracts.ts:150-157`): whether it can take work now, what holds it.
    sessionCard: session === null ? null : { availability: session.availability ?? null, occupancy: session.record?.occupancy ?? null,
      links: session.links ?? [], lifecycle: session.record?.lifecycle ?? null, health: session.record?.health ?? null },
    controlIntents,
    tasks: tasks?.tasks ?? null,
    deliveredTo: view?.delivery?.deliveredTo ?? null,
    acceptedInputs: view?.message?.acceptedInputs ?? [],
    disposition: view?.disposition ?? null,
    consumableLine: { archived: session?.record?.lifecycle === 'archived', health: session?.record?.health ?? null },
    availability: line === null && session === null ? null : {
      own: row?.status?.own ?? null, attention: row?.status?.attention ?? null,
      archived: session?.record?.lifecycle === 'archived', health: session?.record?.health ?? null },
    occupancy: running.length === 0 && executionCard === null && execution === null ? null : {
      running: running.map(item => ({ runId: item.run.ref.runId, taskId: item.run.task?.taskId ?? null,
        status: item.run.status, startedAt: item.run.startedAt ?? null })),
      executionCard,
      execution: execution?.run === undefined ? null : { runId: runRef?.runId ?? null, status: execution.run.status,
        revision: execution.run.revision ?? null, controlState: execution.run.controlState ?? null } },
    archiveRequest: archive === null && archiveMarker === null ? null : { record: archive, marker: archiveMarker },
    runLastEvent: execution === null ? null : { status: execution.run?.status ?? null, outcome: execution.run?.outcome ?? null,
      endedAt: execution.run?.endedAt ?? null, exitCode: execution.run?.exitCode ?? null,
      lastEventSeq: execution.run?.lastEventSeq ?? null, lastRuntimeEventId: execution.run?.lastRuntimeEventId ?? null },
    pendingControls: execution === null && row === null ? null : { controlState: execution?.run?.controlState ?? null,
      controlInputs: execution?.run?.controlInputs ?? [], controls: row?.controls ?? [] },
  };
}

/**
 * The `intervention_planning` Query that started from exactly this message (second review #17): a line Query's job
 * whose `execution.sourceMessageRef` is the message (`query-job.ts:362`), with the line it runs on (P6: the candidate
 * must come from the original line); null when there is none.
 */
export async function planningOf(project, messageRef, gaps = null) {
  const lineGaps = [];
  for (const row of await lines(project, lineGaps)) {
    for (const snapshot of await sessionQueries(project, row.key, lineGaps)) {
      if (!String(snapshot.ref.queryJobId).startsWith('intervention-planning-')) continue;
      const body = await project.host.client.read('queries/read', project.scope,
        { aggregateType: 'QueryJob', projectId: snapshot.ref.projectId, workspaceId: snapshot.ref.workspaceId, queryJobId: snapshot.ref.queryJobId });
      const job = ready(body);
      if (job === null) { gaps?.push(`queries/read ${snapshot.ref.queryJobId}: ${body?.status ?? 'no answer'} ${body?.code ?? ''}`); continue; }
      if (sameRef(job?.job?.job?.intent?.execution?.sourceMessageRef ?? null, messageRef)) return { job, line: row.key.sessionId };
    }
  }
  if (lineGaps.length > 0) gaps?.push(...lineGaps);
  return null;
}

/**
 * P6K item 7: one evidence point for a sent letter, taken the first moment the driver sees its claim, delivery or
 * round opening. The platform's own handling Goal is the Goal the letter names (`message.goalRef`, else its
 * `taskRef`; `intervention.ts:196-226`); with none, the Run or Query the letter opened, then the send-time snapshot.
 * A Goal that cannot be resolved is a gap, never guessed. The one `executions` read (`runs`, `runsUnavailable`) is
 * the point's and the snapshot's shared runs. Evidence only.
 */
const goalOfTask = (task, projectId = null) => (task === null || task === undefined || typeof task.goalId !== 'string' ? null
  : { aggregateType: 'Goal', projectId: task.projectId ?? projectId, goalId: task.goalId });

async function readLetterView(project, ref, gaps) {
  const body = await project.host.client.read('messages/view', project.scope, ref);
  const view = ready(body);
  if (view === null) gaps.push(`messages/view ${ref.messageId}: ${body?.status ?? 'no answer'} ${body?.code ?? ''}`.trim());
  return view;
}

async function letterPoint(project, letter, fallbackGoal) {
  const gaps = [];
  const view = letter.messageRef === null ? null : await readLetterView(project, letter.messageRef, gaps);
  const named = view?.message?.goalRef ?? goalOfTask(view?.message?.taskRef);
  const readGoal = named ?? fallbackGoal;
  const runGaps = [];
  const runs = readGoal === null ? [] : await executions(project, readGoal, runGaps);
  gaps.push(...runGaps);
  const runsUnavailable = runGaps.length > 0;
  if (readGoal === null) gaps.push('没有可读 executions 的 Goal，Run 列表没有读');
  const planning = await planningOf(project, letter.messageRef, gaps);
  // Read failures only (not the attribution fallback notes added below), for the close-out's "read gap vs no association".
  const readGaps = [...gaps];
  const delivered = view?.delivery?.deliveredTo?.executionRef ?? null;
  const fromRun = runs.find(item => item.run?.consumedWait?.messageRef?.messageId === letter.messageRef?.messageId
    || (delivered?.aggregateType === 'Run' && item.run?.ref?.runId === delivered.runId)) ?? null;
  let goalRef = named;
  if (goalRef === null && fromRun !== null) goalRef = goalOfTask(fromRun.run?.task, fromRun.run?.ref?.projectId);
  if (goalRef === null) {
    const queryJob = planning?.job?.job?.job ?? null;
    if (typeof queryJob?.goalId === 'string') {
      goalRef = { aggregateType: 'Goal', projectId: queryJob.projectId, goalId: queryJob.goalId };
    }
  }
  if (goalRef === null && fallbackGoal !== null) {
    goalRef = fallbackGoal;
    gaps.push(`消息没有点名 Goal，也读不到对应的 Run 或 Query；保留发信快照 ${fallbackGoal.goalId}`);
  } else if (goalRef === null) {
    gaps.push('消息没有点名 Goal，没有对应的 Run 或 Query，也没有发信快照；不认领任何 Goal');
  }
  const point = await messagePoint(project, letter.messageRef, { projectId: project.scope.projectId, sessionId: letter.line }, null,
    goalRef, [], { view, runs });
  point.gaps.push(...gaps);
  return { point: { ...point, goalRef, planning }, runs, runsUnavailable, readGaps };
}

/** The first association of the same letter: its claim (`consumedWait`), delivery, acceptance or planning round. */
export function associatedWith(letter, point, runs) {
  if (point.deliveredTo !== null || point.acceptedInputs.length > 0 || point.planning !== null) return true;
  // P6L2 A6: only the same letter's own claim locks the point. A new Run of the same Task and line says nothing about
  // which message it took, so an unassociated letter keeps being observed.
  const messageId = letter.messageRef?.messageId ?? null;
  if (messageId === null) return false;
  return runs.some(item => item.run?.consumedWait?.messageRef?.messageId === messageId);
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
  const goalRef = goalOfTask(task);
  const row = (ready(await project.host.client.read('tasks/query', project.scope, { goalRef }))?.tasks ?? []).find(entry => entry.ref.taskId === task.taskId);
  if (row === undefined) return { readable: false, task, text: `tasks/query 里找不到 ${task.taskId}` };
  return { readable: true, task, unfinished: row.disposition === 'active' && row.effectivePhase !== 'satisfied',
    text: `${task.goalId}/${task.taskId} ${row.disposition}/${row.effectivePhase}` };
}

/**
 * Whether a line is busy, and with what: its own SessionCard (`availability`, `record.occupancy`), the Goal's earlier
 * Work Run list, and every page of its Query list, read together right before a send. `availability`, `occupancy` and
 * `why` name each holder; a read that does not answer is a gap (`读失败 …`) and also keeps the line unsent — never an
 * empty read. The two idle probes read this before sending (P6K ruling §3/§6).
 */
export async function lineBusy(project, runs, sessionRef) {
  const holding = [];
  const gaps = [];
  const body = await project.host.client.read('sessions/read', project.scope, sessionRef);
  const card = ready(body);
  if (card === null) gaps.push(`sessions/read ${sessionRef.sessionId}: ${body?.status ?? 'no answer'} ${body?.code ?? ''}`.trim());
  else {
    if (card.availability !== 'idle') holding.push(`availability ${card.availability}`);
    const occupancy = card.record?.occupancy ?? null;
    if (occupancy !== null) holding.push(`占用 ${occupancy.kind ?? '-'} ${describe(occupancy.executionRef ?? null)}`);
  }
  for (const item of runs.filter(entry => claimSession(entry) === sessionRef.sessionId && entry.run.status !== 'ended')) {
    holding.push(`未结束的 Work Run ${item.run.ref.runId}（${item.run.status}）`);
  }
  const queryGaps = [];
  for (const snapshot of await sessionQueries(project, sessionRef, queryGaps)) {
    if (['running', 'pending'].includes(snapshot.run?.status)) holding.push(`Query ${snapshot.ref?.queryJobId ?? '-'}（${snapshot.run.status}）`);
  }
  gaps.push(...queryGaps);
  const why = [...holding, ...gaps.map(gap => `读失败 ${gap}`)];
  return { busy: why.length > 0, why: why.length === 0 ? null : why.join('；'), gaps, readable: gaps.length === 0,
    availability: card?.availability ?? null, occupancy: card?.record?.occupancy ?? null };
}

/** 线一直忙、探针没发出时的 note：忙什么、哪条线、什么时刻、当时的任务（诊断 intervention 行）。 */
const busyWaiting = busy => `线在忙：${busy.why}（线 ${busy.line}，${busy.at}，任务 ${busy.task}）`;

/**
 * P6L intervention (diagnosis row `intervention`, run sheet item 6): the pause cell's premise, read BEFORE pausing.
 * `work` is `currentWork`'s result, `busy` is `lineBusy`'s, and `run` is the running Run of this line then. Without a
 * work line or a running Run there is nothing to deliver the queued letter into after the resume, so the cell stays
 * not-run naming the missing item instead of pausing, sending and resuming into a false failure.
 */
export const pausePremiseOf = ({ work, busy, run }) => {
  if (work?.readable !== true) {
    return { ok: false, code: 'env-unavailable', missing: `暂停前读不到这条线的当前工作（${work?.text ?? 'currentWork 没有结果'}）` };
  }
  if (work.task === null || work.task === undefined) {
    return { ok: false, code: 'not-run', missing: '暂停前这条线没有当前工作（没有 latestWork，没有可暂停投递的工作线）' };
  }
  if (work.unfinished !== true) {
    return { ok: false, code: 'not-run', missing: `暂停前这条线的当前任务已经完成（${work.text ?? '没有未完成状态'}），没有可暂停投递的工作` };
  }
  if (run === null || run === undefined) {
    return { ok: false, code: 'not-run', missing: '暂停前这条线上没有在跑的 Run（没有可暂停投递的工作）' };
  }
  if (!sameTask(run?.run?.task, work.task)) {
    return { ok: false, code: 'not-run', missing: `暂停前这条线在跑的 Run 属于另一个 Task（${run?.run?.task?.goalId ?? '-'}/${run?.run?.task?.taskId ?? '-'}，当前任务 ${work.task.taskId}），送达前提不成立` };
  }
  if (busy?.readable === false) {
    return { ok: false, code: 'env-unavailable', missing: `暂停前这条线的占用读不全（${busy.gaps.join('；')}），不能据此证明它在忙` };
  }
  if (busy?.busy !== true) {
    return { ok: false, code: 'not-run', missing: `暂停前这条线并不忙（${busy?.why ?? '没有占用'}），恢复后送达的前提不成立` };
  }
  return { ok: true, work: work.text, why: busy.why };
};

/**
 * P6L intervention: the pause cell's one verdict after the resume, from the same letter's raw observations — its
 * disposition then, its delivery (`delivery.deliveredTo`), and the `intervention_planning` Query of that same message
 * (`planningOf`). A proven-busy line whose offerable letter still times out is `fail`; a missing premise or an
 * idle-planning outcome is `uncovered` with the missing item named. `view` is the last `messages/view` read.
 */
export const pausedVerdict = ({ premise, whilePaused, afterResume, view, planning, planningGaps,
  whilePausedInto = null, resumeCommitted, ended = null, viewGap = null }) => {
  const into = view?.delivery?.deliveredTo?.executionRef ?? null;
  if (premise?.ok !== true) return { status: 'uncovered', code: premise?.code ?? 'not-run',
    note: `暂停投递的前提不成立：${premise?.missing ?? '没有当前工作'}` };
  // P6L3 B12 (MVP-BEHAVIOR.md:378): the pause violation is judged before the resume receipt, so a refused resume
  // never hides a letter that already went into Work while paused.
  if (whilePaused === 'delivered' && whilePausedInto?.aggregateType === 'Run') {
    return { status: 'fail',
      note: `暂停中这封信已经送进 Work ${describe(whilePausedInto)}，不是暂停中只排队、恢复后才送达` };
  }
  if (!resumeCommitted) return { status: 'uncovered', code: 'not-run',
    note: '恢复没有提交（回执不是 committed），恢复后的送达没有发生，这一支没走到' };
  if (afterResume === 'delivered' && into?.aggregateType === 'Run') {
    if (whilePaused === 'offerable') return { status: 'pass', note: `恢复后送进 Work ${describe(into)}` };
    return { status: 'uncovered', code: whilePaused === null || whilePaused === undefined ? 'env-unavailable' : 'not-run',
      note: `恢复后送进 Work ${describe(into)}，但暂停中消息已 ${whilePaused ?? '读不到'}，不是暂停中只排队、恢复后才送达` };
  }
  if (afterResume === 'delivered') {
    return { status: 'uncovered', code: 'not-run', note: `恢复后送进 ${describe(into)}，不是恢复后送进 Work Run` };
  }
  // P6LO B10: branch evidence first (a planning round, or the letter settled), then the gaps, then the real timeout.
  if (planning !== null && planning !== undefined) {
    return { status: 'uncovered', code: 'not-run',
      note: `恢复时这条线已没有在跑的工作，消息开了空闲规划 ${planning.job?.job?.job?.queryJobId ?? planning.line ?? '-'}，不是恢复后送进 Work` };
  }
  if (whilePaused === null || whilePaused === undefined) return { status: 'uncovered', code: 'env-unavailable',
    note: '暂停中消息的 disposition 读不到，送达前提无从证明' };
  if (whilePaused !== 'offerable') return { status: 'uncovered', code: 'not-run',
    note: `暂停中消息已 ${whilePaused}，没有排队的信可在恢复后送达` };
  if (afterResume === 'undelivered') return { status: 'fail',
    note: `具备送达条件，恢复后却未送达（${view?.disposition?.reason ?? '无原因'}）` };
  if (SETTLED.includes(afterResume)) {
    return { status: 'uncovered', code: 'not-run', note: `恢复时这条线已没有在跑的工作，消息收尾为 ${afterResume}` };
  }
  if (planningGaps.length > 0) return { status: 'uncovered', code: 'env-unavailable',
    note: `恢复后规划 Query 读不全：${planningGaps.join('；')}` };
  if (viewGap !== null) return { status: 'uncovered', code: 'env-unavailable',
    note: `恢复后最后一次读信失败（${viewGap}），之前读到 ${afterResume ?? '无'}，没有送达或规划的证据` };
  if (ended === 'deadline' && afterResume === 'offerable') return { status: 'fail',
    note: '线在忙且暂停中的信可送达，恢复后 30 分钟仍在排队（超时）' };
  return { status: 'uncovered', code: ended === 'budget' ? 'not-run' : 'env-unavailable',
    note: `恢复后观察${ended === 'budget' ? '因场景预算停止' : '结束'}，信 ${afterResume ?? '读不到'}，没有送达或规划的证据` };
};

/**
 * P6 Q7 (claim once): the letter's first observed association — its claim, delivery, acceptance or planning round —
 * with the Runs opened since the send and the planning Query of the message; null while no association is seen.
 * P6K row 7: delivery or a settled disposition is not required. P6K row 10 + P6L2 A6: the point's one `executions`
 * read is these runs; when it failed the runs are unavailable (`null`) and a later verdict is `env-unavailable`, and
 * an unassociated letter is never locked by that failure.
 */
export async function claimSnapshot(project, goalRef, claim, { unassociated = false } = {}) {
  const { point, runs, runsUnavailable, readGaps } = await letterPoint(project, claim, goalRef);
  // P6LO A6: the close-out snapshot (`unassociated`) keeps its read gaps whatever it found, so a final read that is not
  // complete decides nothing even when it shows an association; a snapshot locked earlier keeps its own judgement.
  const closeGaps = unassociated ? { gaps: readGaps } : {};
  // P6L2 A6: a failed execution list never locks the point; with no same-letter association it keeps observing.
  if (!associatedWith(claim, point, runs)) return unassociated ? { associated: false, at: point.at, ...closeGaps } : null;
  const fresh = runsUnavailable ? null : runs.filter(item => item.run.task.taskId === claim.taskId
    && claimSession(item) === claim.line && !claim.before.has(item.run.ref.runId));
  return { associated: true, point, runs: fresh, runsUnavailable, planning: point.planning, at: point.at, ...closeGaps };
}

/**
 * P6K rows 7/10: the claim-once verdict from the snapshot. `runs: null` is the unavailable reading, which says only
 * that the evidence cannot tell; it never names the target loop as the claimer.
 */
export function claimVerdict(snap, base = '') {
  const prefix = base === '' ? '' : `${base}；`;
  // P6LO A6: a close-out read that is not complete is uncovered, associated or not.
  if ((snap?.gaps ?? []).length > 0) {
    return { status: 'uncovered', code: 'env-unavailable',
      text: `${prefix}收尾读不全（${snap.gaps.join('；')}），认不出这条消息有没有送进执行或开轮` };
  }
  if (snap?.associated === false) return { status: 'fail', text: `${prefix}读全了，这条消息既没送进执行，也没有开轮或收尾` };
  if (snap === null || snap === undefined || snap.runs === null || snap.runs === undefined) {
    return { status: 'uncovered', code: 'env-unavailable',
      text: `${prefix}executions 读数不可用（读数缺口），认不出这条消息有没有开 Run，不推断领取者` };
  }
  const to = snap.point?.deliveredTo?.executionRef ?? null;
  const messageId = snap.point?.messageRef?.messageId ?? null;
  const opened = snap.runs.filter(item => item.run.consumedWait?.kind === 'intervention'
    && item.run.consumedWait.messageRef?.messageId === messageId);
  const text = `${prefix}${snap.at ?? ''} 读到 ${snap.point?.disposition?.kind ?? '无'}，送进 ${describe(to)}；之后这条线上这个任务新开的 Run ${
    snap.runs.map(item => item.run.ref.runId).join(', ') || '无'}（因这条消息开的 ${opened.length} 个）；这条消息的规划 Query ${
    snap.planning === null || snap.planning === undefined ? '没有' : snap.planning.job?.job?.job?.queryJobId}`;
  if (opened.length === 0 && (snap.planning ?? null) === null && to?.aggregateType === 'Run') {
    return { status: 'uncovered', code: 'not-run',
      text: `${text}：目标循环先领了这个任务，消息在安全点送进它的 Run，不是“空闲线领一次”这一支` };
  }
  const pass = opened.length === 1 && snap.runs.length === 1
    && (to === null || (to.aggregateType === 'Run' && to.runId === opened[0].run.ref.runId))
    && (snap.planning ?? null) === null;
  return { status: pass ? 'pass' : 'fail', text };
}

async function control(ctx, project, goalRef, kind, check) {
  const goal = ready(await project.host.client.read('goals/read', project.scope, goalRef));
  if (goal === null) throw broken(ctx, `goals/read of ${goalRef.goalId} failed before ${kind}`, check);
  return project.host.client.write('goals/control', project.scope, { goalRef, control: kind, reason: `G6 intervention ${kind}` },
    [{ ref: goalRef, revision: goal.goal.revision }, { ref: { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId }, revision: 0 }]);
}

/** Every control intent ref the Run shows now: its pointer and its appended inputs. */
const runIntentRefs = run => [run?.controlState?.intentRef, ...(run?.controlInputs ?? [])].filter(ref => ref?.intentId !== undefined);
/** Adds refs the timeline has not seen yet (`timeline.intents`), so a later moment reads a replaced pointer's state. */
const rememberIntents = (timeline, refs) => {
  timeline.intents ??= [];
  for (const ref of refs) if (!timeline.intents.some(entry => entry.intentId === ref.intentId)) timeline.intents.push(ref);
};

/** P6J3: one named moment of the intervention timeline; P6J4b: it reads and remembers every control intent seen so far. */
export const timelinePoint = async (project, timeline, name, ref, goalRef = null) => {
  const point = { name, ...await messagePoint(project, ref, { projectId: project.scope.projectId, sessionId: timeline.line }, timeline.runRef,
    goalRef, timeline.intents ?? []) };
  rememberIntents(timeline, point.controlIntents.map(entry => entry.ref));
  return point;
};

/**
 * P6J4b (quick check p6jcr4 row 7): just before the resume, the Run's pause pointer is noted; the resume replaces
 * `controlState.intentRef`, so without this the later moments could not read the pause's own state. A read that fails
 * is a timeline gap.
 */
export async function rememberControls(project, timeline) {
  if (timeline.runRef === null) return;
  const body = await project.host.client.read('executions/read', project.scope, timeline.runRef);
  const execution = ready(body);
  if (execution === null) timeline.gaps.push(`恢复前 executions/read ${timeline.runRef.runId}: ${body?.status ?? 'no answer'} ${body?.code ?? ''}`.trim());
  else rememberIntents(timeline, runIntentRefs(execution.run));
}

/**
 * P6J3 intervention: where the idle-line message ended. The round is the one whose own `sourceMessageRef` is this
 * message; a failed read of another planning Query is kept as evidence but never covers a round already found. With no
 * round and an unreadable read the gap is the answer; with all reads complete the wait's own ending decides.
 */
export async function endingOf(project, messageRef, goalRef) {
  const queryGaps = [];
  const found = await planningOf(project, messageRef, queryGaps);
  const job = found?.job ?? null;
  if (job !== null && !['answered', 'closed'].includes(job.run?.run?.status)) return null;
  if (job === null && queryGaps.length > 0) return { missing: queryGaps, settled: true, readGaps: queryGaps };
  const readGaps = [];
  const qid = job?.job?.job?.queryJobId ?? null;
  const queueBody = await project.host.client.read('decisions/queue', project.scope, { workspace: project.scope,
    goalRef, sections: ['waiting_answer', 'history'], page: { limit: 100 } });
  const queue = ready(queueBody);
  if (queue === null && queueBody?.status !== 'not_found') readGaps.push(`decisions/queue: ${queueBody?.status ?? 'no answer'} ${queueBody?.code ?? ''}`);
  const cards = [...(queue?.waitingAnswer ?? []), ...(queue?.history ?? [])];
  const candidate = qid === null ? undefined : cards.find(card => card.source.kind === 'candidate' && card.requestRef?.queryJobId === qid);
  const asked = qid === null ? false : cards.some(card => card.source.kind === 'planning_question' && String(card.source.key).includes(qid));
  const messageBody = await project.host.client.read('messages/read', project.scope, messageRef);
  const message = ready(messageBody);
  if (message === null && messageBody?.status !== 'not_found') readGaps.push(`messages/read ${messageRef.messageId}: ${messageBody?.status ?? 'no answer'} ${messageBody?.code ?? ''}`);
  if (readGaps.length > 0) return { missing: readGaps, settled: true, readGaps: [...queryGaps, ...readGaps] };
  const replied = message?.status === 'responded' || (message?.withdrawnAt ?? null) !== null;
  // A complete read with no round has no candidate/question to find: its ending is the message's own ending.
  if (job === null) return replied
    ? { job: null, line: null, queue, candidate, asked, replied, readGaps: queryGaps, settled: true }
    : null;
  const settled = job.run.run.status !== 'answered' || candidate !== undefined || asked || replied;
  return { job, line: found.line, queue, candidate, asked, replied, readGaps: queryGaps, settled };
}

/**
 * One pass of the idle watcher (P6J4: shared by the 10 s watcher and the long wait's poll, so a test drives the same
 * send). It notes an idle message that ended while the Goal was still open, takes the claim-once facts once, and — the
 * first time a line that worked on the Goal holds no unfinished Task (planning-when-idle), or is idle with its Task
 * unfinished (claim-once) — sends that line one direct intervention carrying the Goal its page shows (`pageGoalRef`,
 * P6J intervention). P6K: both branches read the line first (`lineBusy`); a busy line is not sent to and the wait is
 * recorded in `watch.busy` under its branch. `watch` holds `idle`, `claim`, `busy` and the sent `interventions`.
 */
export async function idleWatchStep(project, goalRef, watch, phase, rec) {
  const idle = watch.idle;
  if (idle !== null && idle.messageRef !== null && idle.endedWhileOpen !== true && phase !== undefined && !TERMINAL.includes(phase)) {
    const message = ready(await project.host.client.read('messages/read', project.scope, idle.messageRef));
    if (message?.status === 'responded' || (message?.withdrawnAt ?? null) !== null) idle.endedWhileOpen = true;
  }
  // P6K item 7: the idle letter's one evidence point, taken the first pass that sees its claim, delivery or round
  // opening; later passes keep it. The Goal is the one the letter names, else the Run or Query it opened, else the
  // send-time snapshot (`letterPoint`), never the line's latest Work; an unreadable field is a gap in the point.
  if (idle !== null && idle.messageRef !== null && idle.point === undefined) {
    const { point, runs } = await letterPoint(project, idle, idle.goalRef);
    if (associatedWith(idle, point, runs)) idle.point = point;
  }
  // Claim once: the facts are taken the first time the message was accepted or settled (never by blocking here).
  const claim = watch.claim;
  if (claim !== null && claim.messageRef !== null && claim.snap === null) claim.snap = await claimSnapshot(project, goalRef, claim);
  if ((watch.idle !== null && watch.claim !== null) || phase === undefined || TERMINAL.includes(phase) || phase === 'PAUSED') return;
  const runs = await executions(project, goalRef);
  const workers = new Set(runs.map(claimSession).filter(Boolean));
  for (const row of (await lines(project)).filter(entry => workers.has(entry.key.sessionId))) {
    const now = await currentWork(project, row.key);
    if (!now.readable || now.task === null || now.task.goalId !== goalRef.goalId) continue;
    // P6K: both branches read the line before sending. A still-busy line is not sent to; the wait is recorded under
    // its branch, and the existing watcher's 10 s poll / the long wait's poll asks again (no new timer or sleep).
    const busy = await lineBusy(project, runs, row.key);
    const goalOnPage = pageGoalRef(project, row, goalRef);
    if (!now.unfinished && watch.idle === null) {
      if (busy.busy) {
        watch.busy ??= {};
        watch.busy.planning = { line: row.key.sessionId, at: new Date().toISOString(), task: now.text, goalRef: goalOnPage,
          availability: busy.availability, occupancy: busy.occupancy, why: busy.why };
        continue;
      }
      const sent = await interveneLine(project, row.key, IDLE_TEXT, { goalRef: goalOnPage });
      watch.idle = { messageRef: sent.value?.ref ?? null, line: row.key.sessionId, phase, work: now.text, goalRef: goalOnPage,
        occupancy: '空闲', at: new Date().toISOString(), refused: sent.ok ? null : sent.said };
      rec.link('message', watch.idle.messageRef);
      if (watch.idle.messageRef !== null) watch.interventions.push({ text: IDLE_TEXT, ref: watch.idle.messageRef });
      return;
    }
    if (now.unfinished && watch.claim === null) {
      if (busy.busy) {
        watch.busy ??= {};
        watch.busy.claim = { line: row.key.sessionId, at: new Date().toISOString(), task: now.text, goalRef: goalOnPage,
          availability: busy.availability, occupancy: busy.occupancy, why: busy.why };
        continue;
      }
      const before = new Set(runs.filter(item => item.run.task.taskId === now.task.taskId && claimSession(item) === row.key.sessionId)
        .map(item => item.run.ref.runId));
      const sent = await interveneLine(project, row.key, CLAIM_TEXT, { goalRef: goalOnPage });
      watch.claim = { messageRef: sent.value?.ref ?? null, line: row.key.sessionId, taskId: now.task.taskId, work: now.text,
        goalRef: goalOnPage, occupancy: '空闲', at: new Date().toISOString(), before, snap: null,
        refused: sent.ok ? null : sent.said };
      rec.link('message', watch.claim.messageRef);
      if (watch.claim.messageRef !== null) watch.interventions.push({ text: CLAIM_TEXT, ref: watch.claim.messageRef });
      return;
    }
  }
}

/**
 * P6J intervention (diagnosis row `intervention`; P6J4 quick check row 2): the long Goal's whole wait judges no check
 * (`check: null`), so a timeout is a `not-run` stop, not the first unjudged check's fail. `WaitTimeout.message` is the
 * real stop (a timeout or the platform's own stall from `endedEarly`) and is kept; the idle watcher stops; and the
 * idle-line cell, which reads on its own message, is still judged (`flows.mjs:43-55`). `wait` is `waitGoal`.
 */
export async function afterLongWait(ctx, project, rec, { goalRef, watch, onPoll, wait = waitGoal }) {
  let longStop = null;
  const busyEnd = await wait(ctx, project, goalRef, { timeoutMs: 150 * MINUTE, rec, returnOnDecide: true, check: null, onPoll })
    .catch(error => {
      if (error instanceof WaitTimeout) { longStop = error.message; return null; }
      throw error;
    });
  watch.stopped = true;
  rec.facts.longGoal = longGoalStop(busyEnd, longStop);
  if (busyEnd === null) rec.note(`长目标没有返回：${rec.facts.longGoal.stoppedFor}；接着判能单独读的格`);
  else if (busyEnd.stoppedFor !== null) rec.note(`长目标停下等人：${busyEnd.stoppedFor}`);
  await judgeIdleIntervention(ctx, project, rec, watch.idle, goalRef, watch.busy?.planning ?? null);
  return busyEnd;
}

/**
 * `planning-when-idle`, judged on the idle-line message alone: never sent is `not-run`; a refused send is `fail` with
 * the platform's words; otherwise the message's planning round and its ending decide (`endingOf`).
 * lead 11-18：C-200 要的是“答案交 plans/propose”。Query 答完以后，候选、问题卡、回复由 Host 下一趟消费写出
 * （intervention.ts:558-643），判法等这条消息有了收尾：候选卡、问题卡、消息被回复或被撤回，四样出现一样就算。
 * 候选按 requestRef 认（干预候选的 requestRef 就是这个 Query，intervention.ts:635；叠树 decision-read-model.ts:2264-2285）；
 * “方案确认后自动”下候选可能已被采用，所以连已关的一起读。P6：规划 Query 要开在原线上（`planningOf` 带线）。
 */
export async function judgeIdleIntervention(ctx, project, rec, idle, goalRef, busy = null) {
  if (idle === null) {
    // P6K: a probe that never went out because the line stayed busy names what held it, instead of the old sentence.
    rec.uncover('planning-when-idle', 'not-run', busy === null
      ? '长目标活跃期间没有出现“干过活的线上没有未完成任务”的时刻，没走到这个分支'
      : `${busyWaiting(busy)}；这次等待没等到线空下来发信`);
    return;
  }
  if (idle.refused !== null) {
    rec.fail('planning-when-idle', `${idle.at} 发给闲线 ${idle.line} 的消息被拒：${idle.refused}`);
    return;
  }
  // P6J3: the shared ending read keeps the round found for this message even when another planning Query failed to read.
  const seen = await orNull(waitFor(ctx, 'the ending of the idle-line message', () => endingOf(project, idle.messageRef, goalRef),
    value => value?.settled === true, { timeoutMs: 20 * MINUTE, check: 'planning-when-idle' }));
  const phaseNow = ready(await project.host.client.read('goals/display', project.scope, { goalRef }))?.display?.phase;
  const job = seen?.job ?? null;
  const queryJobId = job?.job?.job?.queryJobId ?? null;
  const otherGaps = (seen?.readGaps ?? []).filter(gap => !/decisions\/queue|messages\/read/.test(gap));
  const facts = `${idle.at} 发给 ${idle.line}（阶段 ${idle.phase}，目标 ${idle.goalRef?.goalId ?? '-'}，线上当前任务 ${idle.work}，发信时线的占用 ${idle.occupancy ?? '-'}）；Query ${queryJobId ?? '-'}（QueryRun ${job?.run?.ref?.runId ?? '-'}，开在 ${seen?.line ?? '-'}）${job?.run?.run?.status ?? '-'}${otherGaps.length === 0 ? '' : `；其他 Query 读失败（不影响这一条）：${otherGaps.join('；')}`}`;
  // 121-146：队列里候选或规划问题来源暂时读不到时，队列不是全貌，不算证据（同叠树 flows.mjs:388）。
  const blind = seen?.queue == null ? [] : unreadableSources(seen.queue)
    .filter(entry => entry.source === 'candidate' || entry.source === 'planning_question');
  // seen 为 null：waitFor 已记 fail（20 分钟里没有收尾）；这一句只把事实补进 notes（Record.set：fail 不会被改掉）。
  if (seen?.missing !== undefined) rec.uncover('planning-when-idle', 'env-unavailable', `${facts}；必要的读失败：${seen.missing.join('；')}`);
  else if (seen === null) rec.fail('planning-when-idle', `${facts}；20 分钟里这条消息没有收尾`);
  else if (job === null) {
    if (TERMINAL.includes(phaseNow) && idle.endedWhileOpen !== true) rec.uncover('planning-when-idle', 'not-run', `${facts}；读全了，没有这条消息的规划 Query，长目标已结束（${phaseNow}）`);
    else rec.fail('planning-when-idle', `${facts}；读全了，没有这条消息的规划 Query，消息${seen.replied ? '已回复/撤回收尾' : '仍未收尾'}`);
  } else if (job.run.run.status !== 'answered') rec.fail('planning-when-idle', `${facts}，没有答完`);
  else if (seen.queue === null) rec.uncover('planning-when-idle', 'env-unavailable', `${facts}；decisions/queue 读不到，认不出有没有候选`);
  else if (blind.length > 0) rec.uncover('planning-when-idle', 'env-unavailable',
    `${facts}；决定队列暂时读不到 ${blind.map(entry => `${entry.source}（${entry.reason ?? ''}）`).join('、')}，认不出有没有候选`);
  else if (seen.candidate !== undefined) {
    rec.check('planning-when-idle', seen.line === idle.line, `${facts}；候选 ${seen.candidate.cardKey}（${seen.candidate.state}）；规划 Query ${
      seen.line === idle.line ? '开在原线' : `没开在原线 ${idle.line}`}`);
  } else if (seen.asked) rec.uncover('planning-when-idle', 'not-run', `${facts}；模型反问（规划问题卡），没走到交 plans/propose`);
  // 目标还活着时这条消息已经收尾（onPoll 记的 endedWhileOpen）：没有候选就是非法收尾，不因为现在目标已结束改记 not-run。
  else if (TERMINAL.includes(phaseNow) && idle.endedWhileOpen !== true) rec.uncover('planning-when-idle', 'not-run', `${facts}；规划收尾前长目标已结束（${phaseNow}），平台不写候选`);
  else rec.fail('planning-when-idle', `${facts}；非法收尾，没有候选`);
  idle.ending = seen?.candidate !== undefined ? 'candidate' : seen?.asked ? 'questions' : job?.run?.run?.status ?? null;
}

/**
 * P6L3 B10: after a committed resume, each tick reads the same letter's delivery and its planning Query and keeps the
 * reading. The wait ends on either branch (the letter settled, or the planning Query appeared) or at the deadline, and
 * the cell is judged once from the kept readings. A scenario-budget stop is returned with those readings, not thrown
 * from here, so the caller judges first and then stops.
 */
export async function observeAfterResume(ctx, project, ref, { timeoutMs = 30 * MINUTE, pollMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let view = null;
  let viewGap = null;
  let planning = null;
  let planningGaps = [];
  // P6LO B10: why the observation ended — a branch was seen, the 30 minutes ran out, or the scenario budget stopped it.
  let ended = 'deadline';
  let stop = null;
  try {
    for (;;) {
      // P6LO B10: a failed letter read is named and keeps the letter read before it; it never wipes that evidence.
      const read = await messageView(project, ref);
      viewGap = read === null ? `messages/view ${ref.messageId} 没有回答` : null;
      view = read ?? view;
      const gaps = [];
      planning = await planningOf(project, ref, gaps);
      planningGaps = gaps;
      if (SETTLED.includes(view?.disposition?.kind) || planning !== null) { ended = 'branch'; break; }
      if (Date.now() >= deadline) break;
      await ctx.budget.tick();
      await sleep(pollMs);
    }
  } catch (error) {
    if (!(error instanceof BudgetStop)) throw error;
    stop = error;
    ended = 'budget';
  }
  return { view, viewGap, planning, planningGaps, ended, stop };
}

/**
 * The pause cell after the paused letter has waited (moved out of `run` unchanged, P6LO B12, so it can be driven): the
 * letter read while paused, the resume, the after-resume observation and the one verdict on `paused-queues`.
 */
export async function resumeAndJudge(ctx, project, rec, { goalRef, letterRef, premise, paused, phaseAtPause, timeline }) {
  const whilePausedView = await messageView(project, letterRef);
  const whilePaused = whilePausedView?.disposition?.kind ?? null;
  const whilePausedInto = whilePausedView?.delivery?.deliveredTo?.executionRef ?? null;
  // P6LO B12: the same verdict asked before the resume; a letter already in Work while paused is its fail, recorded now,
  // so a resume that cannot be sent never hides it (nor judges another cell), and the after-resume judgement is skipped.
  const early = pausedVerdict({ premise, whilePaused, whilePausedInto, resumeCommitted: false, afterResume: null, view: null,
    planning: null, planningGaps: [] });
  if (early.status === 'fail') rec.fail('paused-queues', `暂停 ${paused.status}（目标当时 ${phaseAtPause}）：${early.note}`);
  await rememberControls(project, timeline);
  const resumed = await control(ctx, project, goalRef, 'resume', 'paused-queues');
  // P6L3 B11: the after-resume point is sampled only when the receipt is committed.
  const resumeCommitted = resumed?.status === 'committed';
  if (resumeCommitted) {
    // Sample as soon as the resume receipt lands, before waiting for the delivery: the waiting part must not move
    // the observation point.
    timeline.points.push(await timelinePoint(project, timeline, 'after-resume', letterRef, goalRef));
  }
  if (early.status === 'fail') {
    timeline.paused = { messageRef: letterRef, premise, whilePaused, view: whilePausedView, verdict: early };
    return;
  }
  // P6L3 B10: the wait only observes (check:null); each tick reads the same letter and its planning Query and keeps
  // the last reading. The cell is judged once here, also when the scenario budget stopped the wait.
  const observed = resumeCommitted ? await observeAfterResume(ctx, project, letterRef)
    : { view: null, viewGap: null, planning: null, planningGaps: [], ended: null, stop: null };
  const afterView = observed.view;
  const afterResume = afterView?.disposition?.kind ?? null;
  const planningGaps = observed.planningGaps;
  const afterPlanning = observed.planning;
  const verdict = pausedVerdict({ premise, whilePaused, afterResume, view: afterView,
    planning: afterPlanning, planningGaps, resumeCommitted, whilePausedInto, ended: observed.ended, viewGap: observed.viewGap });
  timeline.paused = { messageRef: letterRef, premise, whilePaused, view: whilePausedView,
    afterResume, afterView, planning: afterPlanning, planningGaps, verdict };
  const pausedText = `暂停 ${paused.status}（目标当时 ${phaseAtPause}）：暂停中 ${whilePaused ?? '读不到'}；恢复 ${resumed?.status} ${resumed?.code ?? ''} 后 ${afterResume ?? '30 分钟里没有收尾'}${
    afterPlanning === null ? '' : `；这条消息的空闲规划 ${afterPlanning.job?.job?.job?.queryJobId ?? afterPlanning.line}`}`;
  if (verdict.status === 'pass') rec.pass('paused-queues', `${pausedText}；${verdict.note}`);
  else if (verdict.status === 'fail') rec.fail('paused-queues', `${pausedText}；${verdict.note}`);
  else rec.uncover('paused-queues', verdict.code, `${pausedText}；${verdict.note}`);
  if (observed.stop !== null) throw observed.stop;
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
  // answer: `fail` with its own words. P6K: a line still busy with its own Run or Query is not sent to; the wait is
  // recorded in `watch.busy` and retried by the same 10 s watcher or the long wait's poll.
  // P6 diagnosis 2 #21 (11-25): the long Goal's idle gaps (95 s, 39 s) all came before the pause, while this watcher
  // only started after it, when the Goal had already completed. It now runs beside the scenario from the long Goal's
  // start (every 10 s, until both branches fired, the Goal ended or this unit ended) and in the long wait's poll; one
  // pass at a time. 核对 11-18（d-check 3.1）：目标还没到终态时这条消息已经回复或撤回，就在这里记下 endedWhileOpen。
  const watch = { idle: null, claim: null, busy: { planning: null, claim: null }, interventions, stopped: false };
  let watchBusy = false;
  const idleWatch = async phase => {
    if (watchBusy) return;
    watchBusy = true;
    try { await idleWatchStep(project, busy.goalRef, watch, phase, rec); } finally { watchBusy = false; }
  };
  (async () => {
    while (!watch.stopped && ctx.report.current === rec && (watch.idle === null || watch.claim === null)) {
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
  const sent = await interveneLine(project, line.key, INTERVENE, { goalRef: pageGoalRef(project, line, busy.goalRef) });
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
  // P6J item 6: the same message, line and Run at three moments (before the pause, after the resume, before the unit's
  // drain). The message does not exist at the first moment; the Run's last event there is the baseline the recovery is
  // read against. `sealTimeline` writes the last point once, before every return.
  // The Run actually working on this line at the pause moment, not the one that was working when the previous
  // intervention was sent (`busyRun`). P6L intervention: the pause only happens when this line really has current work
  // and a running Run — otherwise the queued letter has nothing to be delivered into after the resume, and the cell is
  // not-run naming the missing item instead of a false failure.
  const pauseReadGaps = [];
  const runsAtPause = await executions(project, busy.goalRef, pauseReadGaps);
  const runAtPause = runsAtPause.find(item => item.run.status === 'running' && claimSession(item) === line.key.sessionId) ?? null;
  if (runAtPause === null && pauseReadGaps.length === 0) pauseReadGaps.push('暂停前这条线上没有在跑的 Run');
  const pausePhaseOk = phaseAtPause !== null && !TERMINAL.includes(phaseAtPause) && phaseAtPause !== 'PAUSED';
  const pauseWork = pausePhaseOk ? await currentWork(project, line.key) : null;
  const pauseBusy = pausePhaseOk ? await lineBusy(project, runsAtPause, line.key) : null;
  const pausePremise = pausePhaseOk ? pausePremiseOf({ work: pauseWork, busy: pauseBusy, run: runAtPause }) : null;
  if (pausePremise !== null && pausePremise.ok !== true) pauseReadGaps.push(pausePremise.missing);
  const timeline = { line: line.key.sessionId, runRef: runAtPause?.run.ref ?? null, messageRef: null, gaps: pauseReadGaps, points: [] };
  timeline.points.push(await timelinePoint(project, timeline, 'before-pause', null, busy.goalRef));
  const sealTimeline = async () => {
    if (!timeline.points.some(point => point.name === 'before-cleanup')) {
      timeline.points.push(await timelinePoint(project, timeline, 'before-cleanup', timeline.messageRef, busy.goalRef));
    }
    rec.facts.interventionTimeline = timeline;
  };
  try {
  let paused = null;
  if (!pausePhaseOk) {
    rec.uncover('paused-queues', 'not-run', `暂停前长目标已是 ${phaseAtPause ?? '读不到'}，没有可暂停的工作，这一支没走到`);
  } else if (pausePremise.ok !== true) {
    rec.uncover('paused-queues', pausePremise.code, `${pausePremise.missing}；不暂停、不发暂停中的消息、不恢复`);
  } else {
    paused = await control(ctx, project, busy.goalRef, 'pause');
    if (paused?.status !== 'committed') {
      rec.uncover('paused-queues', 'not-run', `暂停没有提交（目标当时 ${phaseAtPause}）：${paused?.status ?? 'no answer'} ${paused?.code ?? ''} ${paused?.reason ?? ''}；不发暂停中的消息、不恢复`);
    } else {
      const queued = await interveneLine(project, line.key, PAUSED_TEXT, { goalRef: pageGoalRef(project, line, busy.goalRef) });
      rec.facts.userCommand.push(PAUSED_TEXT);
      if (!queued.ok) throw broken(ctx, `while paused: ${queued.said}`, 'paused-queues');
      timeline.messageRef = queued.value.ref;
      interventions.push({ text: PAUSED_TEXT, ref: queued.value.ref });
      await sleep(60_000);
      await resumeAndJudge(ctx, project, rec, { goalRef: busy.goalRef, letterRef: queued.value.ref, premise: pausePremise,
        paused, phaseAtPause, timeline });
    }
  }

  // Second review #9: this check is about the "a Task to continue" branch only; it is judged only when the line held
  // an unfinished Task when the message was sent (read after the pause branch, which gave any planning time to show).
  if (!workAtSend.readable) rec.uncover('continue-no-planning', 'entry-missing', `发送前读不到这条线当前对应的任务（${workAtSend.text}），分支无从确定`);
  else if (!workAtSend.unfinished) rec.uncover('continue-no-planning', 'not-run', `发送时这条线当前的任务不是未完成（${workAtSend.text}），不是“有任务接着做”的分支`);
  else {
    if (paused?.status !== 'committed') await sleep(30_000);
    const planningGaps = [];
    const planningForSent = await planningOf(project, messageRef, planningGaps);
    if (planningGaps.length > 0) rec.uncover('continue-no-planning', 'env-unavailable', `规划 Query 读不全：${planningGaps.join('；')}`);
    else rec.check('continue-no-planning', planningForSent === null,
      `发送时线上当前任务 ${workAtSend.text}；这条消息的 intervention_planning Query：${planningForSent === null ? '没有' : `${planningForSent.job?.job?.job?.status ?? '-'}（线 ${planningForSent.line}）`}`);
  }

  // The long Goal's whole wait, then the idle-line cell on its own message (`afterLongWait`); the watcher stops there.
  const busyEnd = await afterLongWait(ctx, project, rec, { goalRef: busy.goalRef, watch, onPoll: display => idleWatch(display?.display?.phase) });
  const { idle, claim } = watch;
  // P6 Q7, claim once: accepted by a Run that this message opened (`consumedWait.kind === 'intervention'` naming it,
  // `dispatch.ts:330`), the only new Run of that Task on that line, and no planning Query for it (`intervention.ts:256-276`).
  if (claim === null) rec.uncover('claim-once', 'not-run', watch.busy?.claim
    ? `${busyWaiting(watch.busy.claim)}；这次等待没等到线空下来发信`
    : '长目标活跃期间没有出现“干过活的线空闲、它当前的任务没完成”的时刻，没走到这个分支');
  else if (claim.refused !== null) rec.fail('claim-once', `${claim.at} 发给空闲线 ${claim.line}（任务 ${claim.work}）的消息被拒：${claim.refused}`);
  else {
    // P6LO A6: a locked snapshot is kept; otherwise the close-out read decides, carrying its own read gaps.
    if (claim.snap === null) claim.snap = await claimSnapshot(project, busy.goalRef, claim, { unassociated: true });
    const snap = claim.snap;
    const base = `${claim.at} 发给空闲线 ${claim.line}（目标 ${claim.goalRef?.goalId ?? '-'}，当前任务 ${claim.work}，发信时线的占用 ${claim.occupancy ?? '-'}）`;
    const verdict = claimVerdict(snap, base);
    if (verdict.status === 'uncovered') rec.uncover('claim-once', verdict.code, verdict.text);
    else rec.check('claim-once', verdict.status === 'pass', verdict.text);
  }
  rec.facts.interventionPoints = {
    idle: watch.idle === null ? null : { send: { goalRef: watch.idle.goalRef, work: watch.idle.work,
      occupancy: watch.idle.occupancy, at: watch.idle.at }, point: watch.idle.point ?? null },
    claim: claim === null ? null : { send: { goalRef: claim.goalRef, work: claim.work,
      occupancy: claim.occupancy, at: claim.at }, point: claim.snap?.point ?? null },
  };
  // "Asks back" and "illegal answer" cannot be caused through a public entry, so the row stays uncovered; the ending
  // that was seen is listed.
  rec.uncover('four-endings', 'entry-missing', `“反问”“非法”两种收尾没有公开入口能造出；这次看到的结局：${idle?.ending ?? '无'}`);
  rec.note(`长目标结束 ${busyEnd?.display?.phase ?? '没等到（超时）'}`);

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
  // P6J intervention: only a line whose page really shows the completed Goal gets the message (`MemberLine.goalId`:
  // the line's own task's Goal, else the page's selected Goal). A line the long Goal reused shows that Goal instead.
  let doneLine = null;
  for (const row of (await lines(project)).filter(entry => doneWorkers.has(entry.key.sessionId))) {
    const shown = pageGoalRef(project, row, done.goalRef);
    if (shown?.goalId === done.goalRef.goalId) { doneLine = row; break; }
  }
  if (doneLine === null) {
    rec.uncover('completed-goal', 'not-run', `干过已完成目标 ${done.goalRef.goalId} 的线（${[...doneWorkers].join(', ') || '无'}）页面上显示的目标都不是它（被别的目标复用），发给它们的消息不会成为新目标请求`);
    await sealTimeline();
    return;
  }
  const main = ready(await host.client.read('main/read', project.scope, { goalId: null, cursor: null }));
  const known = new Set((main?.requests ?? []).map(entry => JSON.stringify(entry.requestRoot)));
  const toDone = await interveneLine(project, doneLine.key, DONE_TEXT, { goalRef: pageGoalRef(project, doneLine, done.goalRef) });
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
  } finally {
    await sealTimeline();
  }
}

export default { ...def, run };
