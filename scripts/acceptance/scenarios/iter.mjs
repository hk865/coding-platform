// Plan iteration: 2–3 ideas first, the person picks one, the plan is iterated in conversation with "what changed"
// each round, candidates kept per request, adopting one makes the other request's candidate stale, a "why" follow-up
// answers from the saved version (draft §1.6; MVP-BEHAVIOR.md:94-116; slice-9-SPEC.md:665, :691). Ideas need an
// already governed project (C-108: semantic_query), so a small cold-start seed Goal comes first.
import { isDeepStrictEqual } from 'node:util';
import { newId, ready } from '../lib/http.mjs';
import { answerPlanQuestions, broken, chooseModel, coldStart, confirmCard, openProject, savedAnswerOf, sessionTurns, submitRequest,
  waitCandidate, waitGoal, waitRequest } from '../lib/flows.mjs';
import { Abort } from '../lib/report.mjs';

const MINUTE = 60_000;
const SEED = {
  'package.json': '{\n  "name": "g6-iter",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6-iter\n\nA word counter library.\n',
  'count.js': 'export function countWords(text) {\n  return text.split(/\\s+/).filter(Boolean).length;\n}\n',
};
const SEED_REQUEST = '初始化这个项目：在 README.md 末尾加一行用法示例。验收：node --test 通过。只改 README.md。';
const ASK_IDEAS = '我想给这个库加一个命令行入口，先给我 2 到 3 个思路，我选一个再细化。';
const ITERATE = '把参数解析改成直接读 process.argv，不要引入任何依赖库；其余不变。这一轮请说明改了什么。';
const WHY = '为什么选这个方案？和别的思路比好在哪里？';
const OTHER = '另外再想一个：给库加一个 countLines(text)，先给我 2 到 3 个思路。';

const def = {
  id: 'iteration',
  rows: ['C-108', 'C-109', 'C-110', 'C-111', 'C-112', 'C-105', 'C-107', 'C-113', 'C-194', 'C-213', 'C-226'],
  checks: [
    { id: 'ideas', rows: ['C-108'], text: '有治理的项目上先给 2–3 个简短思路，不带目标卡草稿' },
    { id: 'select', rows: ['C-109'], text: '选思路只认人，下一轮输入写明选了第几个' },
    { id: 'candidate', rows: ['C-110'], text: '选思路后出完整计划，写成这个请求的候选' },
    { id: 'what-changed', rows: ['C-213', 'C-110'], text: '每轮说明改了什么' },
    { id: 'per-request', rows: ['C-111'], text: '候选按请求分开；采用一个后另一请求的旧候选读作过期' },
    { id: 'why', rows: ['C-112', 'C-226'], text: '追问“为什么”用原方案和原理由回答，不重出计划' },
    { id: 'continues', rows: ['C-105'], text: '带 continues 的追问在同一请求后加一轮，交给同一个秘书' },
    { id: 'request-goal', rows: ['C-107'], text: '请求记下发出时选中的目标' },
    { id: 'cards-ask', rows: ['C-113'], text: '带卡片引用的 ask 在同一请求后加一轮，输入在 ## Cards 下写明钉住的版本' },
    { id: 'multi-round', rows: ['C-194'], text: '多轮之后后续轮接得上前面的内容（同一秘书 Session）' },
  ],
};

const latestRound = view => view.rounds.at(-1);

// P6K (review row 8): the request the person already picked an idea for revises the candidate; the round must say what
// changed. A negation wins first: the Chinese words are blunt (`不变` anywhere counts), the English ones are whole
// words (`unchangedFlag` is not `unchanged`). Then a Chinese topic word or change verb, or the whole English word
// `argv` or `changed`/`change`, names the change; `unchanged` never counts as a change and `argvBackup` is not
// `argv`. No hit is uncovered with the summary kept.
const WHAT_CHANGED_NEGATED = /未改|没改|不变|原样|\b(?:unchanged|no change)\b/i;
const WHAT_CHANGED_TOPIC = /解析|依赖|库|\b(?:argv|changed?)\b/i;
const WHAT_CHANGED_VERB = /改|变更/;

/** The saved plan round's answer is JSON with `summary` (`answer-tools.ts:291`, `query-observation.ts:216`). */
function planSummary(round) {
  const answer = savedAnswerOf(round);
  return typeof answer?.summary === 'string' ? answer.summary : null;
}

/** One line per change round: the summary text itself, its round ref and both candidate refs (never truncated). */
function whatChangedNote({ round, firstRef, secondRef, summary }) {
  const text = value => JSON.stringify(value ?? null);
  return `改案轮 ${text(round?.ref)}：摘要原文 ${summary === null ? '（取不到）' : text(summary)}；`
    + `首案候选 ${text(firstRef)}；改案候选 ${text(secondRef)}`;
}

