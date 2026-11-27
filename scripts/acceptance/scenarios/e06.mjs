// E06: continued work on E05's project, then a handoff with a reason; the successor works from durable material
// only; restarts while a Run works and while the Goal is paused; the predecessor archived, history still readable
// (draft §1.2; MVP-BEHAVIOR.md:358; slice-9-SPEC.md:661, :687). The person never restates the task after the handoff.
import { newId, ready } from '../lib/http.mjs';
import { answerCard, approve, broken, chooseModel, driverStart, executions, interveneLine, lastFinalOf, lines, newGoalInProject, orNull, pageGoalRef,
  runHistory, sessionHistory, sessionTurns, sleep, submitRequest, textOf, turnsOf, waitFor, waitGoal, waitingCards } from '../lib/flows.mjs';
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

/**
 * P6K E06: the first new Run of the interrupted Run's Task after the restart boundary, whether it is still running or
 * already finished. Another Task's Run, a Run that started before the boundary, and the interrupted Run itself are not
 * it; `executions/list` is in storage-index order (`run-state-service.ts:617`), so the start time decides. `after` is
 * the interrupted Run's own `endedAt` (the platform's restart boundary), with the driver's close moment as fallback.
 */
export const resumedRunOf = (runs, interrupted, after, same = item =>
  item.run?.task?.taskId === interrupted.run.task.taskId
  && item.run?.task?.goalId === interrupted.run.task.goalId) => {
  const boundary = Date.parse(after ?? '');
  if (!Number.isFinite(boundary)) return null;
  const started = item => Date.parse(item.run?.startedAt ?? '');
  return (runs ?? []).filter(item => item.run?.ref?.runId !== interrupted.run.ref.runId
    && same(item)
    && Number.isFinite(started(item)) && started(item) >= boundary)
    .sort((left, right) => started(left) - started(right)
      || String(left.run.ref.runId).localeCompare(String(right.run.ref.runId)))[0] ?? null;
};

/**
 * P6L2 A3: `restart-running` is about the interrupted Run's own Session continuing after the restart, never about
 * whichever live Work the handoff happens to enter by (that may be another Task's line). Same Session, a different
 * Run, started at the restart boundary or later.
 */
export const continuedRunOnSession = (runs, interrupted, after, sessionId) => (sessionId === null || sessionId === undefined
  ? null : resumedRunOf(runs, interrupted, after, item => item.outbox?.claim?.sessionRef?.sessionId === sessionId));

/** A running Work Run: the original live-Work condition the handoff step enters by. */
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
  // The driver's own close moment is the fallback boundary when the interrupted Run has no `endedAt`.
  const at = new Date().toISOString();
  const { closed, host } = await ctx.close('w-accept', { restart: true, check });
  rec.note(`restart (${why}) at ${at}: ${closed}`);
  project.host = host;
  const settings = ready(await host.client.settings('snapshot', {}));
  rec.note(`resumeOnStartup = ${settings?.automation?.resumeOnStartup}`);
  return { host, at };
}

/**
 * P6J E06 (diagnosis row `E06`): E05 must leave a real continuation (a project and a line that ran work — even when the
 * Goal stopped for a person), and E05's work must be settled; only then does E06 take the project over and move the
 * usage attribution. Either missing item is named, and the unit stays `not-run`.
 */
const sessionIdOf = ref => ref?.sessionId ?? ref?.ref?.sessionId ?? null;

/**
 * P6J E06 (ruling 4): a line head belongs to E05's continued work when its own key or one of its `chainSessions`
 * (`contracts/work-line.ts:133`) names an E05 Session. The old rule accepted only E05's own lines and therefore refused
 * a successor head the platform itself had chained to them. This is the one rule; `continuationHead`, the takeover and
 * the handoff all call it.
 */
export const continuationHasLine = (e05, line) => {
  const old = new Set((e05?.lines ?? []).map(entry => entry.sessionId));
  return [line, line?.key, ...(line?.chainSessions ?? [])].map(sessionIdOf).some(id => id !== null && old.has(id));
};

