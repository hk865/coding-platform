// The attached Goals after the eight scenarios (ruling 14:0x §2.2: run, not pre-declared `not-run`): C-216 cold start
// on an existing project, C-221 the whole E01→E02 cell (empty store → first plan → adopt → work → FAIL rework →
// delivery), C-222 a member the secretary creates really starting work. Each runs on W-accept under its own 50M cap.
import { ready } from '../lib/http.mjs';
import { chooseModel, coldStart, coversPath, executions, lines, messageView, openProject, said, savedAnswerOf,
  sessionQueries, taskRounds, textOf, waitGoal } from '../lib/flows.mjs';
import { roundEvidence } from '../scenarios/e08.mjs';

const MINUTE = 60_000;

const EXISTING = {
  'package.json': '{\n  "name": "g6-existing",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# inventory\n\nA small inventory library.\n',
  'src/store.js': 'const items = new Map();\nexport function put(sku, count) { items.set(sku, (items.get(sku) ?? 0) + count); }\nexport function get(sku) { return items.get(sku) ?? 0; }\n',
  'src/report.js': 'import { get } from \'./store.js\';\nexport function line(sku) { return `${sku}: ${get(sku)}`; }\n',
  'test/store.test.js': 'import test from \'node:test\';\nimport assert from \'node:assert\';\nimport { put, get } from \'../src/store.js\';\ntest(\'put adds\', () => { put(\'a\', 2); assert.equal(get(\'a\'), 2); });\n',
};

/** The adopted architecture's module paths, and the candidate answer's (`setup.architecture`), for the empty case. */
const adoptedPathsOf = architecture => (architecture?.catalog?.catalog?.modules ?? []).flatMap(module => module.paths ?? []);

/** P6J C-216: the adopted plan's baseline pin is read by version, never by the mutable `current` catalog. */
export const baselineSelectionOf = baselineRef => ({ selection: { kind: 'revision', ref: baselineRef } });

/**
 * P6J C-216 pass rule: the raw `architecture/observation-state` answer fixed before adoption says a repository was
 * observed (`current`), and the adopted version's module paths cover a real seed file. An unreadable observation or
 * adopted version is `entry-missing`, never "no observation"; an empty adopted path list fails even with a real
 * observation. `observation` is the raw response (`{status, value|code, reason}`), so a failed read is not folded into
 * an empty one.
 */
export const judgeObservedStart = ({ observation, adoptedPaths, seedFiles }) => {
  const body = observation ?? null;
  const read = body?.status === 'ready' ? body.value : null;
  const covered = seedFiles.find(file => adoptedPaths.some(path => coversPath(path, file))) ?? null;
  const observationRead = body === null ? 'no answer' : body.status === 'ready' ? 'ready' : body.status;
  return { covered, observationRead, empty: adoptedPaths.length === 0,
    ok: read?.current != null && covered !== null && adoptedPaths.length > 0 };
};
export const candidatePathsOf = round => {
  const answer = savedAnswerOf(round);
  const modules = answer?.setup?.architecture?.catalog?.modules ?? [];
  return { modules: modules.length, paths: modules.flatMap(module => module.paths ?? []),
    version: answer?.setup?.architecture?.baselineId ?? null };
};

/**
 * P6L C-222 (diagnosis C-222 row; `run-7d2-p6l.md` item 3): the evidence chain from the adoption receipt to the Work
 * Run, without changing either cell check. The Task is read from the adopted plan itself (`tasks/query {goalRef,
 * planRef}`, never the current plan). The secretary's request rounds (`requests/read`) and each adviser line's
 * `intervention_planning` rounds keep their frozen `create_member` grant (`roundEvidence` / `toolNamesOf`), every
 * `create_member` call with its `args` and raw result (created/reused/pending/needs_decision/rejected with
 * code/reason), and whether the call was for this adopted Task. A member card the person answered is kept from
 * `committedAnswers`; a `created` child line is read by `sessions/read` and compared with the Work Runs'
 * `claim.sessionRef`. Every failed segment is named in `gaps` and left null, never folded into "no member".
 */
