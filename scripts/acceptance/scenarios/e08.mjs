// E08: change the Goal's objective/acceptance during execution under `every_step` (draft §1.3; ruling 14:0x §9.1).
// This tree has no dedicated "change goal" route: 6C rides on a Plan candidate (`reason.objective`, new obligations,
// cancelled tasks) adopted only by the person with `plans/apply` (`plan-service.ts:1701-1703`: a candidate that changes
// the objective needs a human adopter), started here with `requests/submit {goalId}`. The secretary's round may answer
// with ideas; the person selects one, and the plan round that follows writes the candidate (G6F F2). `goals/settings/set`
// only sets autonomy (C-126/C-133a).
// Under `every_step` a finished node waits for the person's `nodes/commit` (decision 121-45); `waitGoal` does that
// review from `goals/delivery` for an every_step unit (`flows.mjs` `reviewNodes`).
// P6（lead 11-25）：改需求要在“mul 在跑、sub 还没领”时提交（裁定 Q3）；从提交到采用之前读 sub 的暂缓和 Run 数
// （`hold-before-adopt`，只读不撤，裁定 Q1）；采用时 sub 的 Run 还在跑，平台先停它、回 busy（#7），等 Run 结束再采用；
// 采用后读谁采用、哪个版本、sub 是否取消（`switch`）。
import { newId, ready } from '../lib/http.mjs';
import { queryRunKey, scopeKey } from '../lib/budget.mjs';
import { Abort } from '../lib/report.mjs';
import { answerCard, approve, broken, chooseModel, coldStart, executions, openProject, readRequest, sleep, stalledEntry, submitRequest,
  taskCard, taskRounds, waitFor, waitGoal, waitingCards, waitRequest } from '../lib/flows.mjs';

const MINUTE = 60_000;
/** The hard limit of the wait for the change candidate. */
const CHANGE_WAIT_MS = 30 * MINUTE;
export const SEED = {
  'package.json': '{\n  "name": "g6-e08",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6-e08\n\nA tiny calculator.\n',
  'calc.js': 'export function add(a, b) {\n  return a + b;\n}\n',
};
export const REQUEST = '这个目标用“每步确认”。分两个独立任务：一是在 calc.js 加 sub(a, b) 并加 test/sub.test.js；'
  + '二是在 calc.js 加 mul(a, b) 并加 test/mul.test.js。验收：node --test 全部通过。';
export const CHANGE = '改目标和验收：不要 sub 了（取消那个任务和它的验收）；改为加 div(a, b)，b 为 0 时抛 RangeError，并加 test/div.test.js。mul 照旧。';

const def = {
  id: 'E08',
  rows: ['C-47', 'C-62', 'C-63', 'C-133a', 'C-126', 'C-46', 'C-52', 'C-116', 'C-118', 'C-210'],
  checks: [
    { id: 'autonomy-born', rows: ['C-133a'], text: 'Goal 带草稿里的自治级别生在 revision 1' },
    { id: 'confirm-only-latest', rows: ['C-47'], text: '确认只认最近一次有回答的轮；同一张草稿换 commandId 再确认回 revision_conflict' },
    { id: 'person-adopts', rows: ['C-46', 'C-52'], text: '目标卡和方案由人确认/采用' },
    { id: 'first-adoption', rows: ['C-63', 'C-62'], text: '首次采用写 PlanRevision@1，Goal 指针从 null 变 P1' },
    { id: 'hold-before-adopt', rows: ['C-210'], text: '从说“不要 sub”到采用之前：sub 有秘书放的暂缓（没过期），没有新 Run（只读，驱动不撤）' },
    { id: 'versions', rows: ['C-210'], text: '改前/改后版本与授权可核对（plans/versions 至少两版，改目标的候选由人采用）' },
    { id: 'switch', rows: ['C-210'], text: '受影响任务切到新定义（出现 div 任务，sub 被取消），无关任务继续（mul）；采用版本的取消记录写明 sub→cancelled、采用版本和人' },
    { id: 'old-evidence', rows: ['C-210'], text: '旧证据不满足新义务：div 的义务要求只由改后计划下、div 自己改后 Run 的检查轮覆盖' },
    { id: 'required-cancel', rows: ['C-210'], text: 'required 取消后不因空集合变绿（div 满足之前 Goal 不完成）' },
    { id: 'autonomy-later', rows: ['C-126'], text: '改自治级别只影响之后的动作，不停正在跑的工作' },
    { id: 'control-pins', rows: ['C-116', 'C-118'], text: '控制要同时钉 Goal 和 GoalPhase；少钉一个回 invalid' },
  ],
};

const sameJson = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/** The first plan's Task whose id or title names `word` (sub, mul, div). */
export const taskNamed = (tasks, word) => tasks.find(task => new RegExp(word, 'i').test(`${task.ref.taskId} ${task.definition?.title ?? ''}`));

