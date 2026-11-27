// E08b（P6 裁定 Q4，lead 11-25）：E08 的“方案确认后自动”档变体，排在全部场景之后，上限照每场景 5,000 万。
// sub 的 Run 已经在跑时人说“不要 sub”：观察叫停送到、执行者在安全点收尾、Run 结束后才采用（design-frozen.md:834）。
// - 秘书的配方：在跑的 Run 要收尾用 `request_stop`（`skill-platform-secretary.txt:32-33`）；叫停的几步按任务卡读
//   （`graph/detail` 的 `stop.request`、`stop.steps`，`work-line.ts:434-444`）。
// - 改需求的候选取消了已有任务 sub，作者是秘书线，平台不自动采用，出 A13 候选卡等人（`workflow.ts:985-1013`
//   `autoAdoptionCardReason` → `touches_existing_tasks`；`request-candidate.ts:60-70` 小改动只认只加新任务）。人在 Run
//   结束后用 `plans/apply` 采用；Run 还没结束就采用时，平台先硬停受影响的 Run、回 busy（`plan-adoption-stop.ts:8-19`），
//   这正是本格要区分的那次硬停。候选已被采用（例如秘书没碰已有任务的版本）时，按 `plans/proposal` 的 `adoptedBy` 记下谁采用。
// - 人等叫停落地最多 20 分钟（叫停没出现时最多 5 分钟），之后照常采用。没走到的支路记 uncover not-run。
import { ready } from '../lib/http.mjs';
import { answerCard, approve, broken, chooseModel, coldStart, openProject, sleep, submitRequest, taskCard, waitFor,
  waitingCards, waitRequest } from '../lib/flows.mjs';
import { Abort } from '../lib/report.mjs';
import { CHANGE, CHANGE_WAIT_MS, REQUEST, SEED, adoptedEvidence, applyChange, cancelRecordText, candidateRow, changeCandidateAtClose,
  dispositionOf, followChangeRounds, roundLog, runsOf, taskNamed } from './e08.mjs';

const MINUTE = 60_000;
/** The same two tasks as E08, without E08's "每步确认" sentence: this Goal runs under after_plan_confirmation. */
const REQUEST_B = REQUEST.replace('这个目标用“每步确认”。', '');
/** `NodeTaskStopV1.steps` in their proven order (`work-line.ts:434-444`). */
const STEP_ORDER = ['requested', 'hold_placed', 'sent', 'delivered', 'run_ended'];

const def = {
  id: 'E08b',
  rows: ['C-210'],
  autonomy: 'after_plan_confirmation',
  checks: [
    { id: 'sub-running', rows: ['C-210'], text: '“方案确认后自动”档：提交改需求时 sub 的 Run 正在跑' },
    { id: 'stop-delivered', rows: ['C-210'], text: 'sub 的任务卡上叫停依次 requested →（hold_placed）→ sent → delivered → run_ended，没有 not_sent/void' },
    { id: 'safe-point-end', rows: ['C-210'], text: 'sub 的 Run 由叫停在安全点收尾结束，不是采用时的 stopping_affected_work 硬停' },
    { id: 'adopt-after-end', rows: ['C-210'], text: 'Run 结束之后才采用改需求的候选；采用版本的记录写明 sub→cancelled、采用版本和采用人' },
  ],
};

const sameJson = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/** Poll without judging anything: returns the last value once `stop(value)` holds or `ms` passed. */
async function watch(ctx, read, stop, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    await ctx.budget.tick();
    const value = await read();
    if (stop(value) || Date.now() > deadline) return value;
    await sleep(10_000);
  }
}

/** The person answers every waiting card except candidate cards (the change candidate is adopted by `plans/apply`). */
async function answerOthers(ctx, project, goalRef, rec, answered) {
  for (const card of await waitingCards(project, goalRef, rec)) {
    if (card.source.kind === 'candidate' || answered.has(card.cardKey)) continue;
    const selection = approve(card);
    if (selection === null) continue;
    if (await answerCard(ctx, project, card, selection, '', rec)) answered.add(card.cardKey);
  }
}

/** `steps` keep the proven order (each a subsequence of STEP_ORDER, the two end steps aside). */
const inOrder = steps => {
  const known = steps.filter(step => STEP_ORDER.includes(step)).map(step => STEP_ORDER.indexOf(step));
  return known.every((value, index) => index === 0 || value > known[index - 1]);
};