/**
 * P6K (diagnosis "iteration 的 C-213"): judge one change round from the candidate chain and the plan round's own
 * `summary`, never by searching the whole answer. Returns the usual verdict shape (`{ status, code?, note, notes }`);
 * `notes` are the evidence lines the caller writes with `rec.note`. A failed second read is an environment gap, a
 * missing first candidate or a summary that cannot be read is an evidence gap, and a summary that simply does not say
 * what changed is `uncovered (not-run)` for the person to read — only the three candidate-structure facts fail.
 */
export function judgeWhatChanged(first, second, round) {
  const firstRef = first?.head?.ref ?? null;
  const secondRef = second?.head?.ref ?? null;
  const summary = planSummary(round);
  const notes = [whatChangedNote({ round, firstRef, secondRef, summary })];
  if (second === null) {
    return { status: 'uncovered', code: 'env-unavailable', notes,
      note: `plans/request-candidate 整份读失败，第二个候选无从核对（首案 ${firstRef?.proposalId ?? '缺失'}）：不能把读失败折成没有候选` };
  }
  if (typeof firstRef?.proposalId !== 'string' || firstRef.proposalId === '') {
    return { status: 'uncovered', code: 'entry-missing', notes,
      note: `首案候选证据缺口：first.head.ref.proposalId 读不到，previous 无从比对（第二个候选 ${secondRef?.proposalId ?? '缺失'}）` };
  }
  if (typeof secondRef?.proposalId !== 'string' || secondRef.proposalId === '') {
    return { status: 'fail', notes,
      note: `第二个候选不存在：second.head.ref.proposalId 没有值（首案 ${firstRef.proposalId}）` };
  }
  if (secondRef.proposalId === firstRef.proposalId) {
    return { status: 'fail', notes,
      note: `第二个候选 ID 没变：仍是 ${firstRef.proposalId}，这一轮没有出新候选（首案 ${firstRef.proposalId}）` };
  }
  const previous = second.previous ?? null;
  if (previous === null || previous.proposalRef === null
    || !isDeepStrictEqual(previous.proposalRef, firstRef)) {
    return { status: 'fail', notes,
      note: `previous 没指回本次首案：second.previous=${JSON.stringify(previous)}，首案 ref=${JSON.stringify(firstRef)}` };
  }
  if (summary === null) {
    return { status: 'uncovered', code: 'entry-missing', notes,
      note: `取不到 summary 原文，证据缺口：requests/read 保存的规划回答不是含字符串 summary 的 JSON（轮 ${round?.ref?.queryJobId ?? '缺失'}）` };
  }
  const negated = summary.match(WHAT_CHANGED_NEGATED)?.[0];
  if (negated !== undefined) {
    return { status: 'uncovered', code: 'not-run', notes,
      note: `摘要把改动说成否定或原样（含「${negated}」），不能判通过，原文见 notes，需人读：${summary}` };
  }
  if (WHAT_CHANGED_TOPIC.test(summary) || WHAT_CHANGED_VERB.test(summary)) {
    return { status: 'pass', notes,
      note: `摘要说明改动：${summary}（候选 ${firstRef.proposalId} → ${secondRef.proposalId}）` };
  }
  return { status: 'uncovered', code: 'not-run', notes,
    note: `摘要没说明改动，原文见 notes，需人读：${summary}` };
}

async function candidateOf(project, goalRef, requestRoot) {
  return ready(await project.host.client.read('plans/request-candidate', project.scope, { goalRef, requestRef: requestRoot }));
}

/**
 * INT2 I-4 item 2: after R2 a new request submitted while an ended goal is selected carries no goal; the ended goal is
 * only its source. The request is judged on the view's own fields, never on the display.
 */
export function requestHasNoGoalOf(view, seedGoalId) {
  return view?.goalId === null && view?.effectiveGoalId === null && view?.source?.goalRef?.goalId === seedGoalId;
}


/**
 * P6K3 (review row "iteration · 无候选后继续解引用"): the steps after `what-changed` and `continues` all need the change
 * round's second candidate — the "why" ask pins its ref, the cards and multi-round checks read the answer around it,
 * and adoption applies it. A candidate read that answered without a `head` (or a failed read, `second === null`)
 * leaves nothing to address, so those four checks are uncovered instead of `second.head.ref` throwing and ending the
 * whole scenario; the `what-changed`/`continues` verdicts written before this point stay.
 */
