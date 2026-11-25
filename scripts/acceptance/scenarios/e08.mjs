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
import { scopeKey } from '../lib/budget.mjs';
import { Abort } from '../lib/report.mjs';
import { answerCard, approve, broken, chooseModel, coldStart, executions, openProject, readRequest, sleep, submitRequest, taskCard,
  taskRounds, waitFor, waitGoal, waitingCards, waitRequest } from '../lib/flows.mjs';

const MINUTE = 60_000;
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

/** Runs of one Task, every status. */
export async function runsOf(project, goalRef, taskId) {
  return (await executions(project, goalRef)).filter(item => item.run.task.taskId === taskId);
}

/**
 * The change request's plan candidate (`plans/request-candidate`), with the person answering every card but the
 * candidate itself meanwhile (P6 risk: the secretary's request round may `ask_person` first; under P2 the answer wakes
 * the asking line, which then writes the candidate). The candidate card is left for the person's own `plans/apply`.
 * A request whose last round closed without a candidate ends the wait at once (as `waitCandidate`, flows.mjs).
 * `onPoll` lets the caller read what it watches meanwhile.
 */
export async function waitChangeCandidate(ctx, project, goalRef, requestRoot, rec, { check, timeoutMs = 30 * MINUTE, onPoll,
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
  if (judge) return waitFor(ctx, 'the changed plan candidate', read, done, { timeoutMs, check, ended: () => closed });
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
    const why = closed ?? (idleSince !== null && Date.now() - idleSince >= 5 * MINUTE
      ? `the request's last round ${last.ref?.queryJobId ?? '-'} ended without a candidate and no Query ran for 5 min`
      : Date.now() > deadline ? `no candidate after ${Math.round(timeoutMs / MINUTE)} min` : null);
    if (why !== null) { rec.note(`改需求没有候选：${why}`); return null; }
    await sleep(10_000);
  }
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
  // work moving). Under every_step a step may wait for the person's card: the person answers while waiting. If sub is
  // claimed first, the hold branch is recorded `uncovered` and the scenario goes on.
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
  const subClaimedFirst = subId !== null && moment.sub.length > 0;
  const subCardAtChange = subId === null ? null : await taskCard(project, goalRef, subId);
  const subRuns0 = moment.sub.length;
  rec.facts.changeMoment = { mulRuns: moment.mul.length, subRuns: subRuns0, claimableNow: subCardAtChange?.dispatch?.claimableNow ?? null };
  rec.note(`提交改需求时：mul ${moment.mul.length} 个 Run（${moment.mul.map(item => item.run.status).join(',') || '-'}），sub ${subRuns0} 个 Run；sub 的 dispatch.claimableNow ${
    subCardAtChange === null ? '读不到' : String(subCardAtChange.dispatch?.claimableNow)}`);

  const change = await submitRequest(project, CHANGE, { goalId: goalRef.goalId });
  if (change?.status !== 'queued') throw broken(ctx, `requests/submit with goalId: ${change?.code} ${change?.reason}`);
  rec.facts.userCommand.push(CHANGE);
  const changeView = await waitRequest(ctx, project, change.requestRoot, 40 * MINUTE);
  // The person's decision on the change starts with an idea (G6F F2): the first one of the round that gave ideas.
  const ideasRound = changeView.rounds.at(-1);
  if (ideasRound.ideas.length > 0) {
    const picked = await host.client.command('requests/select-idea', project.scope, { commandId: newId('idea'), round: ideasRound.ref, index: 0 });
    if (picked?.status !== 'queued') throw broken(ctx, `requests/select-idea on the change: ${picked?.code} ${picked?.reason}`, 'versions');
    rec.note(`the person selected idea 1 of ${ideasRound.ideas.length} on the change: ${ideasRound.ideas[0].title}`);
    await waitRequest(ctx, project, change.requestRoot, 40 * MINUTE);
  }
  // P6 diagnosis 2 #10/#11: no candidate is still `versions` fail (lead), but in the model's terms, not "the platform
  // did not do it"; what sub's task card shows at that moment (the secretary's hold, sub's Runs) goes into the notes.
  const candidate = await waitChangeCandidate(ctx, project, goalRef, change.requestRoot, rec, { judge: false });
  if (candidate === null) {
    const card = subId === null ? null : await taskCard(project, goalRef, subId);
    const holds = (card?.holds ?? []).map(hold => `${hold.kind}/${hold.state}${hold.expired ? '/expired' : ''} by ${hold.placedBy?.kind}${
      hold.placedBy?.duty ? `:${hold.placedBy.duty}` : ''}@${hold.placedAt}`).join('；') || '无';
    const subRunsNow = subId === null ? '-' : (await runsOf(project, goalRef, subId)).length;
    rec.note(`E08 没有候选时 sub 的任务卡：暂缓 ${holds}；sub 的 Run ${subRunsNow} 个（hold-before-adopt 没走到采用前那一步，不改判）`);
    rec.fail('versions', '模型没有写出改需求的候选（改需求的轮没交 submit_plan_round，见 notes 的“改需求没有候选”），没有可由人采用的改后版本');
    throw new Abort('not-run', 'no change candidate: the model wrote none');
  }

  // hold-before-adopt (P6 observation, read only): before the person adopts, sub carries the secretary's own hold
  // (`hold_claim`, `skill-platform-secretary.txt:27`), held and not expired (`work-line.ts:373-404`), and no new Run.
  if (subId === null) rec.uncover('hold-before-adopt', 'not-run', '首版计划里认不出 sub 任务');
  else if (subClaimedFirst) {
    rec.uncover('hold-before-adopt', 'not-run', `sub 在 mul 之前先被领了（提交改需求时 sub 已有 ${subRuns0} 个 Run），“sub 可领、没开工时暂缓”这一支没走到`);
  } else {
    const card = await taskCard(project, goalRef, subId);
    const subRunsNow = (await runsOf(project, goalRef, subId)).length;
    if (card === null) rec.uncover('hold-before-adopt', 'env-unavailable', 'graph/detail 读不到 sub 的任务卡');
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
  // The Goal must not complete while the replacing div Task is missing or unsatisfied (second review #7).
  let completedWhileDivOpen = false;
  const done = await waitGoal(ctx, project, goalRef, { timeoutMs: 150 * MINUTE, rec, answer: approve, onPoll: async display => {
    const tasks = ready(await host.client.read('tasks/query', project.scope, { goalRef }))?.tasks ?? [];
    const div = tasks.find(task => /div/i.test(`${task.ref.taskId} ${task.definition?.title ?? ''}`));
    if (display?.display?.phase === 'COMPLETED' && (div === undefined || div.effectivePhase !== 'satisfied')) completedWhileDivOpen = true;
  } });
  const versions = ready(await host.client.read('plans/versions', project.scope, { goalId: goalRef.goalId, limit: 50, cursor: null }));
  rec.check('versions', (versions?.items?.length ?? 0) >= 2 && applied.status === 'committed',
    `plans/versions ${versions?.items?.length ?? 0} 版；改目标的候选由人 plans/apply（${applied.status}，采用 ${JSON.stringify(adoptedPlan)}）`);
  const graph = ready(await host.client.read('tasks/query', project.scope, { goalRef }));
  const tasks = graph?.tasks ?? [];
  const div = taskNamed(tasks, 'div');
  const sub = subId === null ? taskNamed(tasks, 'sub') : tasks.find(task => task.ref.taskId === subId);
  const mul = mulId === null ? taskNamed(tasks, 'mul') : tasks.find(task => task.ref.taskId === mulId);
  // P6: who adopted, which version, sub really cancelled — from the adopted version's own disposition record.
  const record = subId === null ? { readable: true, entry: null, proposal: null } : await dispositionOf(project, goalRef, adoptedPlan, subId);
  const cancelled = cancelRecordText(record, adoptedPlan);
  rec.check('switch', div !== undefined && (sub === undefined || sub.disposition !== 'active') && mul?.effectivePhase === 'satisfied' && cancelled.ok,
    `div ${div?.effectivePhase ?? '无'}；sub ${sub === undefined ? '不在新计划' : sub.disposition}；mul ${mul?.effectivePhase ?? '无'}；sub 的取消：${cancelled.text}`);
  // Second review #7: each new required requirement → the checks that cover it → the rounds those checks belong to →
  // each round judged a div Run (its subjectRunRef) under the adopted change version (or the active Plan after it,
  // never the first version). A requirement with no covering check, or any other link missing, is not a pass.
  if (div === undefined) rec.fail('old-evidence', 'div 不在新计划里');
  else {
    const chains = await taskRounds(project, goalRef, div.ref.taskId);
    const divRuns = new Set(chains.map(entry => JSON.stringify(entry.item.run.ref)));
    const rounds = new Map(chains.flatMap(entry => entry.rounds).map(round => [JSON.stringify(round.roundRef), round]));
    const plans = new Set([JSON.stringify(adoptedPlan), ...(JSON.stringify(graph?.plan?.ref) === JSON.stringify(started.plan) ? [] : [JSON.stringify(graph?.plan?.ref)])]);
    const head = chains.map(entry => entry.head).filter(Boolean).at(-1) ?? null;
    if (head === null) rec.fail('old-evidence', `div 的 ${chains.length} 个 Run 都没有检查轮`);
    else {
      rec.link('evidence', head.roundRef, head.revision);
      const required = head.delivery.requirements.filter(entry => entry.requirementLevel === 'required');
      // Quick check #7, requirement by kind: a reviewer requirement is answered by the formal review Evidence of the
      // round itself (no checks), so its link is that round: a div Run under the adopted version; any other kind needs
      // its own covering checks, each on a div round under the adopted version. Not satisfied → fail; a link that
      // cannot be read → uncovered; a link that points elsewhere → fail.
      const headLinked = divRuns.has(JSON.stringify(head.subjectRunRef)) && plans.has(JSON.stringify(head.planRef));
      const verdicts = required.map(entry => {
        const name = `${entry.obligationTitle}/${entry.requirementId}(${entry.kind}):${entry.state}`;
        if (entry.state !== 'pass') return { verdict: 'fail', text: `${name} 没有满足` };
        if (entry.kind === 'reviewer') {
          return { verdict: headLinked ? 'pass' : 'fail', text: `${name}，由本轮正式审阅回答（轮判 ${head.subjectRunRef.runId}，计划 ${head.planRef.planId}）` };
        }
        if (entry.checks.length === 0) return { verdict: 'uncovered', text: `${name}，公开读口没有覆盖它的检查，接不上证据` };
        const covering = entry.checks.map(check => rounds.get(JSON.stringify(check.roundRef)) ?? null);
        if (covering.some(round => round === null)) return { verdict: 'fail', text: `${name}，覆盖它的检查不在 div 自己的轮里` };
        const linked = covering.every(round => divRuns.has(JSON.stringify(round.subjectRunRef)) && plans.has(JSON.stringify(round.planRef)));
        return { verdict: linked ? 'pass' : 'fail', text: `${name}，覆盖${covering.map(round => `（#${round.chain.ordinal} 判 ${round.subjectRunRef.runId}，计划 ${round.planRef.planId}）`).join('')}` };
      });
      const text = `采用版本 ${adoptedPlan.planId}；div 必需要求 ${required.length} 条：${verdicts.map(entry => entry.text).join('；') || '无'}`;
      if (required.length === 0) rec.fail('old-evidence', `${text}（div 没有必需要求）`);
      else if (verdicts.some(entry => entry.verdict === 'fail')) rec.fail('old-evidence', text);
      else if (verdicts.some(entry => entry.verdict === 'uncovered')) rec.uncover('old-evidence', 'entry-missing', text);
      else rec.pass('old-evidence', text);
    }
  }
  // lead 11-18：采用的改目标版本里没有被拿掉的必需任务时，这条判据没有对象，记 not-run，不空过。
  const adoptedBody = await host.client.read('tasks/query', project.scope, { goalRef, planRef: adoptedPlan });
  const adoptedGraph = ready(adoptedBody);
  const removed = (adoptedGraph?.tasks ?? []).filter(task => task.definition?.taskKind === 'work'
    && task.definition?.requirementLevel === 'required' && ['cancelled', 'superseded'].includes(task.disposition));
  if (adoptedGraph === null) rec.uncover('required-cancel', 'env-unavailable', `tasks/query ${adoptedPlan.planId}：${adoptedBody?.status ?? 'no answer'} ${adoptedBody?.code ?? ''}`);
  else if (removed.length === 0) {
    rec.uncover('required-cancel', 'not-run', `采用的版本 ${adoptedPlan.planId} 里没有被取消或接替的必需任务（sub ${sub === undefined ? '不在' : sub.disposition}），这条判据没有对象`);
  } else rec.check('required-cancel', div !== undefined && div.effectivePhase === 'satisfied' && !completedWhileDivOpen && done.display.phase === 'COMPLETED',
    `被拿掉的必需任务 ${removed.map(task => task.ref.taskId).join(', ')}；最后 ${done.display.phase}；div ${div?.effectivePhase ?? '不存在'}；div 缺失或没满足时出现过 COMPLETED：${completedWhileDivOpen}`);
}

export default { ...def, run };