/** Runs of one Task, every status. A read that does not answer is named in `gaps`. */
export async function runsOf(project, goalRef, taskId, gaps = null) {
  return (await executions(project, goalRef, gaps)).filter(item => item.run.task.taskId === taskId);
}

/**
 * The change request's plan candidate (`plans/request-candidate`), with the person answering every card but the
 * candidate itself meanwhile (P6 risk: the secretary's request round may `ask_person` first; under P2 the answer wakes
 * the asking line, which then writes the candidate). The candidate card is left for the person's own `plans/apply`.
 * A request whose last round closed without a candidate ends the wait at once (as `waitCandidate`, flows.mjs).
 * `onPoll` lets the caller read what it watches meanwhile.
 */
export async function waitChangeCandidate(ctx, project, goalRef, requestRoot, rec, { check, timeoutMs = CHANGE_WAIT_MS, onPoll,
  done = value => value?.head !== null && value?.head !== undefined && value.status === 'candidate', judge = true } = {}) {
  const answered = new Set();
  let closed = null;
  const read = async () => {
    for (const card of await waitingCards(project, goalRef, rec)) {
      if (card.source.kind === 'candidate' || answered.has(card.cardKey)) continue;
      const selection = approve(card);
      if (selection === null) continue;
      if (await answerCard(ctx, project, card, selection, '', rec)) {
        answered.add(card.cardKey);
        rec.note(`while the change candidate was written the person answered ${card.source.kind} card ${card.cardKey}`);
      }
    }
    if (onPoll !== undefined) await onPoll();
    const last = (await readRequest(project, requestRoot))?.rounds.at(-1);
    closed = last !== undefined && (last.status === 'ended' || last.status === 'unknown') && last.closeCode != null
      ? `the request's last round ${last.ref.queryJobId} closed without a candidate: ${last.closeCode}${last.closeMessage ? ` (${last.closeMessage})` : ''}`
      : null;
    return ready(await project.host.client.read('plans/request-candidate', project.scope, { goalRef, requestRef: requestRoot }));
  };
  if (judge) {
    return waitFor(ctx, 'the changed plan candidate', read, done, { timeoutMs, check,
      ended: async () => closed ?? await stalledEntry(ctx, project) });
  }
  // lead 11-25 (E08b, P6 run: the model answered in prose, no candidate ever came, the 30-minute wait judged
  // adopt-after-end fail): without a candidate nothing is adopted, so this wait judges nothing and returns null — on
  // the timeout, on a round closed without a candidate, or once the request's last round has settled and no Query of
  // the project has been in flight for 5 minutes (nothing left that could still write the candidate).
  const deadline = Date.now() + timeoutMs;
  let idleSince = null;
  for (;;) {
    await ctx.budget.tick();
    const value = await read();
    if (done(value)) return value;
    const last = (await readRequest(project, requestRoot))?.rounds.at(-1);
    const settledRound = last !== undefined && (last.status === 'ended' || last.status === 'unknown');
    const quiet = settledRound && ctx.budget.inFlight({ scopes: [scopeKey(project.scope)] }).queries === 0;
    idleSince = quiet ? idleSince ?? Date.now() : null;
    const why = closed ?? await stalledEntry(ctx, project) ?? (idleSince !== null && Date.now() - idleSince >= 5 * MINUTE
      ? `the request's last round ${last.ref?.queryJobId ?? '-'} ended without a candidate and no Query ran for 5 min`
      : Date.now() > deadline ? `no candidate after ${Math.round(timeoutMs / MINUTE)} min` : null);
    if (why !== null) { rec.note(`改需求没有候选：${why}`); return null; }
    await sleep(10_000);
  }
}

/**
 * P6I D2, r3 (lead 11-27): the change candidate read once more after the wait gave up, and whose it is when there is
 * none. The wait's last read can miss a candidate written a moment later, so an adoptable head read here goes back to
 * the caller (`candidate`), which adopts it as usual; past the wait's hard limit (`pastDeadline`) it is a timeout
 * instead, written with the state read. A failed read is written as that, and a head in another state (stale, not
 * adopted) with its state. Only a read that answers with no head at all is a missing candidate: `changeRoundOwner`.
 */