export async function afterChangeRound(ctx, project, rec, { goalRef, root, iterRound, second }) {
  if (second?.head === null || second?.head === undefined) {
    for (const id of ['why', 'cards-ask', 'multi-round', 'per-request']) {
      rec.uncover(id, 'not-run', '这一轮没有第二个候选（second.head 为空），依赖这个候选的步骤没有可读的对象，跳过');
    }
    return;
  }
  const why = await project.host.client.command('requests/ask', project.scope, { commandId: newId('why'), round: iterRound.ref,
    cardRefs: [{ ref: second.head.ref, revision: second.head.revision }], regenerate: false, text: WHY });
  rec.facts.userCommand.push(WHY);
  let view = await waitRequest(ctx, project, root);
  const whyRound = latestRound(view);
  const afterWhy = await candidateOf(project, goalRef, root);
  rec.check('why', why?.status === 'queued' && afterWhy?.head?.ref?.proposalId === second.head.ref.proposalId && (whyRound.answer ?? '').length > 0,
    `追问后候选不变：${afterWhy?.head?.ref?.proposalId === second.head.ref.proposalId}；回答 ${(whyRound.answer ?? '').length} 字`);
  // `round.input` is the person's text; the `## Cards` section is in the secretary's actual input, its saved history.
  // Judged on the secretary's turn input only (#9), never on its answers or tool results.
  const secretaryInput = whyRound.session === null || whyRound.session === undefined ? ''
    : (await sessionTurns(project, whyRound.session)).map(turn => turn.input).join('\n');
  rec.check('cards-ask', /## Cards/.test(secretaryInput), `秘书线的 turn 输入带 ## Cards：${/## Cards/.test(secretaryInput)}`);
  rec.check('multi-round', /process\.argv|argv/.test(whyRound.answer ?? '') || /process\.argv|argv/.test(iterRound.answer ?? ''),
    '后续轮的回答接上前面改过的内容（process.argv）');

  // A second request with its own candidate; adopting the first makes the second stale.
  const other = await submitRequest(project, OTHER, { goalId: goalRef.goalId });
  rec.facts.userCommand.push(OTHER);
  let otherView = await waitRequest(ctx, project, other.requestRoot);
  const otherIdeas = latestRound(otherView);
  if (otherIdeas.ideas.length >= 2) {
    await project.host.client.command('requests/select-idea', project.scope, { commandId: newId('idea'), round: otherIdeas.ref, index: 0 });
    otherView = await waitRequest(ctx, project, other.requestRoot);
  }
  // G7 W5: the second request's plan round may ask too (G6 run 4: four questions); the same answer, the same cap.
  otherView = (await answerPlanQuestions(ctx, project, other.requestRoot, otherView, rec)).view;
  const otherCandidate = await waitCandidate(ctx, project, goalRef, other.requestRoot, 'the second request candidate',
    { timeoutMs: 20 * MINUTE, done: value => value?.head !== null && value?.head !== undefined });
  const goal = ready(await project.host.client.read('goals/read', project.scope, goalRef));
  const adopted = await project.host.client.write('plans/apply', project.scope,
    { proposalRef: second.head.ref, expectedProposalRevision: second.head.revision, decisionRefs: [] },
    [{ ref: goalRef, revision: goal.goal.revision }]);
  const staleOther = await candidateOf(project, goalRef, other.requestRoot);
  rec.check('per-request', adopted?.status === 'committed' && otherCandidate.head.ref.proposalId !== second.head.ref.proposalId
    && staleOther?.status === 'stale',
  `采用第一请求的候选 ${adopted?.status}；第二请求候选 ${otherCandidate.head.ref.proposalId} 现在 ${staleOther?.status}`);
}

async function run(ctx, rec) {
  const host = ctx.hosts['w-accept'];
  const project = await openProject(ctx, host, 'iter', SEED);
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, host, project);
  rec.facts.userCommand = [SEED_REQUEST, ASK_IDEAS];
  const seed = await coldStart(ctx, project, SEED_REQUEST, rec);
  await waitGoal(ctx, project, seed.goalRef, { timeoutMs: 60 * MINUTE, rec });
  await iterateOnEndedSeed(ctx, project, rec, seed.goalRef);
}

/**
 * Everything after the seed Goal ended (INT2 I-4, as corrected by supplementary ruling C4): the request sent on the
 * ended seed Goal, its ideas, the selection, the confirmed card's new Goal, the first candidate, the change round, the tail.
 */