export async function memberCreationEvidence(project, { goalRef, planRef, requestRoot, committedAnswers = [],
  lineRows = null, gaps = [] }) {
  const taskBody = await project.host.client.read('tasks/query', project.scope, { goalRef, planRef });
  const graph = ready(taskBody);
  if (graph === null) gaps.push(`tasks/query 采用计划 ${planRef?.planId ?? '-'}: ${said(taskBody)}`);
  const taskRows = graph?.tasks ?? [];
  const taskIds = taskRows.filter(task => task.definition?.taskKind === 'work').map(task => task.ref.taskId);
  const tasks = taskRows.map(task => ({ projectId: task.ref.projectId, goalId: task.ref.goalId, taskId: task.ref.taskId,
    taskKind: task.definition?.taskKind ?? null, scope: task.definition?.scope ?? null, execution: task.execution ?? null,
    effectivePhase: task.effectivePhase ?? null }));
  const lineList = lineRows ?? await lines(project, gaps);

  const requestBody = await project.host.client.read('requests/read', project.scope, { requestRoot });
  const view = ready(requestBody);
  if (view === null) gaps.push(`requests/read ${requestRoot?.queryJobId ?? '-'}: ${said(requestBody)}`);
  const secretaryRounds = view?.rounds ?? [];
  const secretaryEvidence = secretaryRounds.length === 0 ? [] : await roundEvidence(project, { rounds: secretaryRounds }, gaps);

  const adviserRounds = [];
  // F9: `duty: 'unknown'` includes a role-config read failure (`work-line.ts:121`); such a line is still scanned for an
  // adviser planning round and the failed duty is named, never silently dropped from the evidence.
  const unknownDuty = lineList.filter(entry => entry.duty === 'unknown');
  if (unknownDuty.length > 0) {
    gaps.push(`lines/list 参谋线读不到职责（duty unknown，含角色配置读失败）：${unknownDuty.map(row => row.key.sessionId).join(', ')}`);
  }
  for (const row of lineList.filter(entry => entry.duty === 'adviser' || entry.duty === 'unknown')) {
    for (const snapshot of await sessionQueries(project, row.key, gaps)) {
      const jobRef = { aggregateType: 'QueryJob', projectId: snapshot.ref.projectId,
        workspaceId: snapshot.ref.workspaceId, queryJobId: snapshot.ref.queryJobId };
      const intentBody = await project.host.client.read('queries/read', project.scope, jobRef);
      const intentRead = ready(intentBody);
      if (intentRead === null) {
        gaps.push(`queries/read ${jobRef.queryJobId}: ${said(intentBody)}`);
        continue;
      }
      const intent = intentRead.job?.job?.intent ?? null;
      if (intent?.execution?.kind !== 'intervention_planning' || intent.goalId !== goalRef.goalId) continue;
      const source = intent.execution.sourceMessageRef ?? null;
      let messageTaskRef = null;
      if (source !== null) {
        const message = await messageView(project, source);
        if (message === null) gaps.push(`messages/view ${source.messageId}: 读不到这轮建议的来源信`);
        else messageTaskRef = message.message?.taskRef ?? null;
      }
      adviserRounds.push({ row, jobRef, messageTaskRef, round: { ref: jobRef, kind: 'intervention_planning',
        status: intentRead.job?.job?.status ?? null, answer: null, ideas: [], selectedIdea: null, closeCode: null, session: row.key } });
    }
  }
  const adviserEvidence = adviserRounds.length === 0 ? []
    : await roundEvidence(project, { rounds: adviserRounds.map(entry => entry.round) }, gaps);

  const roundRow = (source, session, duty, evidence, messageTaskRef = null) => {
    const memberCalls = evidence.calls.filter(call => call.name === 'create_member').map(call => {
      const taskRef = call.args?.scope?.task ?? null;
      const result = evidence.results.find(entry => entry.callId === call.callId) ?? null;
      const raw = result?.values?.find(entry => entry !== null && typeof entry === 'object'
        && typeof entry.status === 'string') ?? result?.values?.[0] ?? null;
      const refusal = evidence.refusals.find(entry => entry.callId === call.callId) ?? null;
      // P6L2 B7: the Task is attributed by the full {projectId, goalId, taskId}, not by taskId alone (a model can name
      // the same taskId under another goal, which the platform refuses).
      const forTask = taskRef !== null && tasks.some(task => task.projectId === taskRef.projectId
        && task.goalId === taskRef.goalId && task.taskId === taskRef.taskId);
      return { callId: call.callId, status: call.status, taskRef, forTask, result: raw,
        refusal: refusal === null ? null : { code: refusal.code, reason: refusal.reason } };
    });
    const calledTaskIds = [...new Set(memberCalls.filter(call => call.forTask).map(call => call.taskRef.taskId))];
    const messageTaskInPlan = messageTaskRef !== null && taskIds.includes(messageTaskRef.taskId) ? [messageTaskRef.taskId] : [];
    const relatedTaskIds = [...new Set([...messageTaskInPlan, ...calledTaskIds])];
    return { source, roundRef: evidence.roundRef, session, duty, kind: evidence.kind, status: evidence.status,
      tools: evidence.tools, toolsGap: evidence.toolsGap, read: evidence.read, memberCalls,
      calledForTask: memberCalls.some(call => call.forTask), messageTaskRef, relatedTaskIds,
      related: relatedTaskIds.length > 0 };
  };
  const rounds = [
    ...secretaryEvidence.map((evidence, index) => roundRow('secretary-request',
      secretaryRounds[index]?.session ?? null, 'secretary', evidence)),
    ...adviserEvidence.map((evidence, index) => roundRow('adviser-planning', adviserRounds[index].row.key,
      adviserRounds[index].row.duty, evidence, adviserRounds[index].messageTaskRef)),
  ];

  const memberCards = committedAnswers.filter(entry => entry.card?.source?.kind === 'member_creation').map(entry => {
    // P6L C-222: the card's own sender/request keep who initiated the member (`decision-contracts.ts:468-475`); a card
    // with no sender was initiated by the platform (the Host), so that is written as null and named, not left blank.
    const senderSessionRef = entry.card.senderSessionRef ?? null;
    return {
      cardKey: entry.card.cardKey,
      taskRef: entry.card.taskRef ?? null,
      operationRef: (entry.card.source.pins ?? []).find(pin => pin.ref?.aggregateType === 'CoreOperation')?.ref ?? null,
      answer: entry.answer?.answer?.status ?? null,
      at: entry.at ?? null,
      senderSessionRef,
      requestRef: entry.card.requestRef ?? null,
      state: entry.card.state ?? null,
      initiatedBy: senderSessionRef === null ? 'platform' : senderSessionRef.sessionId,
    };
  });

  // P6L2 B6: the operation behind each matched create_member call (or the card's pinned CoreOperation) is read for its
  // caller, Task, progress and rejection, on the normal path and on a Goal that timed out.
  const operationRefs = new Map();
  for (const round of rounds) {
    for (const call of round.memberCalls) {
      if (call.forTask !== true) continue;
      // P6L2 B6: the created result's `operation` is the OperationRef itself (`MemberRequestResultV1`).
      const op = call.result?.operation ?? null;
      if (op !== null) operationRefs.set(JSON.stringify(op), op);
    }
  }
  for (const card of memberCards) if (card.operationRef !== null) operationRefs.set(JSON.stringify(card.operationRef), card.operationRef);
  const operations = [];
  for (const ref of operationRefs.values()) {
    const body = await project.host.client.read('sessions/operation', project.scope, ref);
    const operation = ready(body);
    if (operation === null) {
      gaps.push(`sessions/operation ${ref.operationId ?? ref.refKey ?? '-'}: ${said(body)}`);
      operations.push({ ref, read: { status: body?.status ?? 'no answer', code: body?.code ?? null, reason: body?.reason ?? null } });
      continue;
    }
    const action = operation.action ?? null;
    operations.push({ ref, read: { status: 'ready' }, kind: action?.kind ?? null, phase: operation.phase ?? null,
      caller: action?.input?.caller ?? null, task: action?.input?.scope?.task ?? null,
      progress: action?.progress ?? null, failure: operation.failure ?? null });
  }

  const childSessions = new Map();
  for (const round of rounds) {
    for (const call of round.memberCalls) {
      if (call.forTask !== true) continue;
      if (call.result?.status !== 'created') continue;
      if (call.result.session?.sessionId === undefined) {
        gaps.push(`create_member ${call.callId}: created 结果没有子线`);
        continue;
      }
      if (!childSessions.has(call.result.session.sessionId)) {
        childSessions.set(call.result.session.sessionId, { session: call.result.session,
          operation: call.result.operation ?? null, roundRef: round.roundRef, taskRef: call.taskRef });
      }
    }
  }
  const gapBeforeRuns = gaps.length;
  const runItems = await executions(project, goalRef, gaps);
  const runsReadable = gaps.length === gapBeforeRuns;
  const runs = runItems.map(item => ({ runId: item.run.ref.runId, outcome: item.run.outcome ?? null,
    taskId: item.run.task?.taskId ?? null, claim: item.outbox?.claim?.sessionRef ?? null }));
  const createdLines = [];
  for (const [sessionId, created] of childSessions) {
    const body = await project.host.client.read('sessions/read', project.scope, created.session);
    const record = ready(body);
    if (record === null) gaps.push(`sessions/read ${sessionId}: ${said(body)}`);
    const claimed = runs.filter(run => run.claim?.sessionId === sessionId && created.taskRef !== null
      && run.taskId === created.taskRef.taskId).map(run => run.runId);
    createdLines.push({ session: created.session, operation: created.operation, roundRef: created.roundRef,
      taskRef: created.taskRef,
      recordRead: record === null
        ? { status: body?.status ?? 'no answer', code: body?.code ?? null, reason: body?.reason ?? null }
        : { status: 'ready' },
      secretaryCreated: record === null ? null : record.record?.secretaryCreated === true,
      workRuns: claimed, claimMatches: runsReadable ? claimed.length > 0 : null });
  }

  return { goalRef, planRef, requestRoot,
    taskRead: { status: taskBody?.status ?? 'no answer', code: taskBody?.code ?? null, reason: taskBody?.reason ?? null },
    tasks, taskIds, rounds, operations, memberCards, runs, runsReadable, createdLines, gaps: [...new Set(gaps)] };
}