/** The current continuable line head: the first line whose chain names an E05 Session. */
export const continuationHead = (e05, rows) => (rows ?? []).find(row => continuationHasLine(e05, row)) ?? null;

/** P6J E06 (ruling 4): a Work is "actually running" only when it started (`startedAt != null`) on the target line. */
export const runningWorkOn = (runs, lineKey) => (runs ?? []).find(item => item.run?.startedAt != null
  && item.run?.status === 'running' && sessionIdOf(item.outbox?.claim?.sessionRef) === lineKey?.sessionId) ?? null;

export const e06Prerequisite = (e05, settled) => settled !== true
  ? { ok: false, missing: 'settled', text: 'E05 的工作在它结束时还没有排空（E05.settled 不是 true）；E06 不接管、不转移用量归属' }
  : e05 === undefined || e05 === null
    ? { ok: false, missing: 'continuation', text: 'E05 没有留下可接续的对象：没有真实项目或做过工的线' }
    : { ok: true };

/**
 * P6J E06 (ruling 4): the ruled order — E05 settled first, then the continuation object, then the current line head
 * and its history Sessions (the head's `chainSessions`), and only then a takeover with the usage attribution moved.
 * A missing premise is named (`settled`, `continuation`, `line`) and nothing is transferred.
 */
export async function e06Takeover(ctx, rec, e05, settled) {
  const prerequisite = e06Prerequisite(e05, settled);
  if (!prerequisite.ok) return { ok: false, missing: prerequisite.missing, text: prerequisite.text };
  const project = e05.project;
  project.host = ctx.hosts?.['w-accept'] ?? project.host;
  const gaps = [];
  const rows = await lines(project, gaps);
  const line = continuationHead(e05, rows);
  if (line === null) {
    return { ok: false, missing: 'line', project, gaps,
      text: `E05 的接续对象在 ${project.scope?.projectId ?? '项目'} 里没有可接续的线头：lines/list 的 ${rows.length} 条线没有一条的 chainSessions 含 E05 的 Session（${
        (e05.lines ?? []).map(entry => entry.sessionId).join(', ') || '无'}）；E06 不接管、不转移用量归属` };
  }
  // Only a valid continuation target takes the project over and moves what it spends to E06.
  ctx.budget.own(project.scope, rec.id);
  rec.projects.push(project);
  return { ok: true, project, line, gaps };
}

/** P6J E06 (ruling 4): the handoff goes to the one Work running on the target line, never to every Work of the goal. */
export async function handOffToRunningWork(project, lineKey, runs, text, options = {}) {
  const work = runningWorkOn(runs, lineKey);
  if (work === null) return { ok: false, missing: 'work', work: null, sent: null };
  const sent = await interveneLine(project, lineKey, text, options);
  return { ok: sent.ok, work, sent };
}

/**
 * P6J4 E06 (quick check row 4): the handoff target is chosen from the live executions, not from the line the restart
 * happened to resume on: the first Work that started and still runs on a line whose chain names an E05 Session
 * (`continuationHasLine`), with the row `lines/list` shows for that line. The handoff goes to that line, carrying the
 * page's Goal. With no such Work nothing is sent and the facts say which Works ran where.
 */
export async function handOffOnContinuation(project, e05, goalRef, text) {
  const gaps = [];
  const runs = await executions(project, goalRef, gaps);
  const rows = await lines(project, gaps);
  const live = runs.filter(item => item.run?.startedAt != null && item.run?.status === 'running');
  const rowOf = work => rows.find(entry => entry.key.sessionId === sessionIdOf(work.outbox?.claim?.sessionRef));
  const work = live.find(item => rowOf(item) !== undefined && continuationHasLine(e05, rowOf(item))) ?? null;
  if (work === null) {
    return { ok: false, missing: 'work', row: null, work: null, sent: null, gaps,
      live: live.map(item => `${item.run.ref.runId}@${sessionIdOf(item.outbox?.claim?.sessionRef) ?? '-'}`) };
  }
  const row = rowOf(work);
  const handed = await handOffToRunningWork(project, row.key, runs, text, { goalRef: pageGoalRef(project, row, goalRef) });
  return { ...handed, row, gaps };
}