export async function lastChangeCandidate(project, goalRef, requestRoot, { pastDeadline }) {
  const late = pastDeadline ? `改需求的候选过了 ${CHANGE_WAIT_MS / MINUTE} 分钟的等待时限（超时）；` : '';
  const missing = (owner, text) => ({ candidate: null, owner, text: `${late}${text}` });
  const candidateBody = await project.host.client.read('plans/request-candidate', project.scope, { goalRef, requestRef: requestRoot });
  const candidate = ready(candidateBody);
  if (candidate === null) {
    return missing('unknown', `改需求的候选读不到（${candidateBody?.status ?? '没答'} ${candidateBody?.code ?? ''} ${candidateBody?.reason ?? ''}）`);
  }
  if (candidate.head !== null && candidate.head !== undefined) {
    if (candidate.status !== 'candidate') return missing('unknown', `改需求的候选在，状态是 ${candidate.status}，不是 candidate`);
    if (!pastDeadline) return { candidate, owner: null, text: null };
    return missing('unknown', '最后一次复读才读到候选，状态 candidate');
  }
  const round = await changeRoundOwner(project, requestRoot);
  return missing(round.owner, round.text);
}

/**
 * P6I D2: whose a change without a candidate is, read from the change's last round (not a routing round, not one
 * absorbed into another) by its own `queries/read` and checked against its full Job and Run refs. A Run that ended
 * `not_entered` (a refused preparation, a stop, a drop) is the platform's; a round with an answer, or whose Run shows it
 * entered (its execution history), ran and wrote no candidate: the model's. A round still before entry says so; any
 * other end without that evidence (an `unknown` Run, a Kernel that could not be read) cannot show whether it entered.
 */
async function changeRoundOwner(project, requestRoot) {
  const last = (await readRequest(project, requestRoot))?.rounds.filter(round => round.kind !== 'routing' && round.absorbedInto === null).at(-1);
  if (last === undefined) return { owner: 'unknown', text: 'requests/read 读不到改需求的轮' };
  const read = ready(await project.host.client.read('queries/read', project.scope, last.ref));
  if (read === null || !sameJson(read.job?.ref, last.ref) || queryRunKey(read.run?.ref) !== queryRunKey(last.runRef)) {
    return { owner: 'unknown', text: `轮 ${last.ref.queryJobId} 本身读不到（queries/read 没答，或 Job/Run 引用对不上）` };
  }
  const id = last.ref.queryJobId;
  const { job } = read.job;
  const { run } = read.run;
  if (run.outcome === 'not_entered') {
    return { owner: 'platform', text: `轮 ${id} 没进入 Kernel 就结束了（${job.closeReason?.code ?? '-'}：${job.closeReason?.message ?? ''}）` };
  }
  if (job.answerRefs.length > 0 || (run.executionState?.history ?? null) !== null) {
    return { owner: 'model', text: `轮 ${id} 跑了，没交 submit_plan_round` };
  }
  const phase = run.executionState?.phase ?? null;
  if (run.status === 'pending' && (phase === null || phase === 'claimed' || phase === 'prepared')) {
    return { owner: 'unknown', text: `轮 ${id} 是 ${job.status}/${phase ?? '未领取'}，还没进入 Kernel` };
  }
  return { owner: 'unknown', text: `轮 ${id} 是 ${job.status}/${run.status}/${run.outcome ?? phase ?? '-'}，无法确认是否进入 Kernel` };
}

/**
 * P6 #7: the person's `plans/apply` of the change candidate. When a Run of an affected Task is still running, the
 * platform first stops it and answers `busy` (`stopping_affected_work`) without writing the plan
 * (`plan-adoption-stop.ts:8-19`, `:64`, `:102`); the person waits until those Runs end (here: the Runs of `taskIds`)
 * and adopts again with the re-read Goal and candidate revisions. At most three tries. Returns the last answer, the
 * busy answers seen (`busy[]`, each with its time) and the head that was applied.
 */
export async function applyChange(ctx, project, goalRef, requestRoot, head, taskIds, rec, check) {
  const client = project.host.client;
  const busy = [];
  let current = head;
  let applied = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const goal = ready(await client.read('goals/read', project.scope, goalRef));
    if (goal === null) throw broken(ctx, `goals/read of ${goalRef.goalId} did not answer before plans/apply`, check);
    applied = await client.write('plans/apply', project.scope,
      { proposalRef: current.ref, expectedProposalRevision: current.revision, decisionRefs: [] },
      [{ ref: goalRef, revision: goal.goal.revision }], { expect: ['busy'] });
    if (applied?.status !== 'rejected' || applied.code !== 'busy') break;
    busy.push({ at: new Date().toISOString(), reason: applied.reason ?? '' });
    rec.note(`plans/apply busy (try ${attempt + 1}): ${applied.reason ?? ''}; the person waits for the affected Runs to end and adopts again`);
    await waitFor(ctx, 'the affected Runs to end after a busy adoption', async () => {
      const live = [];
      for (const taskId of taskIds) live.push(...(await runsOf(project, goalRef, taskId)).filter(item => item.run.status !== 'ended'));
      return live.length;
    }, count => count === 0, { timeoutMs: 20 * MINUTE, check });
    const again = ready(await client.read('plans/request-candidate', project.scope, { goalRef, requestRef: requestRoot }));
    if (again?.head !== null && again?.head !== undefined) current = again.head;
  }
  return { applied, busy, head: current };
}

