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
  const done = await waitGoal(ctx, project, goalRef, { timeoutMs: 150 * MINUTE, rec, committedAnswers, returnOnDecide: true });
  rec.note(`E09 Goal ended ${done.display.phase}`);
  rec.facts.stoppedFor = done.stoppedFor;
  if (done.stoppedFor !== null) rec.note(`E09 目标停下等人：${done.stoppedFor}`);

  // Quick check #8: the chain by identity only, link by link. The executor's report message (its own successful
  // `send_session_message` naming parseDate, with the message ref from the tool result) → the decision whose source is
  // that message, or a message the adviser sent in a turn whose input names that message → the Plan revision that
  // decision's receipt adopted → the Tasks that version supersedes and their successors → the successors' Runs under
  // that Plan and their actual input. Time order, title changes or counts never stand in for a link.
  // G6F R1: complete records that show a link was not met → `fail`; the link before it did not happen → `uncovered
  // (not-run)`; a read that did not answer or a record that lacks the fact → `uncovered (env-unavailable)` with the
  // read's own words. None of these links lacks a public entry, so none is `entry-missing`.
  // 上报是只读询问（inquiry）时，回答它的是参谋线派生的只读副本，不进参谋线自己的轮（DESIGN §1.6:318、§4.7）。
  // 副本算在被问的那条线上（§1.6:321），按消息上记下的副本认那一轮。副本不出卡，所以“人决定”“新版本”两环
  // 记为 not-run，不判失败（lead 11-17 裁定，E09 第六次）。
  const gaps = [];
  const rows = await lines(project, gaps);
  const dutyOf = new Map(rows.map(row => [row.key.sessionId, row.duty]));
  const turnsByDuty = { executor: [], adviser: [] };
  for (const row of rows) {
    if (row.duty === 'secretary') continue;
    turnsByDuty[row.duty === 'adviser' ? 'adviser' : 'executor'].push(...await sessionTurns(project, row.key, gaps));
  }
  const unread = gaps.length === 0 ? null : `读不全：${gaps.join('；')}`;
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
  // A sent message's ref is `{ aggregateType: 'SessionMessage', projectId, workspaceId, messageId }`: the tool result
  // carries the saved record (`communication-tools.ts:482-486`, `contracts/mailbox.ts:131-132`); it has no sessionId
  // (G6F F5: the old test asked for one, so no report ever linked).
  const refOf = result => findAll(result.values, node => node.aggregateType === 'SessionMessage' && typeof node.messageId === 'string')[0] ?? null;
  // lead 11-18：只认真正的上报：action_request、inquiry。notify 不给参谋开轮，不算。
  const REPORT_INTENTS = ['action_request', 'inquiry'];
  const reportResult = turnsByDuty.executor.flatMap(turn => turn.results)
    .find(result => result.name === 'send_session_message' && REPORT_INTENTS.includes(result.args?.intent)
      && /parseDate/.test(JSON.stringify(result.args ?? {})));
  const reportRef = reportResult === undefined ? null : refOf(reportResult);
  const later = ['adviser-explains', 'person-decides', 'new-version'];
  if (reportResult === undefined) {
    if (unread !== null) unreadable(['executor-reports', ...later], `${unread}；读到的历史里没有执行者提到 parseDate 的上报`);
    else {
      // 计划开工前就消掉了冲突（任务书没有把冲突留给执行者上报）：这一格没有发生的机会，记 not-run，不判失败。
      const firstBody = await host.client.read('tasks/query', project.scope, { goalRef, planRef: started.plan });
      const first = ready(firstBody);
      const keeps = (first?.plan?.assignments ?? []).filter(entry => /parseDate/.test(entry.instruction)
        && /冲突|conflict/i.test(entry.instruction) && /上报|参谋|adviser|由人决定|人来决定|交给人/.test(entry.instruction));
      if (first === null) unreadable(['executor-reports', ...later], `tasks/query 首版 ${started.plan?.planId ?? '-'}：${said(firstBody)}`);
      else if (keeps.length === 0) {
        const quote = (first.plan.assignments ?? []).filter(entry => /parseDate/.test(entry.instruction))
          .map(entry => `${entry.taskId}「${entry.instruction.slice(0, 200)}」`).join('；');
        notRun(['executor-reports', ...later], `首版计划 ${started.plan.planId} 的任务书没有把 parseDate 冲突留给执行者上报（开工前已消掉）：${quote || '没有提到 parseDate 的任务书'}`);
      } else {
        rec.fail('executor-reports', `首版计划把冲突留给执行者上报（${keeps.map(entry => entry.taskId).join(', ')}），执行者没有发 action_request 或 inquiry`);
        notRun(later, '没有执行者的上报，后面这几环没有发生');
      }
    }
  } else if (reportRef === null) {
    rec.pass('executor-reports', `执行者上报：${JSON.stringify(reportResult.args)}`);
    unreadable(later, `上报的工具结果里没有消息引用（记录不全，结果文字：${reportResult.text.slice(0, 300)}），后面这几环无从关联`);
  } else {
    rec.pass('executor-reports', `执行者上报 ${reportRef.messageId}：${JSON.stringify(reportResult.args)}`);
    const recipient = reportResult.args?.recipient?.sessionId ?? null;
    const recipientDuty = dutyOf.get(recipient) ?? null;
    const namesBoth = text => /api\.js/.test(text) && /report\.js/.test(text);
    // The adviser turns that received this message (their input names its message id) and what they sent.
    const received = turnsByDuty.adviser.filter(turn => turn.input.includes(reportRef.messageId));
    const explained = received.find(turn => turn.final !== null && namesBoth(turn.final));
    // 发给参谋的只读询问：参谋线自己的轮收不到它，回答它的是参谋的只读副本。
    const copy = reportResult.args?.intent === 'inquiry' && recipientDuty === 'adviser' ? await copyAnswerOf(reportRef) : null;
    if (received.length > 0) {
      rec.check('adviser-explains', explained !== undefined, `收到上报 ${reportRef.messageId} 的参谋轮 ${received.length} 个；最终答复同时点到 api.js 和 report.js 的：${explained?.turnId ?? '无'}`);
    } else if (copy !== null && copy.text !== null) {
      rec.check('adviser-explains', namesBoth(copy.text), `上报 ${reportRef.messageId} 是只读询问，由参谋线 ${recipient} 的只读副本 ${copy.child} 回答（判据来自${copy.from}）；回答同时点到 api.js 和 report.js：${namesBoth(copy.text) ? '是' : '否'}`);
    } else if (copy !== null && copy.pending) {
      rec.uncover('adviser-explains', 'not-run', `上报 ${reportRef.messageId} 是只读询问，参谋线的只读副本${copy.child === null ? '还没建' : ` ${copy.child} 还没答复`}：参谋解释这一环还没发生`);
    } else if (copy !== null) {
      unreadable(['adviser-explains'], `上报 ${reportRef.messageId} 是只读询问，由参谋线的只读副本 ${copy.child ?? '（未知）'} 回答，但读不到它的回答：${copy.why}`);
    } else if (unread !== null) {
      unreadable(['adviser-explains'], `${unread}；读到的参谋轮输入里没有上报 ${reportRef.messageId}`);
    } else if (recipientDuty !== 'adviser') {
      // Run 3: the report went to an ordinary member line; the adviser never received it.
      rec.uncover('adviser-explains', 'not-run', `上报 ${reportRef.messageId} 发给了 ${recipientDuty ?? '不在 lines/list 里的'} 线 ${recipient}，没有发给参谋；没有参谋轮收到它，参谋解释这一环没有发生`);
    } else {
      rec.uncover('adviser-explains', 'not-run', `上报 ${reportRef.messageId} 发给了参谋线 ${recipient}，但参谋的 ${turnsByDuty.adviser.length} 个轮的输入里都没有它：参谋还没处理这条上报`);
    }
    const sources = [reportRef, ...received.flatMap(turn => turn.results.filter(result => result.name === 'send_session_message').map(refOf)).filter(Boolean)];
    const decision = committedAnswers.find(entry => entry.card.source.kind === 'message'
      && sources.some(ref => JSON.parse(entry.card.source.key).messageRef?.messageId === ref.messageId));
    if (decision === undefined) {
      if (copy !== null) {
        notRun(['person-decides', 'new-version'], `上报 ${reportRef.messageId} 走的是只读询问（inquiry），由参谋的只读副本回答；只读副本不出卡，要人定的事应发 action_request。人决定和新版本这两环没有发生`);
      } else if (rec.results.get('adviser-explains')?.status === 'pass') {
        rec.fail('person-decides', `参谋解释了上报 ${reportRef.messageId}，但人提交成功的 ${committedAnswers.length} 张卡里没有一张的来源是这条上报或参谋为它发出的消息：冲突没有交给人决定`);
        notRun(['new-version'], '没有人对这次冲突的决定，新版本这一环没有发生');
      } else {
        notRun(['person-decides', 'new-version'], `参谋没有解释这条上报（${rec.results.get('adviser-explains')?.status ?? '未判'}），人对它的决定和新版本这两环没有发生`);
      }
    } else {
      rec.check('person-decides', decision.card.source.pins.length > 0, `${decision.at} 人答卡 ${decision.card.cardKey}（来源 ${JSON.parse(decision.card.source.key).messageRef.messageId}），钉住 ${JSON.stringify(decision.card.source.pins)}`);
      const adopted = findAll(decision.answer, node => node.aggregateType === 'PlanRevision')[0] ?? null;
      // The adopted version itself, even when a later one followed (`tasks/query` takes a planRef, plan-contracts.ts:210).
      const graphBody = adopted === null ? null : await host.client.read('tasks/query', project.scope, { goalRef, planRef: adopted });
      const graph = ready(graphBody);
      // The product's replacement: a superseded Task names the Task that takes it over (`replacedByTaskId`,
      // contracts/plan.ts:71-77); the advisory relations (`coordination`/`expected_dependency`) never mean replacement.
      const superseded = graph === null ? [] : [...new Map(findAll(graph, node => typeof node.taskId === 'string'
        && typeof node.replacedByTaskId === 'string').map(node => [node.taskId, node])).values()];
      if (adopted === null) notRun(['new-version'], `人答卡 ${decision.card.cardKey} 的回执里没有采用的计划版本：这次决定没有产生新版本，替换这一环没有发生`);
      else if (graph === null) unreadable(['new-version'], `tasks/query ${adopted.planId}：${said(graphBody)}`);
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
