// Plan iteration: 2–3 ideas first, the person picks one, the plan is iterated in conversation with "what changed"
// each round, candidates kept per request, adopting one makes the other request's candidate stale, a "why" follow-up
// answers from the saved version (draft §1.6; MVP-BEHAVIOR.md:94-116; slice-9-SPEC.md:665, :691). Ideas need an
// already governed project (C-108: semantic_query), so a small cold-start seed Goal comes first.
import { newId, ready } from '../lib/http.mjs';
import { broken, chooseModel, coldStart, openProject, sessionTurns, submitRequest, waitFor, waitGoal, waitRequest } from '../lib/flows.mjs';
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

async function candidateOf(project, goalRef, requestRoot) {
  return ready(await project.host.client.read('plans/request-candidate', project.scope, { goalRef, requestRef: requestRoot }));
}

async function run(ctx, rec) {
  const host = ctx.hosts['w-accept'];
  const project = await openProject(ctx, host, 'iter', SEED);
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, host, project);
  rec.facts.userCommand = [SEED_REQUEST, ASK_IDEAS];
  const seed = await coldStart(ctx, project, SEED_REQUEST, rec);
  await waitGoal(ctx, project, seed.goalRef, { timeoutMs: 60 * MINUTE, rec });
  const goalRef = seed.goalRef;

  const asked = await submitRequest(project, ASK_IDEAS, { goalId: goalRef.goalId });
  if (asked?.status !== 'queued') throw broken(ctx, `requests/submit: ${asked?.code} ${asked?.reason}`);
  const root = asked.requestRoot;
  let view = await waitRequest(ctx, project, root);
  const ideasRound = latestRound(view);
  rec.check('ideas', ideasRound.ideas.length >= 2 && ideasRound.ideas.length <= 3 && ideasRound.goalCardDrafts.length === 0,
    `${ideasRound.ideas.length} 个思路，目标卡草稿 ${ideasRound.goalCardDrafts.length}`);
  rec.check('request-goal', view.goalId === goalRef.goalId, `请求记的目标 ${view.goalId}`);
  // `ideas` is already judged fail; the steps after it need two ideas to pick from.
  if (ideasRound.ideas.length < 2) throw new Abort('not-run', 'the secretary gave fewer than two ideas (ideas: fail)');

  const selected = await host.client.command('requests/select-idea', project.scope, { commandId: newId('idea'), round: ideasRound.ref, index: 0 });
  view = await waitRequest(ctx, project, root);
  const planRound = latestRound(view);
  rec.check('select', selected?.status === 'queued' && /第\s*1|1\s*个|#1|idea 1/i.test(JSON.stringify(planRound.input ?? '')),
    `select-idea ${selected?.status}；下一轮输入提到所选：${/第\s*1|1\s*个/.test(JSON.stringify(planRound.input ?? ''))}`);
  const first = await waitFor(ctx, 'the request candidate', () => candidateOf(project, goalRef, root),
    value => value?.head !== null && value?.head !== undefined, { timeoutMs: 20 * MINUTE });
  rec.check('candidate', first.status === 'candidate', `候选 ${first.head.ref.proposalId}（${first.status}）`);
  rec.link('plan', first.head.ref, first.head.revision);

  const iterated = await submitRequest(project, ITERATE, { continues: root, goalId: goalRef.goalId });
  rec.facts.userCommand.push(ITERATE);
  view = await waitRequest(ctx, project, root);
  const iterRound = latestRound(view);
  const second = await candidateOf(project, goalRef, root);
  rec.check('what-changed', /改了|改动|变更|changed/.test(iterRound.answer ?? '') && second?.head?.ref?.proposalId !== first.head.ref.proposalId,
    `第二轮回答说明改动：${/改了|改动|变更|changed/.test(iterRound.answer ?? '')}；新候选 ${second?.head?.ref?.proposalId}，前一版 ${JSON.stringify(second?.previous ?? null)}`);
  rec.check('continues', iterated?.status === 'queued' && view.rounds.length >= 3
    && new Set(view.rounds.map(round => round.session?.sessionId).filter(Boolean)).size === 1,
  `同一请求 ${view.rounds.length} 轮，秘书 Session ${[...new Set(view.rounds.map(round => round.session?.sessionId))].join(',')}`);

  const why = await host.client.command('requests/ask', project.scope, { commandId: newId('why'), round: iterRound.ref,
    cardRefs: [{ ref: second.head.ref, revision: second.head.revision }], regenerate: false, text: WHY });
  rec.facts.userCommand.push(WHY);
  view = await waitRequest(ctx, project, root);
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
    await host.client.command('requests/select-idea', project.scope, { commandId: newId('idea'), round: otherIdeas.ref, index: 0 });
    otherView = await waitRequest(ctx, project, other.requestRoot);
  }
  const otherCandidate = await waitFor(ctx, 'the second request candidate', () => candidateOf(project, goalRef, other.requestRoot),
    value => value?.head !== null && value?.head !== undefined, { timeoutMs: 20 * MINUTE });
  const goal = ready(await host.client.read('goals/read', project.scope, goalRef));
  const adopted = await host.client.write('plans/apply', project.scope,
    { proposalRef: second.head.ref, expectedProposalRevision: second.head.revision, decisionRefs: [] },
    [{ ref: goalRef, revision: goal.goal.revision }]);
  const staleOther = await candidateOf(project, goalRef, other.requestRoot);
  rec.check('per-request', adopted?.status === 'committed' && otherCandidate.head.ref.proposalId !== second.head.ref.proposalId
    && staleOther?.status === 'stale',
  `采用第一请求的候选 ${adopted?.status}；第二请求候选 ${otherCandidate.head.ref.proposalId} 现在 ${staleOther?.status}`);
}

export default { ...def, run };