/**
 * P6J C-216: the one sequence the scenario and the driver test share. The observation that already existed before the
 * adoption is fixed at the one point before `initialization/adopt` (`coldStart`'s `beforeAdopt`), not after it: an
 * adoption's own capture does not prove the repository was observed. Then the adopted plan's own
 * `effectiveArchitectureBaseline.ref` fixes the version, and `architecture/read` reads that exact revision — never the
 * mutable `current` catalog, which can name another version. Returns the raw answers so the caller judges them.
 */
export async function observeExistingProject(ctx, project, text, rec) {
  let observationBody = null;
  const started = await coldStart(ctx, project, text, rec, { beforeAdopt: async () => {
    observationBody = await project.host.client.read('architecture/observation-state', project.scope, { workspace: project.scope });
  } });
  const candidate = candidatePathsOf(started.round);
  const graphBody = await project.host.client.read('tasks/query', project.scope, { goalRef: started.goalRef, planRef: started.plan });
  const graph = ready(graphBody);
  const baselineRef = graph?.plan?.effectiveArchitectureBaseline?.ref ?? null;
  const revisionBody = baselineRef === null ? null
    : await project.host.client.read('architecture/read', project.scope, baselineSelectionOf(baselineRef));
  const revision = revisionBody === null ? null : ready(revisionBody);
  const observed = observationBody?.status === 'ready' ? observationBody.value : null;
  const observationDetail = observationBody === null ? '观察读口缺失：没有读到 architecture/observation-state'
    : observationBody.status === 'ready' ? null
      : `观察读口缺失：${observationBody.status} ${observationBody.code ?? ''} ${observationBody.reason ?? ''}`.trim();
  const graphDetail = graph === null ? `采用计划读不到：${graphBody?.status ?? 'no answer'} ${graphBody?.code ?? ''} ${graphBody?.reason ?? ''}`.trim() : null;
  const revisionDetail = baselineRef === null ? `采用计划没有 effectiveArchitectureBaseline.ref（${graph === null ? '计划读不到' : '字段为空'}）`
    : revision === null ? `architecture/read（revision ${JSON.stringify(baselineRef)}）读不到：${revisionBody?.status ?? 'no answer'} ${revisionBody?.code ?? ''} ${revisionBody?.reason ?? ''}`.trim()
      : null;
  const candidateDetail = `候选 ${candidate.modules} 个模块、路径 ${candidate.paths.join(', ') || '无'}（${candidate.version ?? '版本未记'}）`;
  const adopted = revision === null ? [] : adoptedPathsOf(revision);
  const adoptedModules = revision?.catalog?.catalog?.modules?.length ?? 0;
  const detail = `${observationDetail ?? (observed?.current != null ? `采用前观察 ${observed.current.observedAt}（${JSON.stringify(observed.current.captureRef)}）；` : '采用前没有已观察的仓库（observation-state 的 current 为空）；')}${
    candidateDetail}；采用版 ${baselineRef === null ? '版本未记' : JSON.stringify(baselineRef)}：${adoptedModules} 个模块、${adopted.length} 个路径：${adopted.join(', ') || '无'}`;
  if (observationDetail !== null) {
    rec.uncover('observed-start', 'entry-missing', `${detail}；${observationDetail}`);
  } else if (graphDetail !== null) {
    rec.uncover('observed-start', 'entry-missing', `${detail}；${graphDetail}`);
  } else if (revisionDetail !== null) {
    rec.uncover('observed-start', 'entry-missing', `${detail}；${revisionDetail}`);
  } else {
    const judged = judgeObservedStart({ observation: observationBody, adoptedPaths: adopted, seedFiles: Object.keys(EXISTING) });
    rec.check('observed-start', judged.ok, `${detail}；覆盖种子文件：${judged.covered ?? '无'}${judged.empty ? '；采用版路径列表是空的，空列表不能通过' : ''}`);
    rec.facts.c216 = { candidate, adoptedPaths: adopted, adoptedModules, baselineRef,
      observationRead: observationBody.status, observedAt: observed?.current?.observedAt ?? null, covered: judged.covered };
  }
  if (rec.facts.c216 === undefined) {
    rec.facts.c216 = { candidate, adoptedPaths: adopted, adoptedModules, baselineRef,
      observationRead: observationBody?.status ?? 'no answer', observedAt: observed?.current?.observedAt ?? null, covered: null,
      gaps: [observationDetail, graphDetail, revisionDetail].filter(entry => entry !== null) };
  }
  return { started, candidate, observationBody, observed, graph, revision, baselineRef, adopted, adoptedModules };
}