/**
 * P6L E08b rule 5 (run sheet 这一轮做什么 item 2): the wait ended with no head. The last round stays in
 * `facts.e08b.rounds`, the final candidate read (`candidateRow`) is kept in `facts.e08b.candidate`, and the three
 * cells after the request stay `not-run` (never `fail`): a question or a probe is not a candidate, so nothing was
 * adopted.
 */
export async function closeWithoutCandidate(rec, project, goalRef, requestRoot, taskId, seen) {
  rec.facts.e08b.candidate = await candidateRow(project, goalRef, requestRoot, taskId);
  for (const id of ['stop-delivered', 'safe-point-end', 'adopt-after-end']) {
    rec.uncover(id, 'not-run', `没有读到可采用的候选。问题或探针不构成候选，没有发生采用，这一支没走到；${seen}`);
  }
}

async function run(ctx, rec) {
  const host = ctx.hosts['w-accept'];
  const project = await openProject(ctx, host, 'e08b', SEED);
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, host, project);
  rec.facts.userCommand = [REQUEST_B];
  const started = await coldStart(ctx, project, REQUEST_B, rec);
  const goalRef = started.goalRef;
  const firstTasks = ready(await host.client.read('tasks/query', project.scope, { goalRef, planRef: started.plan }))?.tasks ?? [];
  const subId = taskNamed(firstTasks, 'sub')?.ref.taskId ?? null;
  if (subId === null) throw new Abort('not-run', `首版计划 ${started.plan?.planId ?? '-'} 里认不出 sub 任务`);

  // 1. Wait (answering cards) until sub's Run is running; a sub that already finished leaves this variant not run.
  const answered = new Set();
  const seen = await waitFor(ctx, 'a running Run of sub', async () => {
    await answerOthers(ctx, project, goalRef, rec, answered);
    const runs = await runsOf(project, goalRef, subId);
    return { running: runs.find(item => item.run.status === 'running') ?? null, runs };
  }, value => value.running !== null || (value.runs.length > 0 && value.runs.every(item => item.run.status === 'ended')),
  { timeoutMs: 40 * MINUTE, check: 'sub-running' });
  if (seen.running === null) {
    rec.uncover('sub-running', 'not-run', `sub 的 ${seen.runs.length} 个 Run 在驱动看到“正在跑”之前都已结束（${seen.runs.map(item => item.run.outcome ?? '-').join(',')}），这个变体没走到`);
    return;
  }
  const subRun = seen.running.run;
  rec.link('run', subRun.ref);
  rec.pass('sub-running', `提交改需求时 sub（${subId}）的 Run ${subRun.ref.runId} 正在跑（开始于 ${subRun.startedAt}）`);

  // 2. The person changes the requirement while sub's Run works; meanwhile the stop on sub's task card is followed.
  let steps = [];
  let stopRequest = null;
  let runEnd = null;
  const observe = async () => {
    const card = await taskCard(project, goalRef, subId);
    if (card?.stop?.request != null) stopRequest = card.stop.request;
    if ((card?.stop?.steps ?? []).length >= steps.length) steps = [...(card?.stop?.steps ?? steps)];
    const item = (await runsOf(project, goalRef, subId)).find(entry => sameJson(entry.run.ref, subRun.ref));
    if (runEnd === null && item?.run.status === 'ended') runEnd = { at: item.run.endedAt ?? null, outcome: item.run.outcome ?? null };
  };
  const change = await submitRequest(project, CHANGE, { goalId: goalRef.goalId });
  if (change?.status !== 'queued') throw broken(ctx, `requests/submit with goalId: ${change?.code} ${change?.reason}`, 'stop-delivered');
  rec.facts.userCommand.push(CHANGE);
  await waitRequest(ctx, project, change.requestRoot, 40 * MINUTE);
  // P6L E08b (diagnosis E08b row "还要改什么"; run sheet 这一轮做什么 item 2): the same request's new rounds are followed
  // inside the candidate wait's original limit — one read after every card answer and again at close-out, keyed by
  // `roundRef`; the newest answered round's 2–3 unselected ideas are selected exactly once; a new `needs_decision`
  // round is answered through the shared entry and its count limit. A head still goes back to the original adoption
  // path below; with none, the last round and the final candidate read stay and the three cells stay not-run.
  const follow = { rounds: [], seen: new Set(), gaps: [], selected: null, asked: 0 };
  // P6L2 B4: one absolute deadline for the whole change wait. P6LO B4: the follow runs only inside the wait's beats,
  // after the candidate and the request were read, and at most one action per beat.
  const changeDeadline = Date.now() + CHANGE_WAIT_MS;
  rec.facts.e08b = { rounds: follow.rounds, evidenceGaps: follow.gaps };
  const waited = await changeCandidateAtClose(ctx, project, goalRef, change.requestRoot, rec, {
    deadline: changeDeadline,
    onPoll: async (view, remaining) => {
      const followed = await followChangeRounds(ctx, project, change.requestRoot, rec, follow,
        { check: 'adopt-after-end', deadline: changeDeadline, once: true });
      rec.facts.e08b.rounds = follow.rounds;
      rec.facts.e08b.selectIdea = follow.selected;
      await observe();
      return followed ?? view;
    },
  });
  // Close-out re-read of the same request (the wait's last read can miss a round written a moment later). P6LO B4: it
  // only refreshes the evidence (`timeoutMs: 0`), also when the candidate came before the deadline.
  await followChangeRounds(ctx, project, change.requestRoot, rec, follow, { check: 'adopt-after-end', timeoutMs: 0 });
  rec.facts.e08b.rounds = follow.rounds;
  rec.facts.e08b.selectIdea = follow.selected;
  rec.note(`E08b 改需求的轮：${roundLog(follow.rounds)}`);
  if (waited.candidate === null) {
    const seen = `任务卡 stop.steps：${steps.join(' → ') || '无'}；叫停请求 ${stopRequest === null ? '无' : stopRequest.state}；sub 的 Run ${
      runEnd === null ? '还在跑' : `${runEnd.outcome ?? '-'} @ ${runEnd.at}`}`;
    await closeWithoutCandidate(rec, project, goalRef, change.requestRoot, subId, seen);
    return;
  }
  const candidate = waited.candidate;
  rec.facts.e08b.candidate = await candidateRow(project, goalRef, change.requestRoot, subId);

  // 3. The person waits for the stop to land (bounded) before adopting: 20 min, or 5 min while no stop was requested.
  const waitFrom = Date.now();
  await watch(ctx, async () => { await answerOthers(ctx, project, goalRef, rec, answered); await observe(); return null; },
    () => runEnd !== null || (stopRequest === null && Date.now() - waitFrom > 5 * MINUTE), 20 * MINUTE);
  rec.note(`采用前：叫停请求 ${stopRequest === null ? '无' : `${stopRequest.ref?.requestId ?? '-'} ${stopRequest.state}`}；任务卡上的步骤 ${steps.join(' → ') || '无'}；sub 的 Run ${
    runEnd === null ? '还在跑' : `已结束 ${runEnd.at}（${runEnd.outcome ?? '-'}）`}`);

  // 4. Adoption: the person's `plans/apply` (#7 busy retry), unless the candidate was already adopted.
  let adoptedPlan = null;
  let busy = [];
  let adopter = null;
  let adoptedLocalAt = null;
  if (candidate.head.status === 'accepted') {
    adoptedPlan = ready(await host.client.read('tasks/query', project.scope, { goalRef }))?.plan?.ref ?? null;
    const proposal = ready(await host.client.read('plans/proposal', project.scope, candidate.head.ref));
    adopter = proposal?.adoptedBy ?? null;
    rec.note(`改需求的候选在人采用之前已被采用（adoptedBy ${adopter?.kind ?? '-'}/${adopter?.id ?? '-'}）`);
  } else {
    const result = await applyChange(ctx, project, goalRef, change.requestRoot, candidate.head, [subId], rec, 'adopt-after-end');
    busy = result.busy;
    if (result.applied?.status !== 'committed') throw broken(ctx, `plans/apply of the change: ${result.applied?.code} ${result.applied?.reason}`, 'adopt-after-end');
    adoptedPlan = result.applied.value.ref;
    adoptedLocalAt = new Date().toISOString();
    rec.link('plan', adoptedPlan, result.applied.value.revision ?? null);
  }
  await observe();
  const adoptedEvidenceRows = adoptedPlan === null ? { readable: false } : await adoptedEvidence(project, goalRef, adoptedPlan);
  rec.facts.e08b.adopted = adoptedEvidenceRows;
  if (adoptedEvidenceRows.readable) rec.note(`E08b 采用 ${adoptedPlan.planId}：任务 ${adoptedEvidenceRows.tasks.map(task => `${task.taskId}:${task.disposition}`).join(', ')}；处置记录 ${(adoptedEvidenceRows.dispositionRecord?.entries ?? []).length} 条`);
  const versions = ready(await host.client.read('plans/versions', project.scope, { goalId: goalRef.goalId, limit: 50, cursor: null }))?.items ?? [];
  const newest = [...versions].sort((left, right) => left.revision - right.revision).at(-1) ?? null;
  const adoptedAt = newest?.at ?? adoptedLocalAt;

  // stop-delivered: the stop the secretary requested, step by step on sub's task card.
  const stepText = `任务卡 stop.steps：${steps.join(' → ') || '无'}；请求 ${stopRequest === null ? '无' : `${stopRequest.state}（${stopRequest.requester?.duty ?? '-'} 线 ${stopRequest.requester?.session?.sessionId ?? '-'}，停 Run ${stopRequest.stopRun?.runId ?? '-'}）`}`;
  if (stopRequest === null) {
    rec.uncover('stop-delivered', 'not-run', `秘书没有对 sub 发 request_stop（skill-platform-secretary.txt:32-33 的配方），叫停这一支没走到；${stepText}`);
    rec.uncover('safe-point-end', 'not-run', `没有叫停请求，“安全点收尾”无从观察；sub 的 Run ${runEnd === null ? '采用前还在跑' : `${runEnd.outcome ?? '-'} @ ${runEnd.at}`}；采用时 busy ${busy.length} 次`);
  } else {
    const broke = steps.includes('not_sent') || steps.includes('void');
    rec.check('stop-delivered', ['requested', 'sent', 'delivered'].every(step => steps.includes(step)) && inOrder(steps) && !broke, stepText);
    if (runEnd === null || busy.length > 0) {
      rec.fail('safe-point-end', `${runEnd === null ? '人等了 20 分钟 sub 的 Run 还没结束' : `Run ${runEnd.outcome ?? '-'} @ ${runEnd.at}`}；采用时平台硬停受影响的 Run（busy ${busy.length} 次：${busy.map(entry => entry.reason).join('；') || '-'}）；${stepText}`);
    } else if (!steps.includes('delivered')) {
      rec.uncover('safe-point-end', 'not-run', `sub 的 Run 在叫停送到之前就结束了（${runEnd.outcome ?? '-'} @ ${runEnd.at}），不是安全点收尾；${stepText}`);
    } else {
      rec.check('safe-point-end', steps.includes('run_ended'), `叫停送到后 sub 的 Run ${subRun.ref.runId} 结束（${runEnd.outcome ?? '-'} @ ${runEnd.at}），采用时没有 busy 硬停；${stepText}`);
    }
  }

  // adopt-after-end: the adoption came after the Run ended, and the adopted version records sub cancelled by its adopter.
  if (adoptedPlan === null) rec.uncover('adopt-after-end', 'env-unavailable', 'tasks/query 读不到采用后的计划版本');
  else {
    const record = await dispositionOf(project, goalRef, adoptedPlan, subId);
    const cancelled = cancelRecordText(record, adoptedPlan);
    const auto = candidate.head.status === 'accepted';
    // An adoption the platform made itself is recorded with its actor; only the person's own adoption needs a human actor.
    const recordOk = auto ? record.entry !== null && record.entry.to === 'cancelled' && sameJson(record.entry.setIn, adoptedPlan) : cancelled.ok;
    const ended = runEnd?.at ?? null;
    const after = ended !== null && adoptedAt !== null && Date.parse(ended) < Date.parse(adoptedAt);
    rec.check('adopt-after-end', after && busy.length === 0 && recordOk,
      `sub 的 Run 结束 ${ended ?? '没结束'}；采用 ${adoptedPlan.planId} @ ${adoptedAt ?? '-'}（${auto ? `已被 ${adopter?.kind ?? '-'} 采用` : `人 plans/apply，busy ${busy.length} 次`}）；${cancelled.text}`);
  }
}

export default { ...def, run };