/**
 * The adopted version's record of one Task's disposition change (`tasks/query` with the adopted `planRef`,
 * `plan.dispositionRecord.entries`, `contracts/plan.ts:120-144`) and who adopted the candidate (`plans/proposal`
 * `adoptedBy`, `plan-contracts.ts:39`). `entry` is null when the version has no record for the Task.
 */
export async function dispositionOf(project, goalRef, adoptedPlan, taskId) {
  const graph = ready(await project.host.client.read('tasks/query', project.scope, { goalRef, planRef: adoptedPlan }));
  if (graph === null) return { readable: false, entry: null, proposal: null };
  const entry = (graph.plan?.dispositionRecord?.entries ?? []).find(item => item.taskId === taskId) ?? null;
  const proposal = entry === null ? null : ready(await project.host.client.read('plans/proposal', project.scope, entry.proposalRef));
  return { readable: true, entry, proposal };
}

/** The three facts of a cancellation record: `to === 'cancelled'`, `setIn` the adopted version, `actor` a person. */
export function cancelRecordText(record, adoptedPlan) {
  const entry = record.entry;
  const ok = entry !== null && entry.to === 'cancelled' && sameJson(entry.setIn, adoptedPlan) && entry.actor?.kind === 'human';
  const text = !record.readable ? 'tasks/query 读不到采用版本'
    : entry === null ? '采用版本的 dispositionRecord 里没有 sub 的记录'
      : `记录 ${entry.from}→${entry.to}，setIn ${entry.setIn?.planId}@${entry.setIn?.revision ?? '-'}（采用 ${adoptedPlan?.planId}），actor ${entry.actor?.kind}/${entry.actor?.id ?? '-'}；候选 adoptedBy ${record.proposal?.adoptedBy?.kind ?? '-'}/${record.proposal?.adoptedBy?.id ?? '-'}`;
  return { ok, text };
}

/**
 * After the Goal wait, judge the adopted div Task's own post-change rounds. The newest Run with a round (by claim
 * time, `taskRounds`) decides; an unreadable run list or round is `env-unavailable` and never falls back to an older
 * round. A missing round is `not-run` while the Goal still waits and `fail` once it completed. Read the round by
 * `roundRef` so its version is the round's own adopted Plan, not the Run's Plan.
 */
async function judgeOldEvidence(project, goalRef, adoptedPlan, div, completed, rec) {
  const gaps = [];
  const [latest] = await taskRounds(project, goalRef, div.ref.taskId, gaps, { latest: true });
  if (gaps.length > 0) {
    rec.uncover('old-evidence', 'env-unavailable', gaps.join('；'));
    return;
  }
  if (latest === undefined) {
    if (completed) rec.fail('old-evidence', 'Goal 已完成，div 没有检查轮');
    else rec.uncover('old-evidence', 'not-run', 'Goal 等待结束时 div 还没有检查轮');
    return;
  }

  const head = ready(await project.host.client.read('verification/round', project.scope, { roundRef: latest.head.roundRef }));
  if (head === null) {
    rec.uncover('old-evidence', 'env-unavailable', '按 roundRef 读不到 div 的检查轮');
    return;
  }
  rec.link('evidence', head.roundRef, head.revision);
  const required = head.delivery.requirements.filter(entry => entry.requirementLevel === 'required');
  const states = required.map(entry => `${entry.obligationId}/${entry.requirementId}:${entry.state}`).join('；');
  const note = `div Run ${head.subjectRunRef.runId}；检查轮计划 ${head.planRef.planId}；采用 ${adoptedPlan.planId}；${states || '没有必需要求'}`;
  if (!sameJson(latest.item.run.planRef, adoptedPlan) || !sameJson(head.planRef, adoptedPlan)
    || required.length === 0 || required.some(entry => ['fail', 'missing', 'inconclusive'].includes(entry.state))) {
    rec.fail('old-evidence', note);
  } else if (required.some(entry => entry.state === 'pending')) {
    if (completed) rec.fail('old-evidence', `Goal 已完成，div 的必需要求仍未结算；${note}`);
    else rec.uncover('old-evidence', 'not-run', note);
  } else rec.pass('old-evidence', note);
}

