// E09: two work packages raise an interface conflict early; executor reports → adviser explains → the person's
// concrete decision → a new plan version / replacement task → a formal architecture change; source drift located
// (draft §1.4; MVP-BEHAVIOR.md:361; slice-9-SPEC.md:663, :689). `architecture/revise` is in the tree
// (`core-routes.ts:664`), so C-212 runs. The 8E contact layer is `uncovered (8E optional)` in notes only
// (9-start-rulings.frozen.md:966-967), never in `uncovered[]`.
// P6（lead 11-25）：P2 以后消息没有 intent。上报按可信的发收线、要回复、实际答复认（`messages/view`）；参谋问人走
// `ask_person`，人答卡后被叫醒的轮再写候选，采用的版本从当前计划的取消/接替记录找回（#10–#13）。另判两个观察点：
// 同目标另有派活落实后上报仍送到参谋；对方的诊断成为重验依据（可选）。没发生的记 uncover not-run。
import { ready } from '../lib/http.mjs';
import { chooseModel, coldStart, coversPath, executions, findAll, letterQueryJobRefs, lines, messageRefOf, messageView, openProject, orNull,
  registration, runHistory, sleep, sessionQueries, sessionTurns, taskCard, taskRounds, turnsOf, waitFor, waitGoal } from '../lib/flows.mjs';

const MINUTE = 60_000;
const SEED = {
  'package.json': '{\n  "name": "g6-e09",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6-e09\n\nDates and reports.\n',
  'src/api.js': '// The date API lives here.\n',
  'src/report.js': '// The monthly report lives here.\n',
};
const REQUEST = '分两个工作包，各一个任务：A 在 src/api.js 实现并导出 parseDate(text)，返回 Date 对象；'
  + 'B 在 src/report.js 实现 monthOf(text)，要用 parseDate，但 B 需要 parseDate 返回 {y, m, d}。'
  + '两边对 parseDate 的返回值要求冲突：执行时发现了先上报参谋，由参谋向我说明冲突的具体对象和影响，我来决定，不要自己改对方的接口。'
  + '验收：node --test 通过。';

const def = {
  id: 'E09',
  rows: ['C-185', 'C-89', 'C-65', 'C-98', 'C-93', 'C-95', 'C-99', 'C-55', 'C-62', 'C-211', 'C-212', 'C-218'],
  checks: [
    { id: 'executor-reports', rows: ['C-185', 'C-211'], text: '冲突由执行者上报（发给参谋、要回复的消息或 ask_copy），不是只由平台门推断' },
    { id: 'adviser-explains', rows: ['C-211'], text: '参谋解释具体对象和影响（最终答复，或 ask_person / notify_person 的正文）' },
    { id: 'person-decides', rows: ['C-211', 'C-62'], text: '人的决定有授权与版本（人提交的答卡，钉住 Goal 版本）' },
    { id: 'new-version', rows: ['C-211', 'C-55'], text: '新计划版本替换受影响任务，新定义进上下文' },
    { id: 'report-after-dispatch', rows: ['C-185', 'C-211'], text: '同目标另有一次派活落实后，执行者的上报仍送到参谋（不因版本拒收）' },
    { id: 'diagnosis-reverify', rows: ['C-211'], text: '（可选）对方的诊断（有答复的询问）实际成为重验的依据（verification/round 的 reverify.newInputRefs）' },
    { id: 'formal-change', rows: ['C-212'], text: '正式架构变更走 architecture/revise，产生新目录版本' },
    { id: 'drift', rows: ['C-212', 'C-89'], text: '漂移能定位版本/文件（compare-formal 的 finding 带 path）' },
    { id: 'observation-after-adopt', rows: ['C-65'], text: '正式架构采用后自动再抓一次观测' },
    { id: 'observation-after-pass', rows: ['C-98'], text: '检查 PASS 定稿后自动抓一次观测' },
    { id: 'rounds', rows: ['C-93', 'C-95', 'C-218'], text: '每个 Work Task 开轮、PASS 无缺口、证据写入' },
    { id: 'uncovered-round', rows: ['C-99'], text: '没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS' },
  ],
};

/** P6 裁定 Q5: the two ways an executor reports to the adviser; the verdict names which one. */
const REPORT_TOOLS = ['send_session_message', 'ask_copy'];
const reportKind = name => (name === 'ask_copy' ? 'ask_copy（问参谋线的只读副本）' : '要回复的 send_session_message');
/** An executor line: `executor`, or a member line with none of the other three duties (`role-lines.ts:35`). */
const isExecutorDuty = duty => duty !== undefined && !['adviser', 'secretary', 'scribe', 'reviewer'].includes(duty);
const claimSession = item => item.outbox?.claim?.sessionRef?.sessionId ?? null;
/**
 * P6J E09 item 6: the one chain in a single object — the send's arguments, whether the message was accepted, the woken
 * rounds, the Query that carried each, and the Goal completion the driver observed.
 */
export const chainFactsOf = ({ report, view, message, received, queries, wakes = [], goalCompletedObservedAt = null, recipient = null,
  inFlight = null, acceptedReadable = message !== null && message !== undefined, gaps = [] }) => ({
  report: { messageRef: report.ref, tool: report.result.name, args: report.result.args ?? null, recipient },
  accepted: { delivery: view?.delivery?.delivery ?? null, deliveredTo: view?.delivery?.deliveredTo ?? null,
    acceptedInputs: message?.acceptedInputs ?? [], status: message?.status ?? null, readable: acceptedReadable },
  received: received.map(turn => ({ line: turn.line, runId: turn.runId, turnId: turn.turnId, final: turn.final !== null })),
  wakes, queries, inFlight, goalCompletedObservedAt, gaps,
});

/** A `sessions/queries` item is a QueryRun snapshot; `queries/read` takes only its Job's ref (`query-job-service.ts:1033`). */
const jobRefOfSnapshot = snapshot => snapshot.run?.queryJobRef ?? { aggregateType: 'QueryJob', projectId: snapshot.ref.projectId,
  workspaceId: snapshot.ref.workspaceId, queryJobId: snapshot.ref.queryJobId };
/** The line a Query runs on: its claim's Session, else the Session the Job was assigned to or entered (`query-job.ts:571-586`). */
const queryLineOf = read => read.run?.run?.executionState?.sessionRef?.sessionId
  ?? read.job?.job?.assignedSession?.sessionId ?? read.job?.job?.enteredSession?.sessionId ?? null;