const c216 = {
  id: 'C-216', group: 'attached', rows: ['C-216'],
  checks: [
    { id: 'observed-start', rows: ['C-216'], text: '从已有仓库的观察得到现状架构候选（模块对应已有目录），不是空目录走六阶段' },
    { id: 'adopted-done', rows: ['C-216'], text: '人确认采用首方案，Goal 交付' },
  ],
  async run(ctx, rec) {
    const host = ctx.hosts['w-accept'];
    const project = await openProject(ctx, host, 'c216', EXISTING);
    rec.facts.project = project;
    rec.facts.model = await chooseModel(ctx, host, project);
    const text = '接手这个已有项目：先看现状，再加一个 remove(sku, count)（不能减到负数），并加测试。验收：node --test 通过。';
    const observed = await observeExistingProject(ctx, project, text, rec);
    const started = observed.started;
    const done = await waitGoal(ctx, project, started.goalRef, { timeoutMs: 90 * MINUTE, rec });
    rec.check('adopted-done', done.display.phase === 'COMPLETED', `Goal ${done.display.phase}`);
  },
};

const c221 = {
  id: 'C-221', group: 'attached', rows: ['C-221'],
  checks: [
    { id: 'first-plan', rows: ['C-221'], text: '空库只给 Goal：真实首案 Query 出候选并由人采用' },
    { id: 'fail-rework', rows: ['C-221'], text: '检查 FAIL 后返工，同一 Task 新 Attempt/Run，再 PASS' },
    { id: 'delivered', rows: ['C-221'], text: 'Goal 交付（COMPLETED）' },
  ],
  async run(ctx, rec) {
    const host = ctx.hosts['w-accept'];
    const project = await openProject(ctx, host, 'c221', { 'README.md': '# fizzbuzz\n' });
    rec.facts.project = project;
    rec.facts.model = await chooseModel(ctx, host, project);
    const text = '实现 fizzbuzz.js，导出 fizzbuzz(n) 返回 1..n 的数组（3 的倍数 Fizz，5 的倍数 Buzz，都是 FizzBuzz），'
      + 'n 不是正整数时抛 RangeError；加 test/fizzbuzz.test.js 覆盖边界。验收：node --test 通过。';
    const started = await coldStart(ctx, project, text, rec);
    rec.check('first-plan', started.plan !== null, `首案采用 ${started.plan?.planId}`);
    const done = await waitGoal(ctx, project, started.goalRef, { timeoutMs: 90 * MINUTE, rec });
    // The whole chain on one Task (lead ruling 11-14 #17; second review #1): each Run of the Task has its own check
    // chain (read by `subjectRunRef`); a FAIL round judging one Run → a later-started Run of the same Task (the rework)
    // → a PASS round judging that later Run. Several Runs alone (a pause, a resume) are not a rework.
    const tasks = ready(await host.client.read('tasks/query', project.scope, { goalRef: started.goalRef }))?.tasks ?? [];
    let found = null;
    for (const task of tasks.filter(entry => entry.definition?.taskKind !== 'gate')) {
      const chains = await taskRounds(project, started.goalRef, task.ref.taskId);
      const judged = chains.flatMap(chain => chain.rounds.map(round => ({ round, start: Date.parse(chain.item.run.startedAt) })));
      const failed = judged.find(entry => entry.round.outcome === 'FAIL');
      const passed = failed === undefined ? undefined : judged.find(entry => entry.round.outcome === 'PASS' && entry.start > failed.start
        && JSON.stringify(entry.round.subjectRunRef) !== JSON.stringify(failed.round.subjectRunRef));
      if (passed !== undefined) { found = { task: task.ref.taskId, failed: failed.round, passed: passed.round }; break; }
    }
    if (found === null) rec.uncover('fail-rework', 'not-run', '没有同一 Task 上“检查轮 FAIL → 返工的新 Run → 检查轮 PASS”这条链（真实模型一次做对，不伪造失败）');
    else rec.pass('fail-rework', `Task ${found.task}：FAIL（判 ${found.failed.subjectRunRef.runId}）→ 返工 Run ${found.passed.subjectRunRef.runId} → PASS`);
    rec.check('delivered', done.display.phase === 'COMPLETED', `Goal ${done.display.phase}`);
  },
};

