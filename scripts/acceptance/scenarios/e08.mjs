// E08: change the Goal's objective/acceptance during execution under `every_step` (draft §1.3; ruling 14:0x §9.1).
// This tree has no dedicated "change goal" route: 6C rides on a Plan candidate (`reason.objective`, new obligations,
// cancelled tasks) adopted only by the person with `plans/apply` (`plan-service.ts:1607-1612`), started here with
// `requests/submit {goalId}`. `goals/settings/set` only sets autonomy (C-126/C-133a).
// Under `every_step` a finished node waits for the person's `nodes/commit` (decision 121-45); `waitGoal` does that
// review from `goals/delivery` for an every_step unit (`flows.mjs` `reviewNodes`).
import { newId, ready } from '../lib/http.mjs';
import { answerCard, approve, broken, chooseModel, coldStart, executions, openProject, submitRequest, taskRounds, waitFor, waitGoal,
  waitingCards, waitRequest } from '../lib/flows.mjs';

const MINUTE = 60_000;
const SEED = {
  'package.json': '{\n  "name": "g6-e08",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6-e08\n\nA tiny calculator.\n',
  'calc.js': 'export function add(a, b) {\n  return a + b;\n}\n',
};
const REQUEST = '这个目标用“每步确认”。分两个独立任务：一是在 calc.js 加 sub(a, b) 并加 test/sub.test.js；'
  + '二是在 calc.js 加 mul(a, b) 并加 test/mul.test.js。验收：node --test 全部通过。';
const CHANGE = '改目标和验收：不要 sub 了（取消那个任务和它的验收）；改为加 div(a, b)，b 为 0 时抛 RangeError，并加 test/div.test.js。mul 照旧。';

const def = {
  id: 'E08',
  rows: ['C-47', 'C-62', 'C-63', 'C-133a', 'C-126', 'C-46', 'C-52', 'C-116', 'C-118', 'C-210'],
  checks: [
    { id: 'autonomy-born', rows: ['C-133a'], text: 'Goal 带草稿里的自治级别生在 revision 1' },
    { id: 'confirm-only-latest', rows: ['C-47'], text: '确认只认最近一次有回答的轮；同一张草稿换 commandId 再确认回 revision_conflict' },
    { id: 'person-adopts', rows: ['C-46', 'C-52'], text: '目标卡和方案由人确认/采用' },
    { id: 'first-adoption', rows: ['C-63', 'C-62'], text: '首次采用写 PlanRevision@1，Goal 指针从 null 变 P1' },
    { id: 'versions', rows: ['C-210'], text: '改前/改后版本与授权可核对（plans/versions 至少两版，改目标的候选由人采用）' },
    { id: 'switch', rows: ['C-210'], text: '受影响任务切到新定义（出现 div 任务，sub 被取消），无关任务继续（mul）' },
    { id: 'old-evidence', rows: ['C-210'], text: '旧证据不满足新义务：div 的义务要求只由改后计划下、div 自己改后 Run 的检查轮覆盖' },
    { id: 'required-cancel', rows: ['C-210'], text: 'required 取消后不因空集合变绿（div 满足之前 Goal 不完成）' },
    { id: 'autonomy-later', rows: ['C-126'], text: '改自治级别只影响之后的动作，不停正在跑的工作' },
    { id: 'control-pins', rows: ['C-116', 'C-118'], text: '控制要同时钉 Goal 和 GoalPhase；少钉一个回 invalid' },
  ],
};

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

  // Let the first work start, then change the objective and acceptance (every card answered by the person).
  // Under every_step the first step may wait for the person's card: the person answers while waiting for the first Run.
  const answeredFirst = new Set();
  await waitFor(ctx, 'the first Run', async () => {
    for (const card of await waitingCards(project, goalRef)) {
      const selection = approve(card);
      if (answeredFirst.has(card.cardKey) || selection === null) continue;
      if (await answerCard(ctx, project, card, selection, '', rec)) answeredFirst.add(card.cardKey);
    }
    return (await executions(project, goalRef)).length;
  }, count => count > 0, { timeoutMs: 40 * MINUTE });
  const change = await submitRequest(project, CHANGE, { goalId: goalRef.goalId });
  if (change?.status !== 'queued') throw broken(ctx, `requests/submit with goalId: ${change?.code} ${change?.reason}`);
  rec.facts.userCommand.push(CHANGE);
  await waitRequest(ctx, project, change.requestRoot, 40 * MINUTE);
  const candidate = await waitFor(ctx, 'the changed plan candidate', async () =>
    ready(await host.client.read('plans/request-candidate', project.scope, { goalRef, requestRef: change.requestRoot })),
  value => value?.head !== null && value?.head !== undefined && value.status === 'candidate', { timeoutMs: 30 * MINUTE });
  const goalBefore = ready(await host.client.read('goals/read', project.scope, goalRef));
  const applied = await host.client.write('plans/apply', project.scope,
    { proposalRef: candidate.head.ref, expectedProposalRevision: candidate.head.revision, decisionRefs: [] },
    [{ ref: goalRef, revision: goalBefore.goal.revision }]);
  rec.link('plan', applied?.value?.ref ?? null, applied?.value?.revision ?? null);
  if (applied?.status !== 'committed') throw broken(ctx, `plans/apply of the change: ${applied?.code} ${applied?.reason}`, 'versions');
  const adoptedPlan = applied.value.ref;
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
  const find = word => tasks.find(task => new RegExp(word, 'i').test(`${task.ref.taskId} ${task.definition?.title ?? ''}`));
  const div = find('div');
  const sub = find('sub');
  const mul = find('mul');
  rec.check('switch', div !== undefined && (sub === undefined || sub.disposition !== 'active') && mul?.effectivePhase === 'satisfied',
    `div ${div?.effectivePhase ?? '无'}；sub ${sub === undefined ? '不在新计划' : sub.disposition}；mul ${mul?.effectivePhase ?? '无'}`);
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
  rec.check('required-cancel', div !== undefined && div.effectivePhase === 'satisfied' && !completedWhileDivOpen && done.display.phase === 'COMPLETED',
    `最后 ${done.display.phase}；div ${div?.effectivePhase ?? '不存在'}；div 缺失或没满足时出现过 COMPLETED：${completedWhileDivOpen}`);
}

export default { ...def, run };