/**
 * A Query opened from this letter: the letter is its frozen source, the executor message it replies to, or the copy
 * question it answers (`query-job.ts:364-406`). Any other Query on the line is not this letter's wake.
 */
const queryFromLetter = (read, messageRef) => {
  const execution = read.job?.job?.intent?.execution ?? {};
  return [execution.sourceMessageRef, execution.repliesToMessageRef, execution.consultation?.messageRef]
    .some(ref => ref?.messageId === messageRef.messageId);
};
/** One Query as chain evidence: when it was submitted, whether it entered the Kernel (`entry` is set by the entering commit), its Kernel turn. */
const wakeFactOf = (read, found) => {
  const state = read.run?.run?.executionState ?? null;
  return { queryRef: read.job?.ref ?? null, found, line: queryLineOf(read), submittedAt: read.job?.job?.submittedAt ?? null,
    jobStatus: read.job?.job?.status ?? null, status: read.run?.run?.status ?? null, phase: state?.phase ?? null,
    entered: (state?.entry ?? null) !== null, startedAt: read.run?.run?.startedAt ?? null,
    kernel: state?.history?.kernel ?? state?.entry?.kernel ?? null };
};

/**
 * P6J4 E09 (quick check row 7): the chain's read sides, all by this letter and its recipient line. The receipt is
 * re-read; a failed re-read clears the acceptance fields instead of carrying the earlier snapshot. Each Query of the
 * recipient line (and of the lines that received the letter, and of its frozen read-only copy) is read by its exact Job
 * ref, and so is the letter's own deterministic Job, which a wake nobody claimed yet has. A wake is a Query opened from
 * this letter on the recipient line or its copy (or not claimed by any line yet); an unrelated Query of the line is
 * never one. A received turn is tied to the
 * Query that ran it by the Kernel binding, never by the platform QueryRun id. Every read that fails is named in the
 * chain's own `gaps`.
 */
export async function chainEvidenceOf(project, { report, recipient, received, rows, goalCompletedObservedAt = null, inFlight = null, gaps = [] }) {
  const chainGaps = [];
  const said = body => `${body?.status ?? 'no answer'} ${body?.code ?? ''}`.trim();
  const afterWaitBody = await project.host.client.read('messages/view', project.scope, report.ref);
  const afterWaitView = ready(afterWaitBody);
  const acceptedReadable = afterWaitView !== null;
  if (!acceptedReadable) chainGaps.push(`messages/view ${report.ref.messageId}: ${said(afterWaitBody)}`);
  const lineKeys = new Map();
  const remember = sessionId => {
    if (sessionId === null || lineKeys.has(sessionId)) return;
    lineKeys.set(sessionId, rows.find(entry => entry.key.sessionId === sessionId)?.key ?? { projectId: project.scope.projectId, sessionId });
  };
  for (const turn of received) remember(turn.line);
  remember(recipient);
  // P6J4b (quick check p6jcr4 row 7): an `ask_copy` question is claimed and run on the derived read-only copy
  // (`consultation.ts:538`), the line the letter froze as `consultationDerivation.childSessionRef`; that line counts.
  const letterCopy = afterWaitView?.message?.consultationDerivation?.childSessionRef?.sessionId
    ?? report.view?.message?.consultationDerivation?.childSessionRef?.sessionId ?? null;
  remember(letterCopy);
  const reads = new Map();
  const readJob = async (jobRef, found) => {
    const key = `${jobRef.workspaceId}#${jobRef.queryJobId}`;
    if (reads.has(key)) return;
    const body = await project.host.client.read('queries/read', project.scope, jobRef, { expect: ['not_found'] });
    const read = ready(body);
    // The letter's deterministic Job may simply not exist (no wake opened yet, or the other kind); a line's own Query must answer.
    if (read !== null) reads.set(key, { read, found });
    else if (!(found === 'letter' && body?.status === 'not_found')) chainGaps.push(`queries/read ${jobRef.queryJobId}: ${said(body)}`);
  };
  for (const lineKey of lineKeys.values()) {
    for (const snapshot of await sessionQueries(project, lineKey, chainGaps)) await readJob(jobRefOfSnapshot(snapshot), 'line');
  }
  for (const jobRef of letterQueryJobRefs(report.ref, [report.ref.workspaceId, project.scope.workspaceId])) await readJob(jobRef, 'letter');
  const facts = [...reads.values()].map(({ read, found }) => ({ read, fact: wakeFactOf(read, found) }));
  // The Query's own frozen copy counts too when it derives from the recipient line (`query-job.ts:374-382`).
  const ownCopy = read => {
    const derivation = read.job?.job?.intent?.execution?.consultation?.derivation;
    return derivation?.sourceSessionRef?.sessionId === recipient ? derivation.childSessionRef?.sessionId ?? null : null;
  };
  const wakes = facts.filter(({ read, fact }) => queryFromLetter(read, report.ref)
    && (fact.line === null || [recipient, letterCopy, ownCopy(read)].includes(fact.line)))
    .map(({ fact }) => fact);
  const queryFacts = [];
  for (const { fact } of facts) {
    const turn = fact.kernel === null ? undefined : received.find(entry => entry.line === fact.line
      && entry.runId === fact.kernel.runId && entry.turnId === fact.kernel.turnId);
    if (turn !== undefined) queryFacts.push({ ...fact, runId: turn.runId, turnId: turn.turnId });
  }
  gaps.push(...chainGaps);
  const chain = chainFactsOf({ report: { ref: report.ref, result: report.result }, view: afterWaitView,
    message: afterWaitView?.message ?? null, received, queries: queryFacts, wakes, goalCompletedObservedAt, recipient, inFlight,
    acceptedReadable, gaps: chainGaps });
  return { facts: chain, acceptedReadable, afterWaitView, afterWaitBody };
}

/**
 * The adviser turns that received the report (their input names its message id), followed for a while.
 * lead 11-25 (P6 run): waitGoal returns on the person's answer while the adviser's turn that received the report may
 * still be running (its final came 19 s later), so the adviser lines are read again, waiting up to 5 minutes while a
 * received turn has not completed. P6J E09: a first read of zero rounds is waited for too while this letter has a wake
 * or claim in flight on the recipient line (only its own wakes, claimed or not, `chainEvidenceOf`); a finished Goal with
 * nothing in flight is recorded as it stands. P6J4b (quick check p6jcr4 row 7): `gaps` are the last read's failures,
 * so the verdict speaks for the state after the polls, never for a read before them.
 */