/**
 * P6J4b (quick check p6jcr4 row 4): the handoff step. The target comes from the live executions
 * (`handOffOnContinuation`); when no qualifying Work is found, the gaps of the reads that picked it decide first — a
 * failed read is `uncovered (env-unavailable)`, none is `not-run`, and neither ever goes through `broken()`. Only a
 * send the platform refused is its answer (`fail`). The predecessor for the later archive is the handed-off line, else
 * the line the resumed Run claimed; null when no line list answers (the archive then records its own gap).
 * Under `after_plan_confirmation` a short-term line's handoff is an automatic notice, not a card
 * (`decision-policy.ts:120-121`); a `handoff_approval` card that does appear gets the person's approval.
 */
export async function handoffStep(ctx, project, rec, { e05, goalRef, resumedSessionId }) {
  const handed = await handOffOnContinuation(project, e05, goalRef, HANDOFF);
  if (handed.missing === 'work') {
    rec.uncover('handoff', handed.gaps.length > 0 ? 'env-unavailable' : 'not-run', `发换手请求前读 executions 和 lines/list：在跑、开过工的 Work ${
      handed.live.join(', ') || '无'}，没有一个在 E05 接续链的线上（E05 实际开过工的线：${(e05.lines ?? []).map(line => line.sessionId).join(', ') || '无'}${
      handed.gaps.length > 0 ? `；读不全：${handed.gaps.join('；')}` : ''}）；hand_off 只在 Work Run 里能用（handoff-tools.ts:88-89），不发也不等（P6 裁定 Q12）`);
    const fallbackGaps = [];
    const workLine = (await lines(project, fallbackGaps)).find(row => row.key.sessionId === resumedSessionId) ?? null;
    return { chain: null, approved: 0, workLine, lineGaps: [...handed.gaps, ...fallbackGaps] };
  }
  const workLine = handed.row;
  if (!handed.ok) throw broken(ctx, handed.sent?.said ?? `工作线 ${workLine.key.sessionId} 上没有在跑的 Work`, 'handoff');
  rec.link('message', handed.sent.value.ref, handed.sent.value.revision ?? null);
  rec.note(`换手请求发给 ${workLine.key.sessionId}（在跑 Run ${handed.work.run.ref.runId}）：${handed.sent.said}`);
  let approved = 0;
  const chain = await waitFor(ctx, 'a successor on the line', async () => {
    for (const card of await waitingCards(project)) {
      if (card.source.kind !== 'handoff_approval') continue;
      if (await answerCard(ctx, project, card, { kind: 'option', optionId: 'approve' }, '', rec)) approved += 1;
    }
    // P6 diagnosis 2 #6: a handoff successor is not a continuation, so it never enters `chainSessions`; the line list
    // marks it `handoff_from` (`contracts/work-line.ts:61`). Either one names the predecessor.
    const named = ref => (ref?.sessionId ?? ref?.ref?.sessionId) === workLine.key.sessionId;
    return (await lines(project)).find(row => row.key.sessionId !== workLine.key.sessionId
      && ([...(row.status?.markers ?? []), ...(row.markers ?? [])].some(marker => marker?.kind === 'handoff_from'
        && (named(marker.from) || named(marker.fromLine)))
        || row.chainSessions?.some(named))) ?? null;
  }, row => row !== null, { timeoutMs: 40 * MINUTE, check: 'handoff' });
  rec.check('handoff', chain !== null, `前任 ${workLine.key.sessionId} → 接任 ${chain.key.sessionId}（批准的交接卡 ${approved} 张）`);
  rec.link('session', chain.key);
  return { chain, approved, workLine, lineGaps: [] };
}

