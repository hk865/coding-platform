// E09: two work packages raise an interface conflict early; executor reports → adviser explains → the person's
// concrete decision → a new plan version / replacement task → a formal architecture change; source drift located
// (draft §1.4; MVP-BEHAVIOR.md:361; slice-9-SPEC.md:663, :689). `architecture/revise` is in the tree
// (`core-routes.ts:664`), so C-212 runs. The 8E contact layer is `uncovered (8E optional)` in notes only
// (9-start-rulings.frozen.md:966-967), never in `uncovered[]`.
import { ready } from '../lib/http.mjs';
import { chooseModel, coldStart, executions, findAll, lines, openProject, orNull, registration, runHistory, sessionTurns, taskRounds, turnsOf, waitFor,
  waitGoal } from '../lib/flows.mjs';

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
    { id: 'executor-reports', rows: ['C-185', 'C-211'], text: '冲突由执行者上报（消息），不是只由平台门推断' },
    { id: 'adviser-explains', rows: ['C-211'], text: '参谋解释具体对象和影响' },
    { id: 'person-decides', rows: ['C-211', 'C-62'], text: '人的决定有授权与版本（答卡带钉住的版本）' },
    { id: 'new-version', rows: ['C-211', 'C-55'], text: '新计划版本替换受影响任务，新定义进上下文' },
    { id: 'formal-change', rows: ['C-212'], text: '正式架构变更走 architecture/revise，产生新目录版本' },
    { id: 'drift', rows: ['C-212', 'C-89'], text: '漂移能定位版本/文件（compare-formal 的 finding 带 path）' },
    { id: 'observation-after-adopt', rows: ['C-65'], text: '正式架构采用后自动再抓一次观测' },
    { id: 'observation-after-pass', rows: ['C-98'], text: '检查 PASS 定稿后自动抓一次观测' },
    { id: 'rounds', rows: ['C-93', 'C-95', 'C-218'], text: '每个 Work Task 开轮、PASS 无缺口、证据写入' },
    { id: 'uncovered-round', rows: ['C-99'], text: '没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS' },
  ],
};

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
  const done = await waitGoal(ctx, project, goalRef, { timeoutMs: 150 * MINUTE, rec, committedAnswers });
  rec.note(`E09 Goal ended ${done.display.phase}`);

  // Quick check #8: the chain by identity only, link by link. The executor's report message (its own successful
  // `send_session_message` naming parseDate, with the message ref from the tool result) → the decision whose source is
  // that message, or a message the adviser sent in a turn whose input names that message → the Plan revision that
  // decision's receipt adopted → that Plan's replacement relation → the replacing Task's Runs under that Plan and their
  // actual input. Time order, title changes or counts never stand in for a link: a link that cannot be read is
  // `uncovered` with that link named.
  const turnsByDuty = { executor: [], adviser: [] };
  for (const row of await lines(project)) {
    if (row.duty === 'secretary') continue;
    turnsByDuty[row.duty === 'adviser' ? 'adviser' : 'executor'].push(...await sessionTurns(project, row.key));
  }
  const refOf = result => findAll(result.values, node => typeof node.messageId === 'string' && typeof node.sessionId === 'string')[0] ?? null;
  const reportResult = turnsByDuty.executor.flatMap(turn => turn.results)
    .find(result => result.name === 'send_session_message' && /parseDate/.test(JSON.stringify(result.args ?? {})));
  const reportRef = reportResult === undefined ? null : refOf(reportResult);
  rec.check('executor-reports', reportResult !== undefined,
    reportResult === undefined ? '执行者没有成功发出提到 parseDate 的 send_session_message' : `执行者上报 ${reportRef?.messageId ?? '（结果里没有消息引用）'}：${JSON.stringify(reportResult.args)}`);
  const missing = (ids, text) => { for (const id of ids) rec.uncover(id, 'entry-missing', `接不上：${text}`); };
  if (reportResult === undefined) {
    for (const id of ['adviser-explains', 'person-decides', 'new-version']) rec.uncover(id, 'not-run', '没有执行者的上报，后面的链无从关联');
  } else if (reportRef === null) {
    missing(['adviser-explains', 'person-decides', 'new-version'], '上报工具结果里读不到消息引用');
  } else {
    // The adviser turns that received this message (their input names its message id) and what they sent.
    const received = turnsByDuty.adviser.filter(turn => turn.input.includes(reportRef.messageId));
    const explained = received.find(turn => turn.final !== null && /api\.js/.test(turn.final) && /report\.js/.test(turn.final));
    if (received.length === 0) missing(['adviser-explains'], `参谋的 turn 输入里没有这条上报消息的 id ${reportRef.messageId}`);
    else rec.check('adviser-explains', explained !== undefined, `收到上报 ${reportRef.messageId} 的参谋轮 ${received.length} 个；最终答复同时点到 api.js 和 report.js 的：${explained?.turnId ?? '无'}`);
    const sources = [reportRef, ...received.flatMap(turn => turn.results.filter(result => result.name === 'send_session_message').map(refOf)).filter(Boolean)];
    const decision = committedAnswers.find(entry => entry.card.source.kind === 'message'
      && sources.some(ref => JSON.parse(entry.card.source.key).messageRef?.messageId === ref.messageId));
    if (decision === undefined) {
      missing(['person-decides', 'new-version'], `人提交成功的 ${committedAnswers.length} 张卡里，没有一张的来源是这条上报或参谋为它发出的消息`);
    } else {
      rec.check('person-decides', decision.card.source.pins.length > 0, `${decision.at} 人答卡 ${decision.card.cardKey}（来源 ${JSON.parse(decision.card.source.key).messageRef.messageId}），钉住 ${JSON.stringify(decision.card.source.pins)}`);
      const adopted = findAll(decision.answer, node => node.aggregateType === 'PlanRevision')[0] ?? null;
      const graph = ready(await host.client.read('tasks/query', project.scope, { goalRef }));
      const relations = findAll(graph, node => typeof node.fromTaskId === 'string' && typeof node.toTaskId === 'string' && /replac|supersed/i.test(String(node.kind ?? node.relation ?? '')));
      if (adopted === null) missing(['new-version'], '决定的回执里没有它采用的计划版本');
      else if (JSON.stringify(graph?.plan?.ref) !== JSON.stringify(adopted)) missing(['new-version'], `决定采用的 ${adopted.planId} 不是现在的计划 ${graph?.plan?.ref?.planId}，替换关系读不到那一版`);
      else if (relations.length === 0) missing(['new-version'], `采用的 ${adopted.planId} 在 tasks/query 里没有可读的替换关系`);
      else {
        const replacing = [...new Set(relations.map(relation => relation.fromTaskId))];
        const fed = [];
        const ranUnder = [];
        for (const item of (await executions(project, goalRef)).filter(entry => replacing.includes(entry.run.task.taskId)
          && JSON.stringify(entry.plan?.ref) === JSON.stringify(adopted))) {
          ranUnder.push(item.run.ref.runId);
          const title = graph.tasks.find(task => task.ref.taskId === item.run.task.taskId)?.definition?.title ?? '\u0000';
          if (turnsOf(await runHistory(project, item.run.ref)).some(turn => turn.input.includes(title))) fed.push(`${item.run.task.taskId}/${item.run.ref.runId}`);
        }
        const text = `决定采用 ${adopted.planId}；替换关系 ${relations.map(relation => `${relation.fromTaskId}→${relation.toTaskId}`).join(', ')}；这一版下替换任务的 Run ${ranUnder.join(', ') || '无'}；输入带新定义的 ${fed.join(', ') || '无'}`;
        if (ranUnder.length === 0) rec.uncover('new-version', 'not-run', `${text}（替换的任务在这一版下还没有 Run）`);
        else rec.check('new-version', fed.length === ranUnder.length, text);
      }
    }
  }
  // The person's formal architecture change: give the module owning src/api.js a declared parseDate interface.
  const architecture = ready(await host.client.read('architecture/read', project.scope, { selection: { kind: 'current' } }));
  const catalog = architecture?.catalog;
  const module = catalog?.catalog?.modules?.find(entry => entry.paths.some(path => 'src/api.js'.startsWith(path))) ?? catalog?.catalog?.modules?.[0];
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
  rec.check('observation-after-pass', JSON.stringify(now?.current?.captureRef) !== JSON.stringify(afterAdopt?.current?.captureRef),
    `观测：采用后 ${JSON.stringify(afterAdopt?.current?.captureRef ?? null)} → 现在 ${JSON.stringify(now?.current?.captureRef ?? null)}`);

  // Each work Task's rounds, read by each of its Runs (second review #1); the newest round of a satisfied Task must be
  // PASS with no gap, and no INCONCLUSIVE round may leave its Task satisfied.
  const tasks = ready(await host.client.read('tasks/query', project.scope, { goalRef }))?.tasks ?? [];
  const rounds = [];
  for (const task of tasks.filter(entry => entry.definition?.taskKind !== 'gate')) {
    for (const chain of await taskRounds(project, goalRef, task.ref.taskId)) {
      for (const round of chain.rounds) { rounds.push({ task, round }); rec.link('evidence', round.roundRef, round.revision); }
    }
  }
  const newest = new Map(rounds.map(entry => [entry.task.ref.taskId, entry]));
  const satisfied = [...newest.values()].filter(entry => entry.task.effectivePhase === 'satisfied');
  rec.check('rounds', satisfied.length > 0 && satisfied.every(entry => entry.round.outcome === 'PASS' && (entry.round.gaps?.length ?? 0) === 0),
    `satisfied 任务的最新轮：${satisfied.map(entry => `${entry.task.ref.taskId} ${entry.round.outcome}/gaps ${entry.round.gaps?.length ?? 0}`).join(', ') || '无'}`);
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