export async function followReceived(ctx, project, { report, recipient, adviserRows, goalRef, waitMs = 5 * MINUTE, everyMs = 15_000 }) {
  let gaps = [];
  const readReceived = async () => {
    gaps = [];
    return (await Promise.all(adviserRows.map(async row => (await sessionTurns(project, row.key, gaps))
      .map(turn => ({ ...turn, line: row.key.sessionId }))))).flat().filter(turn => turn.input.includes(report.ref.messageId));
  };
  const recipientRow = adviserRows.find(row => row.key.sessionId === recipient);
  const inFlight = async () => {
    if (recipientRow === undefined) return { runs: [], queries: [], recipient: false };
    const runs = (await executions(project, goalRef)).filter(item => item.run.status !== 'ended'
      && claimSession(item) === recipient).map(item => item.run.ref.runId);
    const { facts } = await chainEvidenceOf(project, { report: { ref: report.ref, result: report.result, view: report.view }, recipient,
      received: [], rows: adviserRows });
    return { runs, queries: facts.wakes.filter(wake => ['pending', 'running'].includes(wake.status)).map(wake => wake.queryRef), recipient: true };
  };
  let received = await readReceived();
  let flight = received.length === 0 ? await inFlight() : { runs: [], queries: [], recipient: true };
  for (const until = Date.now() + waitMs;
    (received.some(turn => turn.final === null) || (received.length === 0 && flight.runs.length + flight.queries.length > 0))
    && Date.now() < until;) {
    await ctx.budget.tick();
    await sleep(everyMs);
    received = await readReceived();
    if (received.length === 0) flight = await inFlight();
  }
  return { received, flight, gaps };
}

/**
 * `adviser-explains` on the state after the polls: a received turn whose final answer, or `ask_person`/`notify_person`
 * text, names both files passes; an `ask_copy` question is judged on its copy's answer. P6J4b: with nothing found
 * while a read failed (`readGaps`) it is `uncovered (env-unavailable)` with those reads, never "the adviser has not
 * handled it yet" (`not-run`), which only a complete read may say.
 */
export function adviserExplainsVerdict({ reportRef, recipient, received, explained, copy, readGaps, copyNamesBoth }) {
  const unread = readGaps.length === 0 ? null : `读不全：${readGaps.join('；')}`;
  if (explained !== undefined) {
    return { status: 'pass', note: `收到上报 ${reportRef.messageId} 的参谋轮 ${received.length} 个；最终答复或 ask_person/notify_person 正文同时点到 api.js 和 report.js 的：${explained.turnId}` };
  }
  if (received.length > 0) {
    const note = `收到上报 ${reportRef.messageId} 的参谋轮 ${received.length} 个；最终答复或 ask_person/notify_person 正文同时点到 api.js 和 report.js 的：无`;
    return unread === null ? { status: 'fail', note } : { status: 'uncovered', code: 'env-unavailable', note: `${note}；${unread}，没读到的轮可能有解释` };
  }
  if (copy !== null && copy.text !== null) {
    return { status: copyNamesBoth ? 'pass' : 'fail', note: `上报 ${reportRef.messageId} 是 ask_copy，由参谋线 ${recipient} 的只读副本 ${copy.child} 回答（判据来自${copy.from}）；回答同时点到 api.js 和 report.js：${copyNamesBoth ? '是' : '否'}` };
  }
  if (copy !== null && copy.pending) {
    return { status: 'uncovered', code: 'not-run', note: `上报 ${reportRef.messageId} 是 ask_copy，参谋线的只读副本${copy.child === null ? '还没建' : ` ${copy.child} 还没答复`}：参谋解释这一环还没发生` };
  }
  if (copy !== null) {
    return { status: 'uncovered', code: 'env-unavailable', note: `上报 ${reportRef.messageId} 是 ask_copy，由参谋线的只读副本 ${copy.child ?? '（未知）'} 回答，但读不到它的回答：${copy.why}` };
  }
  if (unread !== null) return { status: 'uncovered', code: 'env-unavailable', note: `${unread}；读到的参谋轮输入里没有上报 ${reportRef.messageId}` };
  return { status: 'uncovered', code: 'not-run', note: `上报 ${reportRef.messageId} 发给了参谋线 ${recipient}，但读全的参谋轮输入里都没有它：参谋还没处理这条上报` };
}

/**
 * P6L E09 (diagnosis E09, next-run item 7): the first case's `parseDate` assignments kept whole — each side's own
 * interface (`Date` vs `{y, m, d}`) and the person's decision — beside the plan ref/revision. The judge is unchanged:
 * a first plan that still carries the conflict and the report duty fails when the executor never reported; one whose
 * assignments do not carry the conflict is `uncovered (not-run)` with both texts kept, and no lost revision is inferred.
 */
export function firstCaseJudgement(plan) {
  const planId = plan?.ref?.planId ?? '-';
  const revision = plan?.planRevision ?? null;
  const assignments = (plan?.assignments ?? []).filter(entry => /parseDate/.test(entry.instruction ?? ''))
    .map(entry => ({ taskId: entry.taskId, instruction: entry.instruction }));
  const keeps = assignments.filter(entry => /冲突|conflict/i.test(entry.instruction)
    && /上报|参谋|adviser|由人决定|人来决定|交给人/.test(entry.instruction));
  const texts = assignments.map(entry => `${entry.taskId}「${entry.instruction}」`).join('；') || '没有提到 parseDate 的任务书';
  // P6L2 B13: only the first plan's own two assignments and its revision are kept. Whether an interface was "unified"
  // is an inference from keyword absence, not a fact this record shows, so it is not written.
  const facts = { planRef: plan?.ref ?? null, planRevision: revision, assignments, kept: keeps.map(entry => entry.taskId) };
  if (keeps.length > 0) return { status: 'fail', facts,
    note: `首版计划 ${planId} 把冲突留给执行者上报（${keeps.map(entry => entry.taskId).join(', ')}），执行者没有给参谋线发要回复的消息或 ask_copy` };
  return { status: 'uncovered', code: 'not-run', facts,
    note: `首版计划 ${planId} 的任务书没有把 parseDate 冲突留给执行者上报：${texts}` };
}