/**
 * P6K E06 (diagnosis "E06 简报"): a Run's continuation brief through the existing read. A ready answer is
 * `{brief, digest}` (`runtime.ts:687`), so the brief is `value.brief`, never the value itself. The raw answer is kept
 * beside it: `ready(null)` (HTTP 200, no brief) and a failed read are different gaps.
 */
export async function readBrief(project, runRef) {
  const body = await project.host.client.read('executions/brief', project.scope, { runRef });
  const value = ready(body);
  return { body, brief: value?.brief ?? null, digest: value?.digest ?? null };
}

/**
 * P6K E06: `same-task-new-run` is judged on the Run that resumed after the restart, never on the last Run
 * `executions/list` returns — that list is in storage-index order, not time order (`run-state-service.ts:617`), so it
 * can end with the Run the restart interrupted. The resumed Run has to be on the same Task and the same line as the
 * interrupted Run, and the brief has to name that Task and line, and be the continuation of the Run the restart
 * interrupted (`resume_after_interruption`, `previous.runRef`). `resumed` comes from `resumedRunOf` on the actual list,
 * never from a pre-selected Run. No resumed Run, `ready(null)` (this Run has no brief) and a brief that could not be
 * read are uncovered and named, with the boundary field and any list-read gaps. A Run that was located and whose brief
 * was read but whose Task, line or continuation relation is contrary to that expectation is `fail`, not uncovered.
 */
export async function judgeSameTaskNewRun(project, rec, { first, resumed, boundary = null, readGaps = [] }) {
  // P6L2 A4: a paged list with a failed page cannot locate the FIRST new Run; the cell is uncovered, never judged on a
  // later Run that happened to be on a page that was read.
  if (readGaps.length > 0) {
    rec.uncover('same-task-new-run', 'env-unavailable',
      `executions/list 读不全，首个接续 Run 无法定位（边界 ${boundary ?? '未知'}）：${readGaps.join('；')}`);
    return;
  }
  if (resumed === null) {
    rec.uncover('same-task-new-run', 'not-run',
      `没有接续 Run：重启中断的 Run ${first.run.ref.runId} 之后（边界 ${boundary ?? '未知'}，取中断 Run 的 endedAt，缺失时取驱动关停时刻）没有在同一 Task 上开新 Run（见 restart-running）`);
    return;
  }
  const { body, brief, digest } = await readBrief(project, resumed.run.ref);
  if (brief === null && body?.status === 'ready') {
    rec.uncover('same-task-new-run', 'not-run',
      `这个 Run 没有简报：executions/brief ${resumed.run.ref.runId} 答 ready/null（HTTP 200，value:null），不是读失败`);
    return;
  }
  if (brief === null) {
    rec.uncover('same-task-new-run', body?.status === 'not_found' ? 'entry-missing' : 'env-unavailable',
      `brief 读失败：executions/brief ${resumed.run.ref.runId} 答 ${textOf(body)}`);
    return;
  }
  const firstLine = first.outbox?.claim?.sessionRef?.sessionId ?? null;
  const resumedLine = resumed.outbox?.claim?.sessionRef?.sessionId ?? null;
  const gaps = [];
  if (resumed.run.task.taskId !== first.run.task.taskId || resumed.run.task.goalId !== first.run.task.goalId)
    gaps.push(`Task 不同：接续的 Run ${resumed.run.ref.runId} 在 ${textOf(resumed.run.task)}，中断的 Run ${first.run.ref.runId} 在 ${textOf(first.run.task)}`);
  if (brief.task?.taskId !== resumed.run.task.taskId || brief.task?.goalId !== resumed.run.task.goalId)
    gaps.push(`Task 不同：brief.task ${textOf(brief.task)} ≠ resumed.run.task ${textOf(resumed.run.task)}`);
  if (resumedLine === null || resumedLine !== firstLine)
    gaps.push(`线不同：接续 Run 在 ${resumedLine ?? '无'}，中断的 Run 在 ${firstLine ?? '无'}`);
  if (brief.previous?.sessionRef?.sessionId !== firstLine)
    gaps.push(`brief.previous 的线不是中断的线：brief.previous.sessionRef ${textOf(brief.previous?.sessionRef)}，中断的线 ${firstLine ?? '无'}`);
  if (brief.mode !== 'resume_after_interruption' || brief.previous?.runRef?.runId !== first.run.ref.runId)
    gaps.push(`不是 resume_after_interruption / previous 不是中断的 Run：mode ${brief.mode}，previous ${textOf(brief.previous?.runRef)}，中断的是 ${first.run.ref.runId}`);
  if (gaps.length > 0) rec.fail('same-task-new-run', gaps.join('；'));
  else rec.check('same-task-new-run', true,
    `Task ${brief.task.taskId}（goal ${brief.task.goalId}）：${resumed.run.ref.runId} 是 ${brief.mode}，previous ${brief.previous.runRef.runId}，线 ${brief.previous.sessionRef.sessionId}，brief digest ${digest ?? '无'}（重启边界 ${boundary ?? '未知'}，取中断 Run 的 endedAt）`);
}