export async function iterateOnEndedSeed(ctx, project, rec, goalRef) {
  const asked = await submitRequest(project, ASK_IDEAS, { goalId: goalRef.goalId });
  if (asked?.status !== 'queued') throw broken(ctx, `requests/submit: ${asked?.code} ${asked?.reason}`);
  const root = asked.requestRoot;
  let view = await waitRequest(ctx, project, root);
  const ideasRound = latestRound(view);
  rec.check('ideas', ideasRound.ideas.length >= 2 && ideasRound.ideas.length <= 3 && ideasRound.goalCardDrafts.length === 0,
    `${ideasRound.ideas.length} 个思路，目标卡草稿 ${ideasRound.goalCardDrafts.length}`);
  // INT2 I-4 item 2: R2 reroutes a new request on an ended Goal to no goal, with the seed Goal only as its source.
  rec.check('request-goal', requestHasNoGoalOf(view, goalRef.goalId),
    `请求自己记的目标 ${view.goalId}，有效目标 ${view.effectiveGoalId ?? '读不到'}；来源 Goal ${view.source?.goalRef?.goalId ?? '无'}（种子 ${goalRef.goalId}）`);
  rec.facts.seedGoal = goalRef;
  rec.note('种子目标完成后 R2 另开新目标：这条请求没有目标，来源是种子目标，目标卡确认后才有新 Goal');
  // `ideas` is already judged fail; the steps after it need two ideas to pick from.
  if (ideasRound.ideas.length < 2) throw new Abort('not-run', 'the secretary gave fewer than two ideas (ideas: fail)');

  const selected = await project.host.client.command('requests/select-idea', project.scope, { commandId: newId('idea'), round: ideasRound.ref, index: 0 });
  view = await waitRequest(ctx, project, root);
  const planRound = latestRound(view);
  rec.check('select', selected?.status === 'queued' && /第\s*1|1\s*个|#1|idea 1/i.test(JSON.stringify(planRound.input ?? '')),
    `select-idea ${selected?.status}；下一轮输入提到所选：${/第\s*1|1\s*个/.test(JSON.stringify(planRound.input ?? ''))}`);
  // INT2 I-4 item 4: the secretary answers the idea with the Goal card; the person confirms it (`confirmCard`, the same
  // confirmation the cold start and E12 use) and the new Goal owns every later candidate, adoption and the second request.
  const confirmedNew = await confirmCard(ctx, project, planRound, rec);
  const newGoalRef = confirmedNew.binding.goalRef;
  rec.facts.newGoal = newGoalRef;
  rec.note(`R2 新目标 ${newGoalRef.goalId} 由目标卡确认；种子目标 ${goalRef.goalId} 只留在请求来源里`);
  // INT2 C4 item 2: the confirm itself queues the planning round on this root (the idea was already selected); the
  // person sends nothing more ("按已选思路出首案" is not sent) and the driver only waits for the (new Goal, root) candidate.
  // lead 11-28 (C4 follow-up): when that round asks first (`needs_decision`), the person answers it the usual way inside
  // the same 20 minutes, and the wait goes on.
  const first = await waitCandidate(ctx, project, newGoalRef, root, 'the request candidate',
    { timeoutMs: 20 * MINUTE, check: 'candidate', done: value => value?.head !== null && value?.head !== undefined,
      questionsRec: rec });
  rec.check('candidate', first.status === 'candidate', `候选 ${first.head.ref.proposalId}（${first.status}）`);
  rec.link('plan', first.head.ref, first.head.revision);

  // INT2 C4 item 3: every follow-up on a root sends `{continues: root, goalId: null}` (`submitRequest`'s and
  // `answerPlanQuestions`' default), the same as the UI (`boot.ts:1462`); only candidate reads, `plans/apply` and the
  // second request name the new Goal. An explicit `g-new` on this root is refused (`request-service.ts:959`).
  const iterated = await submitRequest(project, ITERATE, { continues: root });
  rec.facts.userCommand.push(ITERATE);
  view = (await answerPlanQuestions(ctx, project, root, await waitRequest(ctx, project, root), rec)).view;
  const iterRound = latestRound(view);
  const second = await candidateOf(project, newGoalRef, root);
  const changed = judgeWhatChanged(first, second, iterRound);
  for (const line of changed.notes) rec.note(line);
  if (changed.status === 'pass') rec.pass('what-changed', changed.note);
  else if (changed.status === 'fail') rec.fail('what-changed', changed.note);
  else rec.uncover('what-changed', changed.code, changed.note);
  rec.check('continues', iterated?.status === 'queued' && view.rounds.length >= 3
    && new Set(view.rounds.map(round => round.session?.sessionId).filter(Boolean)).size === 1,
  `同一请求 ${view.rounds.length} 轮，秘书 Session ${[...new Set(view.rounds.map(round => round.session?.sessionId))].join(',')}`);

  await afterChangeRound(ctx, project, rec, { goalRef: newGoalRef, root, iterRound, second });
}

export default { ...def, run };