async function run(ctx, rec) {
  const host = ctx.hosts['w-accept'];
  const project = await openProject(ctx, host, 'e09', SEED);
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, host, project);
  rec.facts.userCommand = [REQUEST];
  const started = await coldStart(ctx, project, REQUEST, rec);
  const goalRef = started.goalRef;
  const observation = async () => ready(await host.client.read('architecture/observation-state', project.scope, { workspace: project.scope }));
  // The capture after adoption is asynchronous (observation-state is the bounded-wait read, core-routes.ts:676).
  const afterAdopt = await orNull(waitFor(ctx, 'the observation after adoption', observation,
    value => value?.current?.captureRef !== undefined && value?.current?.captureRef !== null, { timeoutMs: 10 * MINUTE, check: 'observation-after-adopt' }));
  rec.check('observation-after-adopt', afterAdopt?.current?.captureRef !== undefined && afterAdopt?.current?.captureRef !== null,
    `采用后观测 ${JSON.stringify(afterAdopt?.current?.captureRef ?? null)}`);

  // The person approves every card (on the conflict: the option that applies the adviser's proposal); only the
  // committed answers count as the person's decision (lead ruling 11-14 #10), each kept with its own receipt.
  const committedAnswers = [];
  const done = await waitGoal(ctx, project, goalRef, { timeoutMs: 150 * MINUTE, rec, committedAnswers, returnOnDecide: true });
  // P6J E09 (item 6): the Goal's completion as the driver observed it, only when the read actually says COMPLETED.
  // A Goal that stopped for a person (NEEDS_DECISION) has no completion time to fill.
  const goalCompletedObservedAt = done.display.phase === 'COMPLETED' ? new Date().toISOString() : null;
  rec.note(`E09 Goal ended ${done.display.phase}${goalCompletedObservedAt === null ? '（没有观察到完成）' : `（完成观测于 ${goalCompletedObservedAt}）`}`);
  rec.facts.stoppedFor = done.stoppedFor;
  if (done.stoppedFor !== null) rec.note(`E09 目标停下等人：${done.stoppedFor}`);

  // Quick check #8: the chain by identity only, link by link. The executor's report (its own successful message that
  // needs a reply, or `ask_copy`, naming parseDate, recognized by the stored sender, recipient and reply need on
  // `messages/view`) → the card the person answered, whose source is that report or a message the adviser sent
  // (`send_session_message` / `ask_person`) in a turn whose input names it → the Plan revision the woken round's
  // candidate was adopted in (the current plan's disposition record) → the Tasks that version supersedes and their
  // successors → the successors' Runs under that Plan and their actual input. `dispatch_task` is an action, never a
  // report. Time order, title changes or counts never stand in for a link.
  // G6F R1: complete records that show a link was not met → `fail`; the link before it did not happen → `uncovered
  // (not-run)`; a read that did not answer or a record that lacks the fact → `uncovered (env-unavailable)` with the
  // read's own words. None of these links lacks a public entry, so none is `entry-missing`.
  // `ask_copy` 的问题由参谋线派生的只读副本回答，不进参谋线自己的轮（DESIGN §1.6:318、§4.7）；副本算在被问的那条线上
  // （§1.6:321），按消息上记下的副本认那一轮。副本不出卡，所以“人决定”“新版本”两环记为 not-run，不判失败
  // （lead 11-17 裁定，E09 第六次；P6 起副本问题按 `answeredBy:'copy'` 认，`tool-commit-arguments.ts:206-214`）。
  const gaps = [];
  const rows = await lines(project, gaps);
  const dutyOf = new Map(rows.map(row => [row.key.sessionId, row.duty]));
  const turnsByDuty = { executor: [], adviser: [] };
  for (const row of rows) {
    if (row.duty === 'secretary') continue;
    turnsByDuty[row.duty === 'adviser' ? 'adviser' : 'executor'].push(...await sessionTurns(project, row.key, gaps));
  }
  const said = body => `${body?.status ?? 'no answer'} ${body?.code ?? ''} ${body?.reason ?? ''}`.trim();
  const notRun = (ids, text) => { for (const id of ids) rec.uncover(id, 'not-run', text); };
  const unreadable = (ids, text) => { for (const id of ids) rec.uncover(id, 'env-unavailable', text); };
  // 一条询问的只读副本和它的回答。副本按消息上记下的派生认（`consultationDerivation.childSessionRef`）。
  // 先读副本自己的历史：副本答完就归档，但 `sessions/history` 照样能读（11-17 在测试世界里核过）。取输入里带这条
  // 询问正文、又有最终答复的那一轮。读不到或没有这样的轮，退一步读原消息上的回复正文（`messages/body` 的
  // response）；副本的答复原样挂在原消息上。`from` 写明用的是哪一种；`text` 为 null 时，`why` 写明哪一步没读到。
  const copyAnswerOf = async messageRef => {
    const messageBody = await host.client.read('messages/read', project.scope, messageRef);
    const message = ready(messageBody);
    if (message === null) return { child: null, pending: false, text: null, from: null, why: `messages/read：${said(messageBody)}` };
    const child = message.consultationDerivation?.childSessionRef ?? null;
    if (child === null || message.status !== 'responded') return { child: child?.sessionId ?? null, pending: true, text: null, from: null, why: null };
    const question = ready(await host.client.read('messages/body', project.scope, { messageRef, part: 'message' }))?.text ?? null;
    const copyGaps = [];
    const turn = question === null ? undefined
      : (await sessionTurns(project, child, copyGaps)).find(entry => entry.final !== null && entry.input.includes(question));
    if (turn !== undefined) {
      return { child: child.sessionId, pending: false, text: turn.final, from: `副本历史 sessions/history 的轮 ${turn.turnId}`, why: null };
    }
    const missed = copyGaps.join('；') || (question === null ? '询问正文 messages/body 没有答复' : '副本历史里没有输入带询问正文、有最终答复的轮');
    const responseBody = await host.client.read('messages/body', project.scope, { messageRef, part: 'response' });
    const response = ready(responseBody)?.text ?? null;
    return response === null
      ? { child: child.sessionId, pending: false, text: null, from: null, why: `${missed}；回复正文 messages/body：${said(responseBody)}` }
      : { child: child.sessionId, pending: false, text: response, from: `${missed}，改用原消息的回复正文 messages/body`, why: null };
  };
  // P6 #10/#11, 裁定 Q5: the executor's report is recognized by what the platform stored, never by tool arguments. A
  // candidate is an executor turn's successful `send_session_message` or `ask_copy` naming parseDate; its saved message
  // (`messageRefOf`: the ref has no sessionId, `session-message.ts:29-34`) is read with `messages/view`
  // (`mailbox.ts:147-177`): a trusted agent sender (`work_run`/`query_run`) on an executor line, the recipient an
  // adviser line, `needsReply` true. The first one that holds is the report.
  const seenSends = [];
  let report = null;
  const candidates = turnsByDuty.executor.flatMap(turn => turn.results)
    .filter(result => REPORT_TOOLS.includes(result.name) && /parseDate/.test(JSON.stringify(result.args ?? {})));
  for (const result of candidates) {
    const ref = messageRefOf(result);
    if (ref === null) { seenSends.push(`${result.name} 的成功结果里没有消息引用（${result.text.slice(0, 120)}）`); continue; }
    const view = await messageView(project, ref);
    if (view === null) { gaps.push(`messages/view ${ref.messageId} 没有回答`); continue; }
    const message = view.message;
    const from = message.sender?.sessionRef?.sessionId ?? null;
    const to = message.recipient?.sessionId ?? null;
    const holds = ['work_run', 'query_run'].includes(message.sender?.kind) && isExecutorDuty(dutyOf.get(from))
      && dutyOf.get(to) === 'adviser' && message.needsReply === true;
    seenSends.push(`${ref.messageId}（${result.name}）${message.sender?.kind}/${from ?? '-'}（${dutyOf.get(from) ?? '?'}）→ ${to ?? '-'}（${dutyOf.get(to) ?? '?'}），needsReply ${message.needsReply}`);
    if (holds && report === null) report = { result, ref, view, from, to };
  }
  const unread = gaps.length === 0 ? null : `读不全：${gaps.join('；')}`;
  const sendsText = seenSends.length === 0 ? '' : `；执行者提到 parseDate 的发信：${seenSends.join('；')}`;
  const later = ['adviser-explains', 'person-decides', 'new-version'];
  if (report === null) {
    if (unread !== null) unreadable(['executor-reports', ...later], `${unread}；读到的历史里没有认得出的执行者上报${sendsText}`);
    else {
      // 计划开工前就消掉了冲突（任务书没有把冲突留给执行者上报）：这一格没有发生的机会，记 not-run，不判失败。
      // P6L E09 (diagnosis E09, next-run item 7): both first-case assignments are kept whole with the plan ref/revision.
      const firstBody = await host.client.read('tasks/query', project.scope, { goalRef, planRef: started.plan });
      const first = ready(firstBody);
      if (first === null) unreadable(['executor-reports', ...later], `tasks/query 首版 ${started.plan?.planId ?? '-'}：${said(firstBody)}`);
      else {
        const firstCase = firstCaseJudgement(first.plan);
        rec.facts.e09FirstAssignments = firstCase.facts;
        rec.note(`E09 首案任务书（${firstCase.facts.planRef?.planId ?? started.plan?.planId ?? '-'} 第 ${
          firstCase.facts.planRevision ?? '-'} 版）：${firstCase.facts.assignments.map(entry => `${entry.taskId}「${entry.instruction}」`).join('；')
          || '没有 parseDate 任务书'}`);
        if (firstCase.status === 'uncovered') notRun(['executor-reports', ...later], `${firstCase.note}${sendsText}`);
        else {
          rec.fail('executor-reports', `${firstCase.note}${sendsText}`);
          notRun(later, '没有执行者的上报，后面这几环没有发生');
        }
      }
    }
  } else {
    const reportRef = report.ref;
    const message = report.view.message;
    const responder = message.response?.sender?.sessionRef?.sessionId ?? null;
    const answerText = message.response == null ? '还没有答复'
      : `${message.response.respondedAt} 答复，答复人 ${message.response.sender?.kind ?? '-'}/${responder ?? '-'}（${dutyOf.get(responder) ?? '?'}）`;
    rec.pass('executor-reports', `执行者上报 ${reportRef.messageId}（${reportKind(report.result.name)}）：发件线 ${report.from}（${message.sender.kind}）→ 收件线 ${
      report.to}（参谋），needsReply ${message.needsReply}，answeredBy ${message.answeredBy}；${answerText}；参数 ${JSON.stringify(report.result.args)}`);
    const recipient = report.to;
    const namesBoth = text => /api\.js/.test(text) && /report\.js/.test(text);
    // The adviser turns that received this message (their input names its message id) and what they said: the turn's
    // final answer, or the text of its `ask_person` / `notify_person` (P2: the adviser explains to the person there).
    // lead 11-25 (P6 run): waitGoal returns on the person's answer while the adviser's turn that received the report may
    // still be running (its final came 19 s later); the adviser lines are read again here, waiting up to 5 minutes while
    // a received turn has not completed.
    const adviserRows = rows.filter(row => row.duty === 'adviser');
    const followed = await followReceived(ctx, project, { report, recipient, adviserRows, goalRef });
    const { received, flight } = followed;
    // P6J E09 (item 6): one chain — send arguments, whether the message was accepted, whether the recipient line woke
    // (claimed or still unclaimed), the Query that carried each claimed round and how it entered, and the Goal's
    // completion as the driver saw it. The shared read clears the acceptance fields when its own re-read fails.
    const chain = await chainEvidenceOf(project, { report: { ref: reportRef, result: report.result, view: report.view }, recipient,
      received, rows: adviserRows, goalCompletedObservedAt, inFlight: flight, gaps });
    const chainFacts = chain.facts;
    if (!chain.acceptedReadable) rec.note(`E09 接受状态重读失败：${chain.afterWaitBody?.status ?? 'no answer'} ${chain.afterWaitBody?.code ?? ''}；不拿轮询前的快照顶替`);
    rec.facts.e09 = chainFacts;
    rec.note(`E09 链：上报 ${reportRef.messageId}（${report.result.name}）参数 ${JSON.stringify(report.result.args ?? null)}；接受 ${chainFacts.accepted.delivery ?? '-'}；叫醒轮 ${
      chainFacts.received.map(turn => `${turn.runId}/${turn.turnId}`).join(', ') || '无'}；这封信的唤醒 ${chainFacts.wakes.length} 个（${
      chainFacts.wakes.map(wake => `${wake.queryRef?.queryJobId ?? '?'} 提交 ${wake.submittedAt ?? '-'}、${wake.entered ? '已进入' : '未进入'}、${wake.line ?? '未领取'}`).join('；') || '无'}）；Kernel 绑定的 Query ${
      chainFacts.queries.map(q => `${q.queryRef?.queryJobId ?? '?'}/${q.status}/${q.phase ?? '-'}`).join(', ') || '无'}；读缺口 ${chainFacts.gaps.join('；') || '无'}；Goal 完成观测于 ${goalCompletedObservedAt}`);
    const explainTexts = turn => [turn.final, ...[...turn.calls.values()]
      .filter(call => ['ask_person', 'notify_person'].includes(call.name) && call.status === 'tool.completed').map(call => call.args?.text)]
      .filter(text => typeof text === 'string');
    const explained = received.find(turn => explainTexts(turn).some(namesBoth));
    // A copy question to the adviser (`answeredBy: 'copy'`): the adviser line's own turns never get it; its copy answers.
    const copy = message.answeredBy === 'copy' && dutyOf.get(recipient) === 'adviser' ? await copyAnswerOf(reportRef) : null;
    // P6J4b: judged on the state after the polls — the last history reads, the chain's own reads, the line list.
    const readGaps = [...gaps.filter(gap => gap.startsWith('lines/list')), ...followed.gaps, ...chainFacts.gaps];
    const verdict = adviserExplainsVerdict({ reportRef, recipient, received, explained, copy, readGaps,
      copyNamesBoth: copy?.text != null && namesBoth(copy.text) });
    if (verdict.status === 'uncovered') rec.uncover('adviser-explains', verdict.code, verdict.note);
    else rec.check('adviser-explains', verdict.status === 'pass', verdict.note);
    // P6 #12: the person's card is the report itself or a message the adviser sent for it; under P2 the adviser asks
    // the person with `ask_person` (`communication-tools.ts:771-782`), whose answered card is a `message` card.
    const sources = [reportRef, ...received.flatMap(turn => turn.results.filter(result => ['send_session_message', 'ask_person'].includes(result.name))
      .map(messageRefOf)).filter(Boolean)];
    const decision = committedAnswers.find(entry => entry.card.source.kind === 'message'
      && sources.some(ref => JSON.parse(entry.card.source.key).messageRef?.messageId === ref.messageId));
    if (decision === undefined) {
      if (copy !== null) {
        notRun(['person-decides', 'new-version'], `上报 ${reportRef.messageId} 走的是 ask_copy，由参谋的只读副本回答；只读副本不出卡，要人定的事应由参谋线 ask_person。人决定和新版本这两环没有发生`);
      } else if (rec.results.get('adviser-explains')?.status === 'pass') {
        rec.fail('person-decides', `参谋解释了上报 ${reportRef.messageId}，但人提交成功的 ${committedAnswers.length} 张卡里没有一张的来源是这条上报或参谋为它发出的消息（send_session_message / ask_person）：冲突没有交给人决定`);
        notRun(['new-version'], '没有人对这次冲突的决定，新版本这一环没有发生');
      } else {
        notRun(['person-decides', 'new-version'], `参谋没有解释这条上报（${rec.results.get('adviser-explains')?.status ?? '未判'}），人对它的决定和新版本这两环没有发生`);
      }
    } else {
      // P6 风险（裁定）：ask_person 的 objects 可以为空，但卡的 `source.pins` 总带 Goal 的版本
      // （`mailbox-send.ts:867-868`：sourcePins = [Goal 版本, ...对象版本]），所以判“人提交的答卡 + 钉住的 Goal 版本”，
      // 不靠对象 pins 非空。
      const msgId = JSON.parse(decision.card.source.key).messageRef.messageId;
      const pins = decision.card.source.pins ?? [];
      const goalPin = pins.find(pin => pin.ref?.aggregateType === 'Goal' && pin.ref?.goalId === goalRef.goalId) ?? null;
      const byPerson = decision.answer?.answer?.status === 'committed';
      rec.check('person-decides', byPerson && goalPin !== null && Number.isSafeInteger(goalPin.revision),
        `${decision.at} 人答卡 ${decision.card.cardKey}（来源消息 ${msgId}，答复 ${decision.answer?.answer?.status ?? '-'}）；钉住 Goal 版本 ${goalPin?.revision ?? '无'}，另有对象 ${Math.max(0, pins.length - (goalPin === null ? 0 : 1))} 个：${JSON.stringify(pins)}`);
      // P6 #13: a message card has no application adapter, so the answer receipt carries no adopted version
      // (`decision-actions.ts:914-916`): the answer wakes the asking line, its round writes a candidate with
      // `sourceMessageRef` = this card's message and `sourcePart: 'decision_answer'` (`plan-machine.ts:113-117`), and
      // the version that adopted it is `setIn` on the current plan's disposition record (`contracts/plan.ts:120-144`).
      const currentBody = await host.client.read('tasks/query', project.scope, { goalRef });
      const current = ready(currentBody);
      const proposals = new Map();
      let adopted = null;
      for (const entry of current?.plan?.dispositionRecord?.entries ?? []) {
        const key = JSON.stringify(entry.proposalRef);
        if (!proposals.has(key)) proposals.set(key, ready(await host.client.read('plans/proposal', project.scope, entry.proposalRef)));
        const proposal = proposals.get(key);
        if (proposal?.sourceMessageRef?.messageId === msgId && proposal.sourcePart === 'decision_answer') { adopted = entry.setIn; break; }
      }
      // The adopted version itself, even when a later one followed (`tasks/query` takes a planRef, plan-contracts.ts:210).
      const graphBody = adopted === null ? null : await host.client.read('tasks/query', project.scope, { goalRef, planRef: adopted });
      const graph = ready(graphBody);
      // The product's replacement: a superseded Task names the Task that takes it over (`replacedByTaskId`,
      // contracts/plan.ts:71-77); the advisory relations (`coordination`/`expected_dependency`) never mean replacement.
      const superseded = graph === null ? [] : [...new Map(findAll(graph, node => typeof node.taskId === 'string'
        && typeof node.replacedByTaskId === 'string').map(node => [node.taskId, node])).values()];
      if (current === null) unreadable(['new-version'], `tasks/query 当前计划：${said(currentBody)}`);
      else if (adopted === null) {
        notRun(['new-version'], `当前计划 ${current.plan?.ref?.planId ?? '-'} 的取消/接替记录（${(current.plan?.dispositionRecord?.entries ?? []).length} 条）里没有一条来自卡 ${decision.card.cardKey} 答复轮的候选（plans/proposal 的 sourceMessageRef = ${msgId}、sourcePart = decision_answer）：这次决定没有产生替换任务的新版本`);
      } else if (graph === null) unreadable(['new-version'], `tasks/query ${adopted.planId}：${said(graphBody)}`);
      else if (superseded.length === 0) rec.fail('new-version', `决定采用的 ${adopted.planId} 里没有被取代（replacedByTaskId）的任务：受影响的任务没有被替换`);
      else {
        const replacing = [...new Set(superseded.map(node => node.replacedByTaskId))];
        const relations = superseded.map(node => ({ fromTaskId: node.replacedByTaskId, toTaskId: node.taskId }));
        const fed = [];
        const ranUnder = [];
        for (const item of (await executions(project, goalRef)).filter(entry => replacing.includes(entry.run.task.taskId)
          && JSON.stringify(entry.plan?.ref) === JSON.stringify(adopted))) {
          ranUnder.push(item.run.ref.runId);
          const title = graph.tasks.find(task => task.ref.taskId === item.run.task.taskId)?.definition?.title ?? '\u0000';
          if (turnsOf(await runHistory(project, item.run.ref)).some(turn => turn.input.includes(title))) fed.push(`${item.run.task.taskId}/${item.run.ref.runId}`);
        }
        const text = `决定采用 ${adopted.planId}（卡 ${decision.card.cardKey} 的答复轮候选）；替换关系 ${relations.map(relation => `${relation.fromTaskId}→${relation.toTaskId}`).join(', ')}；这一版下替换任务的 Run ${ranUnder.join(', ') || '无'}；输入带新定义的 ${fed.join(', ') || '无'}`;
        if (ranUnder.length === 0) rec.uncover('new-version', 'not-run', `${text}（替换的任务在这一版下还没有 Run）`);
        else rec.check('new-version', fed.length === ranUnder.length, text);
      }
    }
  }

  // P6 观察点（裁定 Q6）：同目标另有一次派活落实后，执行者的上报仍送到参谋。派活落实按任务卡读
  // （`graph/detail` 的 `dispatch.request`：`state === 'applied'`、`outcome.run`，`work-line.ts:416-431`），落实时刻取那个
  // Run 的开始；上报的送达读 `messages/view` 的 `delivery`（`session-message.ts:128-133`）；执行者发信被拒看它轮里的拒绝。
  if (report === null) notRun(['report-after-dispatch'], '没有认出执行者的上报，这一支没走到');
  else {
    const runStart = new Map((await executions(project, goalRef)).map(item => [item.run.ref.runId, item.run.startedAt ?? null]));
    const applied = [];
    for (const task of ready(await host.client.read('tasks/query', project.scope, { goalRef }))?.tasks ?? []) {
      const request = (await taskCard(project, goalRef, task.ref.taskId))?.dispatch?.request ?? null;
      if (request?.state === 'applied' && request.outcome?.kind === 'applied') {
        applied.push({ taskId: task.ref.taskId, runId: request.outcome.run.runId, at: runStart.get(request.outcome.run.runId) ?? null,
          by: `${request.requester?.duty ?? '-'}/${request.requester?.session?.sessionId ?? '-'}` });
      }
    }
    const sentAt = Date.parse(report.view.message.createdAt);
    const before = applied.filter(entry => entry.at !== null && Date.parse(entry.at) < sentAt);
    const firstApplied = applied.map(entry => Date.parse(entry.at ?? '')).filter(Number.isFinite).sort((left, right) => left - right)[0] ?? null;
    const refused = firstApplied === null ? [] : turnsByDuty.executor.flatMap(turn => turn.refusals)
      .filter(entry => REPORT_TOOLS.includes(entry.tool) && Date.parse(entry.at) > firstApplied);
    const dispatchText = applied.map(entry => `${entry.taskId} 由 ${entry.by} 派活，落实 Run ${entry.runId} @ ${entry.at ?? '-'}`).join('；');
    const refusedText = refused.length === 0 ? '' : `；落实后执行者发信被拒 ${refused.length} 次：${refused.map(entry => `${entry.tool} ${entry.code}: ${entry.reason}`).join('；')}`;
    if (applied.length === 0) notRun(['report-after-dispatch'], '同目标没有 agent 派活落实（任务卡 dispatch.request 没有 applied 的），这一支没走到');
    else if (before.length === 0) {
      if (refused.length > 0) rec.fail('report-after-dispatch', `${dispatchText}${refusedText}`);
      else notRun(['report-after-dispatch'], `上报 ${report.ref.messageId}（${report.view.message.createdAt}）在派活落实之前发出，这一支没走到：${dispatchText}`);
    } else {
      const now = await messageView(project, report.ref);
      const delivery = now?.delivery?.delivery ?? null;
      const reached = delivery === 'delivered' || (now?.message?.answeredBy === 'copy' && now?.message?.response != null);
      if (now === null) unreadable(['report-after-dispatch'], `messages/view ${report.ref.messageId} 没有回答`);
      else rec.check('report-after-dispatch', reached && refused.length === 0,
        `${dispatchText}；之后发出的上报 ${report.ref.messageId}（${report.view.message.createdAt}）送达 ${delivery ?? '-'}${
          now.delivery?.deliveredTo ? `（${now.delivery.deliveredTo.executionRef?.aggregateType ?? '-'} @ ${now.delivery.deliveredTo.acceptedAt}）` : ''}，answeredBy ${now.message.answeredBy}${refusedText}`);
    }
  }

  // The person's formal architecture change: give the module owning src/api.js a declared parseDate interface.
  const architecture = ready(await host.client.read('architecture/read', project.scope, { selection: { kind: 'current' } }));
  const catalog = architecture?.catalog;
  const module = catalog?.catalog?.modules?.find(entry => entry.paths.some(path => coversPath(path, 'src/api.js'))) ?? catalog?.catalog?.modules?.[0];
  const registrationValue = await registration(ctx, project);
  const pin = { catalogRef: catalog?.ref, baseline: { ref: architecture?.baseline?.ref, digest: architecture?.baseline?.contentDigest } };
  const revised = module === undefined ? null : await host.client.write('architecture/revise', project.scope, {
    expected: pin,
    ops: [{ op: 'add_interface', moduleId: module.ref.moduleId, interface: { id: 'parse-date', description: 'parseDate(text) 返回 Date', paths: ['src/api.js'] } }],
    responsibilityMoves: [], reason: 'G6 E09: 人的决定——parseDate 返回 Date，写成正式接口',
  }, [{ ref: registrationValue.project.ref, revision: registrationValue.project.revision },
    { ref: registrationValue.workspace.ref, revision: registrationValue.workspace.revision }]);
  const catalogVersions = ready(await host.client.read('architecture/versions', project.scope, { limit: 20, cursor: null }));
  rec.check('formal-change', revised?.status === 'committed', `architecture/revise ${revised?.status} ${revised?.code ?? ''} ${revised?.reason ?? ''}；目录版本 ${catalogVersions?.items?.length ?? '?'}`);

  const now = await observation();
  const current = ready(await host.client.read('architecture/read', project.scope, { selection: { kind: 'current' } }));
  const compared = now?.current?.captureRef === undefined ? null : ready(await host.client.read('architecture/compare-formal', project.scope, {
    catalog: { catalogRef: current?.catalog?.ref, baseline: { ref: current?.baseline?.ref, digest: current?.baseline?.contentDigest } },
    captureRef: now.current.captureRef }));
  const findings = compared?.findings ?? [];
  rec.check('drift', findings.some(finding => typeof finding.path === 'string' && finding.path.length > 0),
    `compare-formal ${findings.length} 条 finding；带路径的：${findings.filter(finding => typeof finding.path === 'string').map(finding => finding.path).slice(0, 5).join(', ') || '无'}`);

  // Each work Task's rounds, read by each of its Runs (second review #1); the newest round of a satisfied Task must be
  // PASS with no gap, and no INCONCLUSIVE round may leave its Task satisfied.
  const tasks = ready(await host.client.read('tasks/query', project.scope, { goalRef }))?.tasks ?? [];
  const rounds = [];
  for (const task of tasks.filter(entry => entry.definition?.taskKind !== 'gate')) {
    for (const chain of await taskRounds(project, goalRef, task.ref.taskId)) {
      for (const round of chain.rounds) { rounds.push({ task, round }); rec.link('evidence', round.roundRef, round.revision); }
    }
  }
  // P6 观察点（裁定 Q6，可选）：对方的诊断成为重验的依据。重验轮的 `chain.reverify.newInputRefs` 里的
  // `session_message`（`contracts/verification.ts:196-210`，`no-progress.ts:39-41`），读那条消息的发收线和答复人；
  // 依据消息必须是有答复的询问（P3 的 basisMessage 规则），没有答复却被收下是平台的错。
  const bases = [];
  for (const { task, round } of rounds) {
    for (const input of (round.chain?.reverify?.newInputRefs ?? []).filter(entry => entry.kind === 'session_message')) {
      const view = await messageView(project, input.ref);
      bases.push({ task: task.ref.taskId, round: round.roundRef, ordinal: round.chain?.ordinal ?? null, ref: input.ref, view });
    }
  }
  if (bases.length === 0) notRun(['diagnosis-reverify'], `${rounds.length} 个检查轮里没有一轮的重验以消息为依据（reverify.newInputRefs 没有 session_message），这一支没走到（可选）`);
  else {
    const describe = entry => {
      const message = entry.view?.message;
      const from = message?.sender?.sessionRef?.sessionId ?? null;
      const to = message?.recipient?.sessionId ?? null;
      const responder = message?.response?.sender?.sessionRef?.sessionId ?? null;
      return `${entry.task} 第 ${entry.ordinal ?? '?'} 轮的依据 ${entry.ref.messageId}：${from ?? '-'}（${dutyOf.get(from) ?? '?'}）问 ${to ?? '-'}（${dutyOf.get(to) ?? '?'}），${
        message?.response == null ? '没有答复' : `答复人 ${responder ?? '-'}（${dutyOf.get(responder) ?? '?'}）`}`;
    };
    if (bases.some(entry => entry.view === null)) unreadable(['diagnosis-reverify'], `messages/view 读不到依据消息：${bases.filter(entry => entry.view === null).map(entry => entry.ref.messageId).join(', ')}`);
    else rec.check('diagnosis-reverify', bases.some(entry => entry.view.message.response != null), bases.map(describe).join('；'));
  }
  const newest = new Map(rounds.map(entry => [entry.task.ref.taskId, entry]));
  const satisfied = [...newest.values()].filter(entry => entry.task.effectivePhase === 'satisfied');
  rec.check('rounds', satisfied.length > 0 && satisfied.every(entry => entry.round.outcome === 'PASS' && (entry.round.gaps?.length ?? 0) === 0),
    `satisfied 任务的最新轮：${satisfied.map(entry => `${entry.task.ref.taskId} ${entry.round.outcome}/gaps ${entry.round.gaps?.length ?? 0}`).join(', ') || '无'}${done.stoppedFor === null ? '' : `；目标停下等人：${done.stoppedFor}`}`);
  // S6（lead 11-18）：观测这一格要读完检查轮才判；目标停下等人、没有 PASS 定稿时，自动观测没有触发点。
  const anyPass = rounds.some(entry => entry.round.outcome === 'PASS');
  if (done.stoppedFor !== null && !anyPass) rec.uncover('observation-after-pass', 'not-run', `目标停下等人（${done.stoppedFor}），没有 PASS 定稿，自动观测没有触发点`);
  else rec.check('observation-after-pass', JSON.stringify(now?.current?.captureRef) !== JSON.stringify(afterAdopt?.current?.captureRef),
    `观测：采用后 ${JSON.stringify(afterAdopt?.current?.captureRef ?? null)} → 现在 ${JSON.stringify(now?.current?.captureRef ?? null)}`);
  // C-99: an INCONCLUSIVE round must not leave its Task satisfied by an empty set.
  const inconclusive = rounds.filter(entry => entry.round.outcome === 'INCONCLUSIVE');
  if (inconclusive.length === 0) rec.uncover('uncovered-round', 'not-run', '这次没有出现缺覆盖（INCONCLUSIVE）的检查轮');
  else rec.check('uncovered-round', inconclusive.every(entry => entry.task.effectivePhase !== 'satisfied'
    || (newest.get(entry.task.ref.taskId).round !== entry.round && newest.get(entry.task.ref.taskId).round.outcome === 'PASS')),
    `${inconclusive.length} 个 INCONCLUSIVE 轮，对应任务：${inconclusive.map(entry => entry.task.effectivePhase).join(', ')}`);
  rec.note('8E contact 层：uncovered (8E optional)（只记在这里，不进 uncovered[]；9-start-rulings.frozen.md:966-967）');
  rec.facts.runs = (await executions(project, goalRef)).length;
}

export default { ...def, run };