async function run(ctx, rec) {
  const e05 = ctx.shared.e05;
  // Second review #3: E05's late work must never be counted as E06's; a project with work still in flight is not
  // taken over. Ruling 4: settled is checked before any line or execution is read.
  const taken = await e06Takeover(ctx, rec, e05, ctx.units.get('E05')?.facts.settled);
  if (!taken.ok) throw new Abort('not-run', `${taken.text}${taken.gaps?.length ? `（${taken.gaps.join('；')}）` : ''}`);
  const project = taken.project;
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, project.host, project);
  rec.facts.userCommand = [REQUEST, HANDOFF];
  // E05 已经把项目初始化了：新目标走产品的请求路（G6F F3，和 int.mjs 一样），不走冷启动的 initialization/adopt
  // （已初始化项目的请求轮是 semantic_query，回答是秘书正文，采用会拒）。plans/apply 不启动 Goal 驱动，由人 driver-start。
  const submitted = await submitRequest(project, REQUEST);
  if (submitted?.status !== 'queued') throw broken(ctx, `requests/submit: ${submitted?.code} ${submitted?.reason}`);
  rec.link('session', submitted.secretary);
  const started = await newGoalInProject(ctx, project, submitted.requestRoot, rec);
  const goalRef = started.goalRef;
  const kickoff = await driverStart(ctx, project, goalRef, { flowId: newId('e06-start') });
  rec.note(`driver-start ${goalRef.goalId}: ${kickoff?.status} ${kickoff?.value?.state ?? kickoff?.code ?? ''}`);

  // 1. A Run works: normal close and restart (C-149). Under the default `ask` the Goal waits for the person.
  const first = await runningRun(ctx, project, goalRef, 30);
  const firstSession = first.outbox?.claim?.sessionRef ?? null;
  const restartRunning = await restart(ctx, project, rec, 'Work Run running', 'restart-running');
  const shown = ready(await project.host.client.read('goals/display', project.scope, { goalRef }));
  rec.note(`after restart: ${shown?.display?.phase}/${shown?.display?.row} causes ${textOf(shown?.display?.causes)}`);
  await driverStart(ctx, project, goalRef, { flowId: newId('e06-resume') });
  // The handoff enters on the original live-Work condition: any running Work, as before last round. The original
  // Task's continuation is selected only later, for the `same-task-new-run` row, and never gates this step.
  const liveWorkAfterRestart = await orNull(runningRun(ctx, project, goalRef, 20, 'restart-running'));
  const afterRestart = await executions(project, goalRef);
  const firstRun = afterRestart.find(item => item.run.ref.runId === first.run.ref.runId);
  // P6L2 A3: the cell only checks the original Session's continuation evidence; any live Work may enter the handoff.
  const continued = continuedRunOnSession(afterRestart, first, restartRunning.at, firstSession?.sessionId);
  rec.check('restart-running', firstRun?.run.status === 'ended' && continued !== null,
    `重启前 Run ${first.run.ref.runId} → ${firstRun?.run.outcome}；原 Session ${firstSession?.sessionId ?? '-'} 上的接续 Run ${
      continued?.run.ref.runId ?? '无'}（${continued?.run.status ?? '-'}）`);

  // 2. The person asks the working line to hand off; the model's `hand_off` raises a card the person approves.
  // `hand_off` exists only inside a Work Run (`handoff-tools.ts:88-89`). P6 ruling Q12: the executions are read once
  // before the person writes; no running Work on E05's continued lines gets no request and the handoff is `not-run`,
  // never waited for. P6J4: the target is picked from those live executions (`handOffOnContinuation`).
  // P6 #1: the UI's direct intervention (`entry: 'person_intervention'`, no `intent`); a refusal or a send that did not
  // go out is the platform's answer on `handoff`.
  const { chain, approved, workLine, lineGaps } = await handoffStep(ctx, project, rec, { e05, goalRef,
    resumedSessionId: (liveWorkAfterRestart ?? first).outbox?.claim?.sessionRef?.sessionId ?? null });

  // 3. Pause, restart while paused (C-151), resume. P6 #21: the wait judges `restart-paused` itself. Ruling Q13: the
  // driver does not press "advance" again for the person; a Goal that does not go on is judged as it is, citing the
  // known gap, and the checks after it are still read.
  const pausedAnswer = await pause(ctx, project, goalRef, 'pause');
  rec.note(`pause: ${pausedAnswer?.status} ${pausedAnswer?.code ?? ''}`);
  await sleep(20_000);
  await restart(ctx, project, rec, 'Goal paused', 'restart-paused');
  const pausedShown = ready(await project.host.client.read('goals/display', project.scope, { goalRef }));
  const resume = await pause(ctx, project, goalRef, 'resume');
  const done = await orNull(waitGoal(ctx, project, goalRef, { timeoutMs: 120 * MINUTE, rec, check: 'restart-paused',
    answer: card => (card.source.kind === 'handoff_approval' ? null : approve(card)) }));
  const pausedOk = pausedShown?.display?.phase === 'PAUSED' && resume?.status === 'committed' && done?.display?.phase === 'COMPLETED';
  rec.check('restart-paused', pausedOk,
    `重启后 ${pausedShown?.display?.phase}/${pausedShown?.display?.row}；恢复 ${resume?.status}；最后 ${done?.display?.phase ?? '没等到完成（原因见 fail 的那条）'}${pausedOk ? ''
      : '；已知缺口 STATUS.md:89：暂停的目标跨过重启后被恢复，目标循环不会自己重新起来（P2 之前就有）；驱动不替人再按推进（P6 裁定 Q13）'}`);

  // 4. What the successor actually received, judged by turn identity (lead ruling 11-14 #9): only its turns' input,
  // never a tool result it read or an answer it wrote; the reason is the predecessor's own `hand_off` argument.
  const runGaps = [];
  const runs = await executions(project, goalRef, runGaps);
  if (chain === null) {
    for (const id of ['successor-input', 'no-restatement', 'excluded-path', 'history-continuity', 'wake']) {
      rec.uncover(id, 'not-run', '没有换手（见 handoff），没有接任线可判');
    }
  } else await judgeSuccessor(ctx, project, rec, { chain, workLine, runs, approved });
  rec.uncover('successor-frontier', 'entry-missing', '前任的义务/前沿没有一份可逐字比对的公开原文（hand_off 只给 reason 和 understanding 注记引用），不判通过');
  // P6K E06 (diagnosis "E06 简报"): the brief belongs to the first new Run of the original Task after the restart, not
  // to the last Run `executions/list` returns (storage-index order, `run-state-service.ts:617`). Boundary: the
  // interrupted Run's own `endedAt` from the post-restart list; the driver's close moment is the fallback.
  const interruptedRun = runs.find(item => item.run.ref.runId === first.run.ref.runId);
  const restartBoundary = interruptedRun?.run.endedAt ?? firstRun?.run.endedAt ?? restartRunning.at;
  const continuationRun = runGaps.length === 0 ? resumedRunOf(runs, first, restartBoundary) : null;
  await judgeSameTaskNewRun(project, rec, { first, resumed: continuationRun, boundary: restartBoundary, readGaps: runGaps });

  // 5. Archive the predecessor (no tasks left: plain archive-line with no choices), then read its history. A Goal that
  // did not complete may still hold work on that line: no archive then (an archive refused for that is no finding).
  if (done?.display?.phase !== 'COMPLETED') {
    rec.uncover('archive', 'not-run', `目标没有完成（${done?.display?.phase ?? '没等到'}），前任线上可能还有未完成任务，不归档`);
    rec.uncover('hand-or-drop', 'not-run', '目标没有完成，没有归档');
    ctx.shared.e06 = { project, goalRef, predecessor: workLine?.key ?? null, successor: chain?.key ?? null };
    return;
  }
  // P6J4b: no trusted line ref for the predecessor (the line list did not answer) is the archive's own gap.
  if (workLine === null) {
    rec.uncover('archive', 'env-unavailable', `读不到前任线的引用（${lineGaps.join('；') || 'lines/list 没有这条线'}），不归档`);
    rec.uncover('hand-or-drop', 'not-run', '没有归档');
    ctx.shared.e06 = { project, goalRef, predecessor: null, successor: chain?.key ?? null };
    return;
  }
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
  ctx.shared.e06 = { project, goalRef, predecessor: workLine.key, successor: chain?.key ?? null };
}