const c222 = {
  id: 'C-222', group: 'attached', rows: ['C-222'],
  checks: [
    { id: 'created', rows: ['C-222'], text: '秘书建出执行者（secretaryCreated 的线）' },
    { id: 'started', rows: ['C-222'], text: '建出的执行者领取、进入 Run、改文件并做完' },
  ],
  async run(ctx, rec) {
    const host = ctx.hosts['w-accept'];
    const project = await openProject(ctx, host, 'c222', { 'README.md': '# shapes\n', 'shapes.js': 'export const area = r => Math.PI * r * r;\n' });
    rec.facts.project = project;
    rec.facts.model = await chooseModel(ctx, host, project);
    const text = '请你先新建一个执行成员（create_member）专门做这件事：在 shapes.js 加 perimeter(r)，并加 test/shapes.test.js。验收：node --test 通过。';
    const started = await coldStart(ctx, project, text, rec);
    // P6L C-222: answer cards stay visible to the evidence chain (diagnosis C-222; `run-7d2-p6l.md` item 3).
    const committedAnswers = [];
    // P6L2 B6: the evidence is taken on a normal end and on a Goal wait that timed out; the two cells' own criteria are
    // unchanged (a timed-out wait still propagates as before, after the evidence is kept).
    let done = null;
    let stop = null;
    try {
      done = await waitGoal(ctx, project, started.goalRef, { timeoutMs: 90 * MINUTE, rec, committedAnswers });
    } catch (error) {
      stop = error;
    }
    const gaps = [];
    const lineRows = await lines(project, gaps);
    const created = [];
    for (const row of lineRows) {
      const record = ready(await host.client.read('sessions/read', project.scope, row.key));
      if (record?.record?.secretaryCreated === true) created.push(row.key.sessionId);
    }
    // Evidence only: the two checks below keep their own rule and result.
    rec.facts.c222 = await memberCreationEvidence(project, { goalRef: started.goalRef, planRef: started.plan,
      requestRoot: started.requestRoot, committedAnswers, lineRows, gaps });
    if (rec.facts.c222.gaps.length > 0) rec.note(`C-222 证据缺口：${rec.facts.c222.gaps.join('；')}`);
    if (stop !== null) throw stop;
    rec.check('created', created.length > 0, `secretaryCreated 的线：${created.join(', ') || '无'}`);
    const runs = (await executions(project, started.goalRef)).filter(item => created.includes(item.outbox?.claim?.sessionRef?.sessionId));
    rec.check('started', runs.some(item => item.run.outcome === 'completed') && done.display.phase === 'COMPLETED',
      `建出的线上 Run：${runs.map(item => `${item.run.ref.runId}/${item.run.outcome}`).join(', ') || '无'}；Goal ${done.display.phase}；${textOf(done.display.cause).slice(0, 120)}`);
  },
};

export default { cells: [c216, c221, c222] };