async function run(ctx, rec) {
  const host = ctx.hosts['w-accept'];
  const project = await openProject(ctx, host, 'e08', SEED);
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, host, project);
  rec.facts.userCommand = [REQUEST];
  const started = await coldStart(ctx, project, REQUEST, rec);
  const goalRef = started.goalRef;
  const born = ready(await host.client.read('goals/read', project.scope, goalRef));
  // `draftAutonomy` is the Goal's level read right after the adoption, before any change (flows `settleAutonomy`).
  rec.check('autonomy-born', started.binding.goalRevision === 1 && rec.facts.draftAutonomy === started.draft.draft.autonomy,
    `草稿自治 ${started.draft.draft.autonomy}；Goal 生在版本 ${started.binding.goalRevision}，采用后读到 ${rec.facts.draftAutonomy}`);
  const again = await host.client.command('goals/confirm-draft', project.scope,
    { commandId: newId('confirm-again'), round: started.round.ref, index: started.draft.index }, { expect: ['revision_conflict'] });
  rec.check('confirm-only-latest', again?.code === 'revision_conflict', `同一草稿换 commandId 再确认：${again?.status} ${again?.code ?? ''}`);
  rec.check('first-adoption', started.plan !== null && born?.goal?.activePlanRevision !== null,
    `采用回执 plan ${started.plan?.planId}；Goal 指针 ${JSON.stringify(born?.goal?.activePlanRevision ?? null)}`);
  rec.check('person-adopts', !started.goalsBeforeConfirm.includes(goalRef.goalId),
    `人确认之前 goals/list 里没有这个 Goal（${started.goalsBeforeConfirm.length} 个旧 Goal）；首方案由人 initialization/adopt`);

  // C-126: when the draft chose another level, the cold start set `every_step` right after adoption; that change must
  // not stop or cancel work already started.
  if (rec.facts.draftAutonomy === 'every_step') {
    rec.uncover('autonomy-later', 'not-run', '草稿本来就是 every_step，这次没有中途改档');
  } else {
    const runs = await executions(project, goalRef);
    rec.check('autonomy-later', born?.goal?.settings?.autonomy === 'every_step' && runs.every(item => item.run.outcome !== 'cancelled'),
      `草稿 ${rec.facts.draftAutonomy} → 采用后改为 ${born?.goal?.settings?.autonomy}；已有 Run ${runs.length} 个，没有被取消的`);
  }

  // Probe the control pins: a pause with only the Goal pin must be refused as invalid (C-116).
  const goalNow = ready(await host.client.read('goals/read', project.scope, goalRef));
  const onePin = await host.client.write('goals/control', project.scope, { goalRef, control: 'pause', reason: 'G6 E08 pin probe' },
    [{ ref: goalRef, revision: goalNow.goal.revision }], { expect: ['invalid'] });
  rec.check('control-pins', onePin?.code === 'invalid', `只钉 Goal 的暂停：${onePin?.status} ${onePin?.code ?? ''}`);

  // The first plan's sub and mul (by id or title).
  const firstTasks = ready(await host.client.read('tasks/query', project.scope, { goalRef, planRef: started.plan }))?.tasks ?? [];
  const subTask = taskNamed(firstTasks, 'sub');
  const mulTask = taskNamed(firstTasks, 'mul');
  const subId = subTask?.ref.taskId ?? null;
  const mulId = mulTask?.ref.taskId ?? null;
  rec.note(`first plan ${started.plan?.planId}: sub = ${subId ?? '无'}，mul = ${mulId ?? '无'}`);

  // P6 裁定 Q3: the change goes in while mul works and sub is not claimed yet (sub really claimable, another piece of
  // work moving). Under every_step a step may wait for the person's card: the person answers while waiting.
  const answeredFirst = new Set();
  const moment = await waitFor(ctx, 'mul running while sub is not claimed yet', async () => {
    for (const card of await waitingCards(project, goalRef, rec)) {
      const selection = approve(card);
      if (answeredFirst.has(card.cardKey) || selection === null) continue;
      if (await answerCard(ctx, project, card, selection, '', rec)) answeredFirst.add(card.cardKey);
    }
    const runs = await executions(project, goalRef);
    const of = taskId => runs.filter(item => item.run.task.taskId === taskId);
    return { total: runs.length, mul: mulId === null ? [] : of(mulId), sub: subId === null ? [] : of(subId) };
  }, value => subId === null || mulId === null ? value.total > 0 : value.sub.length > 0 || value.mul.length > 0,
  { timeoutMs: 40 * MINUTE, check: 'hold-before-adopt' });
  const subCardAtChange = subId === null ? null : await taskCard(project, goalRef, subId);
  rec.note(`提交前最近一次轮询：mul ${moment.mul.length} 个 Run（${moment.mul.map(item => item.run.status).join(',') || '-'}），sub ${moment.sub.length} 个 Run；sub 的 dispatch.claimableNow ${
    subCardAtChange === null ? '读不到' : String(subCardAtChange.dispatch?.claimableNow)}`);

  const submittedAt = Date.now();
  const change = await submitRequest(project, CHANGE, { goalId: goalRef.goalId });
  if (change?.status !== 'queued') throw broken(ctx, `requests/submit with goalId: ${change?.code} ${change?.reason}`);
  rec.facts.userCommand.push(CHANGE);
  // A Run of sub already existed when the change went in, so the secretary cannot place its "not yet started" hold
  // any more. The Outbox keeps each Run's own claim while a later Run may hold the Task's lease: a Run seen before
  // the submission is part of the baseline, and so is any other claim strictly earlier than the sending.
  const claimsBeforeSubmit = new Map(moment.sub.map(({ run, outbox }) =>
    [run.ref.runId, Date.parse(outbox.claim.claimedAt)]));
  const claimReadGaps = [];
  const subAtSubmit = subId === null ? [] : await runsOf(project, goalRef, subId, claimReadGaps);
  let sameMillisecondClaim = false;
  for (const { run, outbox } of subAtSubmit) {
    const claimedAt = Date.parse(outbox.claim.claimedAt);
    if (claimedAt < submittedAt) claimsBeforeSubmit.set(run.ref.runId, claimedAt);
    if (claimedAt === submittedAt) sameMillisecondClaim = true;
  }
  const subRuns0 = claimsBeforeSubmit.size;
  if (subId === null) rec.uncover('hold-before-adopt', 'not-run', '首版计划里认不出 sub 任务');
  else if (subRuns0 > 0) {
    const seconds = ((submittedAt - Math.min(...claimsBeforeSubmit.values())) / 1000).toFixed(3);
    rec.uncover('hold-before-adopt', 'not-run', `sub 在提交改需求前 ${seconds} s 被领（提交时至少已有 ${subRuns0} 个 Run）`);
  } else if (sameMillisecondClaim) {
    rec.uncover('hold-before-adopt', 'not-run', 'sub 领取与提交同毫秒，未能确认提交时尚可暂缓');
  } else if (claimReadGaps.length > 0) {
    rec.uncover('hold-before-adopt', 'env-unavailable', claimReadGaps.join('；'));
  }
  rec.facts.changeMoment = { mulRuns: moment.mul.length, subRuns: subRuns0, claimableNow: subCardAtChange?.dispatch?.claimableNow ?? null };

  const changeView = await waitRequest(ctx, project, change.requestRoot, 40 * MINUTE);
  // The person's decision on the change starts with an idea (G6F F2): the first one of the round that gave ideas.
  const ideasRound = changeView.rounds.at(-1);
  if (ideasRound.ideas.length > 0) {
    const picked = await host.client.command('requests/select-idea', project.scope, { commandId: newId('idea'), round: ideasRound.ref, index: 0 });
    if (picked?.status !== 'queued') throw broken(ctx, `requests/select-idea on the change: ${picked?.code} ${picked?.reason}`, 'versions');
    rec.note(`the person selected idea 1 of ${ideasRound.ideas.length} on the change: ${ideasRound.ideas[0].title}`);
    await waitRequest(ctx, project, change.requestRoot, 40 * MINUTE);
  }
  // P6 diagnosis 2 #10/#11: no candidate is still `versions` fail (lead); P6I D2: it names the platform when the change
  // round never ran, else the model. What sub's task card shows at that moment (the secretary's hold, sub's Runs) goes
  // into the notes. P6I r3: before that the candidate is read once more, and one adoptable within the hard limit is
  // adopted as usual (the wait's last read can miss a candidate written a moment later).
  const changeWaitEnds = Date.now() + CHANGE_WAIT_MS;
  let candidate = await waitChangeCandidate(ctx, project, goalRef, change.requestRoot, rec, { judge: false, timeoutMs: CHANGE_WAIT_MS });
  if (candidate === null) {
    const last = await lastChangeCandidate(project, goalRef, change.requestRoot, { pastDeadline: Date.now() > changeWaitEnds });
    if (last.candidate === null) {
      const card = subId === null ? null : await taskCard(project, goalRef, subId);
      const holds = (card?.holds ?? []).map(hold => `${hold.kind}/${hold.state}${hold.expired ? '/expired' : ''} by ${hold.placedBy?.kind}${
        hold.placedBy?.duty ? `:${hold.placedBy.duty}` : ''}@${hold.placedAt}`).join('；') || '无';
      const subRunsNow = subId === null ? '-' : (await runsOf(project, goalRef, subId)).length;
      rec.note(`E08 没有候选时 sub 的任务卡：暂缓 ${holds}；sub 的 Run ${subRunsNow} 个（hold-before-adopt 没走到采用前那一步，不改判）`);
      rec.fail('versions', last.owner === 'platform'
        ? `平台没有把改需求的轮跑起来：${last.text}（见 notes 的“改需求没有候选”），没有可由人采用的改后版本`
        : last.owner === 'model'
          ? `模型没有写出改需求的候选（${last.text}，见 notes 的“改需求没有候选”），没有可由人采用的改后版本`
          : `改需求没有候选：${last.text}（见 notes 的“改需求没有候选”），没有可由人采用的改后版本`);
      throw new Abort('not-run', last.owner === 'model' ? 'no change candidate: the model wrote none'
        : `no change candidate: ${last.owner === 'platform' ? 'the platform did not run the round' : 'the round state'} (${last.text})`);
    }
    rec.note(`改需求的候选在等待结束后的最后一次复读里读到（${last.candidate.head.ref?.proposalId ?? '-'}），照常由人采用`);
    candidate = last.candidate;
  }

  // hold-before-adopt (P6 observation, read only): before the person adopts, sub carries the secretary's own hold
  // (`hold_claim`, `skill-platform-secretary.txt:27`), held and not expired (`work-line.ts:373-404`), and no new Run.
  if (!rec.results.has('hold-before-adopt')) {
    const card = await taskCard(project, goalRef, subId);
    const claimReadGaps = [];
    const subRunsNow = (await runsOf(project, goalRef, subId, claimReadGaps)).length;
    if (card === null) rec.uncover('hold-before-adopt', 'env-unavailable', 'graph/detail 读不到 sub 的任务卡');
    else if (claimReadGaps.length > 0) rec.uncover('hold-before-adopt', 'env-unavailable', claimReadGaps.join('；'));
    else {
      const holds = card.holds ?? [];
      const secretaryHold = holds.find(hold => hold.state === 'held' && hold.expired !== true && hold.placedBy?.kind === 'agent'
        && hold.placedBy?.duty === 'secretary');
      const listed = holds.map(hold => `${hold.kind}/${hold.state}${hold.expired ? '/expired' : ''} by ${hold.placedBy?.kind}${hold.placedBy?.duty ? `:${hold.placedBy.duty}` : ''}「${hold.reason}」`).join('；') || '无';
      // lead 11-25: no hold from the secretary is judged `fail` — the step was reached and what should happen did not.
      rec.check('hold-before-adopt', secretaryHold !== undefined && subRunsNow === subRuns0,
        `候选写出后、采用前：sub 的暂缓 ${listed}；sub 的 Run ${subRuns0} → ${subRunsNow}；claimableNow ${String(card.dispatch?.claimableNow)}${
          secretaryHold === undefined ? '；秘书没放暂缓（到了这一步、该发生没发生，不是没走到）' : ''}`);
      if (secretaryHold === undefined) rec.note('E08 hold-before-adopt：秘书没放暂缓（候选已写出、采用之前读的 sub 任务卡；不是没走到）');
    }
  }

  const { applied, busy } = await applyChange(ctx, project, goalRef, change.requestRoot, candidate.head, subId === null ? [] : [subId], rec, 'versions');
  rec.link('plan', applied?.value?.ref ?? null, applied?.value?.revision ?? null);
  if (applied?.status !== 'committed') throw broken(ctx, `plans/apply of the change: ${applied?.code} ${applied?.reason}`, 'versions');
  const adoptedPlan = applied.value.ref;
  if (busy.length > 0) rec.note(`采用前平台停了受影响的 Run（busy ${busy.length} 次：${busy.map(entry => entry.reason).join('；')}）`);
  // Judge `versions` first, while the adoption receipt is fresh. A failed read is an environment gap;
  // only a list that was read but has fewer than two versions is a missing version.
  const versionsBody = await host.client.read('plans/versions', project.scope, { goalId: goalRef.goalId, limit: 50, cursor: null });
  const versions = ready(versionsBody);
  if (versions === null) rec.uncover('versions', 'env-unavailable', `plans/versions 读不到：${versionsBody?.status ?? 'no answer'} ${versionsBody?.code ?? ''}`);
  else rec.check('versions', versions.items.length >= 2,
    `plans/versions ${versions.items.length} 版；改目标的候选由人 plans/apply（${applied.status}，采用 ${JSON.stringify(adoptedPlan)}）`);
  // Judge the switch on the adopted version itself, before later Runs change the active graph. A read failure is not
  // an empty graph, and a `superseded` record must name div as the replacement.
  const adoptedInput = { goalRef, planRef: adoptedPlan };
  let adoptedBody = await host.client.read('tasks/query', project.scope, adoptedInput);
  let adoptedGraph = ready(adoptedBody);
  const adoptedTasks = adoptedGraph?.tasks ?? [];
  const divAtAdoption = taskNamed(adoptedTasks, 'div');
  if (adoptedGraph === null) {
    const note = `tasks/query ${adoptedPlan.planId}：${adoptedBody?.status ?? 'no answer'} ${adoptedBody?.code ?? ''}`;
    rec.uncover('switch', 'env-unavailable', note);
  } else {
    const sub = adoptedTasks.find(task => task.ref.taskId === subId);
    const mul = adoptedTasks.find(task => task.ref.taskId === mulId);
    const entry = adoptedGraph.plan.dispositionRecord?.entries.find(row => row.taskId === subId);
    const replacement = entry?.replacedByTaskId;
    const switched = entry !== undefined && sameJson(entry.setIn, adoptedPlan) && entry.actor.kind === 'human'
      && ((sub?.disposition === 'cancelled' && entry.to === 'cancelled')
        || (sub?.disposition === 'superseded' && entry.to === 'superseded' && replacement === divAtAdoption?.ref.taskId));
    rec.check('switch', divAtAdoption !== undefined && mul?.disposition === 'active' && switched,
      `div ${divAtAdoption?.ref.taskId ?? '无'}；sub ${sub?.disposition ?? '无'}；mul ${mul?.disposition ?? '无'}；记录 ${entry?.to ?? '无'}；接替 ${replacement ?? '无'}；版本 ${entry?.setIn.planId ?? '无'}；采用者 ${entry?.actor.kind ?? '无'}`);
  }
  // 每步确认和返工由 Goal 等待处理。`check: null` 只让这个等待不把停因记成某条判据的 fail（平台合法停下由 `stoppedFor`
  // 说明）；各判据仍按上面的采用版本和 finally 里的检查轮读法判，等待停下也读取已经落下的验收证据。
  let completedWhileDivOpen = false;
  let done;
  try {
    done = await waitGoal(ctx, project, goalRef, { timeoutMs: 150 * MINUTE, rec, answer: approve,
      returnOnDecide: true, check: null, onPoll: async display => {
        if (display?.display?.phase !== 'COMPLETED') return;
        const tasks = ready(await host.client.read('tasks/query', project.scope, { goalRef }))?.tasks ?? [];
        if (taskNamed(tasks, 'div')?.effectivePhase !== 'satisfied') completedWhileDivOpen = true;
      } });
  } finally {
    if (adoptedGraph === null) {
      adoptedBody = await host.client.read('tasks/query', project.scope, adoptedInput);
      adoptedGraph = ready(adoptedBody);
    }
    const div = taskNamed(adoptedGraph?.tasks ?? [], 'div');
    const completed = done?.display.phase === 'COMPLETED';
    if (adoptedGraph === null) {
      rec.uncover('old-evidence', 'env-unavailable', `tasks/query ${adoptedPlan.planId}：${adoptedBody?.status ?? 'no answer'} ${adoptedBody?.code ?? ''}`);
    } else if (div !== undefined) {
      await judgeOldEvidence(project, goalRef, adoptedPlan, div, completed, rec);
    } else if (completed) {
      rec.fail('old-evidence', 'Goal 已完成，采用版没有 div 检查轮');
    } else {
      rec.uncover('old-evidence', 'not-run', 'Goal 等待结束时，采用版没有 div 可检查');
    }
  }
  // lead 11-18：采用的改目标版本里没有被拿掉的必需任务时，这条判据没有对象，记 not-run，不空过。
  const finalTasks = ready(await host.client.read('tasks/query', project.scope, { goalRef }))?.tasks ?? [];
  const removed = (adoptedGraph?.tasks ?? []).filter(task => task.definition?.taskKind === 'work'
    && task.definition?.requirementLevel === 'required' && ['cancelled', 'superseded'].includes(task.disposition));
  const finalDiv = taskNamed(finalTasks, 'div');
  const finalSub = subId === null ? taskNamed(finalTasks, 'sub') : finalTasks.find(task => task.ref.taskId === subId);
  if (done.stoppedFor !== null) {
    rec.uncover('required-cancel', 'not-run', `平台停在等人（${done.stoppedFor}），Goal 没有 COMPLETED；div 满足前不完成这一条没有对象`);
  } else if (adoptedGraph === null) rec.uncover('required-cancel', 'env-unavailable', `tasks/query ${adoptedPlan.planId}：${adoptedBody?.status ?? 'no answer'} ${adoptedBody?.code ?? ''}`);
  else if (removed.length === 0) {
    rec.uncover('required-cancel', 'not-run', `采用的版本 ${adoptedPlan.planId} 里没有被取消或接替的必需任务（sub ${finalSub === undefined ? '不在' : finalSub.disposition}），这条判据没有对象`);
  } else rec.check('required-cancel', finalDiv !== undefined && finalDiv.effectivePhase === 'satisfied' && !completedWhileDivOpen && done.display.phase === 'COMPLETED',
    `被拿掉的必需任务 ${removed.map(task => task.ref.taskId).join(', ')}；最后 ${done.display.phase}；div ${finalDiv?.effectivePhase ?? '不存在'}；div 缺失或没满足时出现过 COMPLETED：${completedWhileDivOpen}`);
}

export default { ...def, run };