/** Section 4 of E06 when a successor exists: the successor's actual input and work, judged by turn identity. */
async function judgeSuccessor(ctx, project, rec, { chain, workLine, runs, approved }) {
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
  rec.pass('no-restatement', '驱动在换手批准之后没有再给这条线发任何消息（http.jsonl 可核）');
  // Avoided = no successful tool result of the successor's Runs changed a path under the excluded folder.
  const touched = [];
  for (const item of runs.filter(entry => entry.outbox?.claim?.sessionRef?.sessionId === chain.key.sessionId)) {
    const changed = turnsOf(await runHistory(project, item.run.ref)).flatMap(turn => turn.results).flatMap(result => result.changedPaths);
    if (changed.some(path => path.startsWith(EXCLUDED))) touched.push(item.run.ref.runId);
  }
  rec.check('excluded-path', successorInput.includes(EXCLUDED) && touched.length === 0,
    `接任者 turn 输入提到 ${EXCLUDED}：${successorInput.includes(EXCLUDED)}；成功写过它的 Run：${touched.join(', ') || '无'}`);
  // Necessary prior text: the predecessor's last final answer, quoted into a later turn's input of the successor.
  const lastFinal = lastFinalOf(predecessorTurns);
  const quote = lastFinal === null ? null : lastFinal.trim().slice(0, 40);
  if (quote === null || quote.length === 0) rec.uncover('history-continuity', 'not-run', '前任没有完成的一轮最终答复，前文无从比对');
  else rec.check('history-continuity', successorInput.includes(quote), `前任最后的最终答复开头「${quote}」在接任者 turn 输入里：${successorInput.includes(quote)}`);
  rec.check('wake', runs.some(item => item.outbox?.claim?.sessionRef?.sessionId === chain.key.sessionId),
    `交接（批准的卡 ${approved} 张）之后接任线上有 Run：后继真的启动`);

}

export default { ...def, run };
