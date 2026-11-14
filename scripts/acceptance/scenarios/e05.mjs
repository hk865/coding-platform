// E05: two independent Sessions in one workspace, Runs really overlapping, an actual shared file, decision 89's
// three cross-checks and three counterexamples (draft §1.1; MVP-BEHAVIOR.md:357, :366-374; slice-9-SPEC.md:660).
// Book route (9-start-rulings.frozen.md:660) after one cold-start seed Goal: a settings-opened workspace gets its
// trusted check configuration only from a saved initial-plan Answer (`evidence-service.ts:1256`,
// `host-settings-types.ts:170-182`), so the seed's adoption brings architecture, policy and checks; the E05 Goal
// itself is the explicit `goals/create` → policy → `plans/propose` → `plans/apply` → two `workflow/driver-start`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, ready } from '../lib/http.mjs';
import { broken, chooseModel, coldStart, createGoal, driverStart, ensurePolicy, executions, findAll, openProject, openRoleLine,
  proposeAndApply, runHistory, taskRounds, textOf, turnsOf, waitGoal } from '../lib/flows.mjs';

const MINUTE = 60_000;
const SEED = {
  'package.json': '{\n  "name": "g6-e05",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6-e05\n\nUsers and orders.\n',
  'src/users.js': 'export function createUser(name, email) {\n  return { name, email };\n}\n',
  'src/orders.js': 'export function createOrder(id, contactEmail) {\n  return { id, contactEmail };\n}\n',
  'src/rules.js': '// Shared validation rules.\n',
};
// Planted after both tasks started (decision 89: the copy is buried after the start, so it can always be found).
const PLANTED = {
  // name different, same rule → must be reported
  'src/legacy/contact-check.js': 'export function looksLikeMailAddress(text) {\n  return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(text);\n}\n',
  // name same, rule different → must not be reported
  'src/legacy/is-email.js': 'export function isEmail(value) {\n  return typeof value === \'string\' && value.length <= 254;\n}\n',
};

const def = {
  id: 'E05',
  rows: ['C-182', 'C-183', 'C-185', 'C-71', 'C-73', 'C-191', 'C-208', 'C-217', 'C-218'],
  checks: [
    { id: 'overlap', rows: ['C-182', 'C-183', 'C-217'], text: '两个 Run 的 startedAt/endedAt 真实重叠，claim Session 不同' },
    { id: 'gate', rows: ['C-185'], text: '同模块重叠门回 task/module 和在跑的 Run' },
    { id: 'paths', rows: ['C-185', 'C-217'], text: '实际改动能给出具体 path（含共享文件）' },
    { id: 'kept', rows: ['C-185'], text: '两个任务的独立成果都还在，两个任务都 satisfied' },
    { id: 'single-occupancy', rows: ['C-71'], text: '同一 Session 同时最多一个写入执行（没有同 Session 时间重叠的两个 Run）' },
    { id: 'convention', rows: ['C-208'], text: '接口约定只交给一个任务写，另一个任务引用它' },
    { id: 'duplicates', rows: ['C-208'], text: 'project_source compare（duplicates:true）列出埋入的副本及两处位置' },
    { id: 'reviewer', rows: ['C-208', 'C-218'], text: '审阅者独立判断它是同一条规则（审阅要求有结论）' },
    { id: 'name-different', rows: ['C-208'], text: '名字不同、规则相同：报' },
    { id: 'name-same', rows: ['C-208'], text: '名字相同、规则不同：不报' },
    { id: 'temporary', rows: ['C-208'], text: '临时件在做完之前已收回（结束时没有计划外的未跟踪文件）' },
    { id: 'line-choice', rows: ['C-73', 'C-191'], text: '派工排除只读副本/等待/退役线并按六键排序' },
  ],
};

const plantedNames = ['contact-check', 'looksLikeMailAddress'];
const sameNameFile = 'is-email';
const PLANTED_COPY = 'src/legacy/contact-check.js';
// Only the RULE conclusion counts (quick check #5): "名字不同但属同一条规则" is a same-rule reading; a name difference
// never reads as "not the same". The negative markers name the rule itself.
const SAME_RULE = /同一(条)?(校验)?规则|规则相同|相同的规则|一样的规则|重复|duplicate|same (validation )?rule/i;
const NOT_SAME = /规则不同|不同的规则|不是同一(条)?规则|不属于同一(条)?规则|不是重复|不算重复|并非重复|not (a )?duplicate|not the same rule|different rule/i;

/** The answer's sentences that name one of `names`, each read as `same`, `not` (a negation wins) or `unclear`. */
function conclusions(text, names) {
  return text.split(/[。；;\n]|\.\s/).filter(sentence => names.some(name => sentence.includes(name)))
    .map(sentence => ({ sentence: sentence.trim(), reading: NOT_SAME.test(sentence) ? 'not' : SAME_RULE.test(sentence) ? 'same' : 'unclear' }));
}

/**
 * Judge one conclusion from the formal answer's text (second review #5): an explicit reading decides; a mention
 * without a clear conclusion cannot be shown from the text and is `uncovered`, never a pass.
 */
function judgeSentence(rec, id, found, wantSame, label) {
  const quote = found.slice(0, 2).map(entry => `「${entry.sentence}」`).join(' ');
  if (found.length === 0) {
    if (wantSame) rec.fail(id, `正式审阅答复没有提到 ${label}`);
    else rec.pass(id, `正式审阅答复没有提到 ${label}（没有报）`);
  } else if (found.some(entry => entry.reading === 'same')) {
    rec.check(id, wantSame, `正式审阅答复说 ${label} 是同一条规则：${quote}`);
  } else if (found.every(entry => entry.reading === 'not')) {
    rec.check(id, !wantSame, `正式审阅答复说 ${label} 不是同一条规则：${quote}`);
  } else {
    rec.uncover(id, 'entry-missing', `正式审阅答复提到 ${label}，但文字没有明确结论：${quote}`);
  }
}

function draft(goalId, moduleRef) {
  const work = (taskId, title, files) => ({ taskId, title, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
    phase: 'pending', scope: { kind: 'module', stageId: 'build', moduleRef }, executionIntent: 'request_execution', plannedFiles: files });
  return {
    schemaVersion: 2, planId: `${goalId}-plan`, planRevision: 1, goalId,
    stages: [{ stageId: 'build', title: 'Build' }],
    tasks: [
      work('t-users', 'users 邮箱校验', ['src/users.js', 'src/rules.js', 'test/users.test.js']),
      work('t-orders', 'orders 邮箱校验', ['src/orders.js', 'src/rules.js', 'test/orders.test.js']),
      { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [
      { taskId: 't-users', role: 'local-workbench', instruction: '在 src/users.js 的 createUser 里校验 email：必须形如 name@domain.tld，不合格抛 TypeError。校验规则写成 src/rules.js 导出的 isEmail(value)，users 引用它。加 test/users.test.js（node:test）。' },
      { taskId: 't-orders', role: 'local-workbench', instruction: '在 src/orders.js 的 createOrder 里校验 contactEmail，规则和 users 的邮箱规则相同。先查 src/rules.js 和项目里有没有现成的同一条规则，有就引用，不要另写一份。加 test/orders.test.js（node:test）。' },
    ],
    obligations: [
      { obligationId: 'o-tests', title: '测试通过', requirementLevel: 'required', taskIds: ['t-users', 't-orders', 'gate'],
        verificationRequirements: [{ requirementId: 'r-tests', requirementLevel: 'required', kind: 'static', description: 'node --test 全部通过' }] },
      { obligationId: 'o-review', title: '独立审阅', requirementLevel: 'required', taskIds: ['t-users', 't-orders'],
        verificationRequirements: [{ requirementId: 'r-review', requirementLevel: 'required', kind: 'reviewer',
          description: '独立审阅：两处邮箱校验是不是同一条规则；项目里有没有同一条规则的重复定义（名字不同也算），名字相同但规则不同的不算' }] },
    ],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

const intervalOf = item => [Date.parse(item.run.startedAt), Date.parse(item.run.endedAt ?? new Date().toISOString())];
const claimSession = item => item.outbox?.claim?.sessionRef?.sessionId ?? item.session?.ref?.sessionId ?? null;

async function run(ctx, rec) {
  const host = ctx.hosts['w-accept'];
  const project = await openProject(ctx, host, 'e05', SEED);
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, host, project);
  const seedText = '初始化这个项目：在 README.md 末尾加一行“校验规则统一放在 src/rules.js”。检查用 node --test。只改 README.md。';
  rec.facts.userCommand = [seedText];
  const seed = await coldStart(ctx, project, seedText, rec);
  await waitGoal(ctx, project, seed.goalRef, { timeoutMs: 60 * MINUTE, rec });
  // Second review #6: the seed's work is not E05's. The person commits what the seed left, and that commit is the
  // fixed baseline every E05 path is compared against.
  const gitRun = args => {
    const out = execFileSync('git', args, { cwd: project.root, encoding: 'utf8' });
    ctx.report.command(`git ${args.join(' ')} (in ${project.root}) -> 0`);
    return out.trim();
  };
  gitRun(['add', '-A']);
  if (gitRun(['status', '--porcelain']).length > 0) gitRun(['commit', '-q', '-m', 'g6 e05: the seed Goal is done']);
  const baseline = gitRun(['rev-parse', 'HEAD']);
  rec.facts.baseline = baseline;

  const architecture = ready(await host.client.read('architecture/read', project.scope, { selection: { kind: 'current' } }));
  const modules = architecture?.catalog?.catalog?.modules ?? [];
  const module = modules.find(entry => entry.paths.some(path => path === 'src' || path.startsWith('src'))) ?? modules[0];
  if (module === undefined) throw broken(ctx, 'the seed adoption left no architecture module (architecture/read current)');
  await ensurePolicy(ctx, project, ['static', 'reviewer']);
  const reviewer = await openRoleLine(ctx, project, 'reviewer', [{ kind: 'project' }], rec);
  const goalId = newId('g6-e05');
  const goal = await createGoal(ctx, project, goalId, '给 users 和 orders 都加邮箱格式校验，两处用同一条校验规则', rec);
  rec.facts.userCommand.push('goals/create + plans/propose（两个任务：t-users、t-orders）');
  await proposeAndApply(ctx, project, goal.ref, draft(goalId, module.ref.moduleId), 'E05: 两个并行任务共用一条校验规则', rec);
  for (const taskId of ['t-users', 't-orders']) {
    const started = await driverStart(ctx, project, goal.ref, { flowId: `e05-${taskId}`, taskId });
    rec.note(`driver-start ${taskId}: ${started?.status} ${started?.value?.state ?? started?.code ?? ''}`);
  }

  let planted = false;
  let gateSeen = null;
  let released = null;
  const firstSeen = new Map();
  const display = await waitGoal(ctx, project, goal.ref, { timeoutMs: 150 * MINUTE, rec, onPoll: async () => {
    // Second review #6: plant only after both Tasks have really started (each has a Run with a start time), and count
    // it planted only when every save was taken.
    const runs = await executions(project, goal.ref);
    const startedTasks = new Set(runs.filter(item => item.run.startedAt).map(item => item.run.task.taskId));
    if (!planted && startedTasks.has('t-users') && startedTasks.has('t-orders')) {
      for (const [path, content] of Object.entries(PLANTED)) {
        const saved = await host.client.command('files/save', project.scope, { path, expectedRevision: null, content }, { commandId: newId('plant') });
        if (!['ready', 'committed'].includes(saved?.status)) throw broken(ctx, `files/save of the planted ${path}: ${saved?.status} ${saved?.code ?? ''} ${saved?.reason ?? ''}`, 'duplicates');
        rec.note(`planted ${path}: ${saved.status}`);
      }
      planted = true;
      rec.facts.plantedAt = new Date().toISOString();
    }
    const gates = ready(await host.client.read('goals/overlap-gates', project.scope, { goalRef: goal.ref, page: { limit: 20 } }))?.gates ?? [];
    for (const gate of gates) {
      if (gateSeen === null && gate.running.length > 0) gateSeen = gate;
      // `gate.since` is a cursor, not a time: the age is from the driver's first sight of this gate.
      const key = JSON.stringify(gate.ref);
      if (!firstSeen.has(key)) firstSeen.set(key, Date.now());
      // The person releases a gate nobody satisfied for 10 minutes (the human release half of C1).
      if (gate.release === null && released === null && Date.now() - firstSeen.get(key) > 10 * MINUTE) {
        released = await host.client.read('goals/overlap-release', project.scope,
          { commandId: newId('release'), gate: gate.ref, revision: gate.revision, reason: 'G6 E05: 人放行，让两个任务并行' });
      }
    }
  } });
  rec.note(`E05 Goal ended ${display.display.phase}`);

  const runs = await executions(project, goal.ref);
  for (const item of runs) { rec.link('run', item.run.ref, null); rec.link('session', item.outbox?.claim?.sessionRef ?? null); }
  const byTask = taskId => runs.filter(item => item.run.task.taskId === taskId);
  // Any pair of the two Tasks' Runs on different Sessions whose intervals overlap (a rework later must not hide it).
  let pair = null;
  for (const users of byTask('t-users')) {
    for (const orders of byTask('t-orders')) {
      const [a0, a1] = intervalOf(users);
      const [b0, b1] = intervalOf(orders);
      const overlap = Math.min(a1, b1) - Math.max(a0, b0);
      if (overlap > 0 && claimSession(users) !== claimSession(orders) && (pair === null || overlap > pair.overlap)) pair = { users, orders, overlap };
    }
  }
  rec.check('overlap', pair !== null, pair === null
    ? `t-users ${byTask('t-users').length} 个 Run、t-orders ${byTask('t-orders').length} 个 Run，没有一对在不同 Session 上时间重叠`
    : `重叠 ${Math.round(pair.overlap / 1000)} s：${pair.users.run.ref.runId}（${claimSession(pair.users)}）和 ${pair.orders.run.ref.runId}（${claimSession(pair.orders)}）`);
  if (pair !== null) rec.facts.overlapPair = [pair.users.run.ref, pair.orders.run.ref];
  if (gateSeen !== null) {
    rec.check('gate', gateSeen.moduleId === module.ref.moduleId && gateSeen.running.length > 0,
      `门：module ${gateSeen.moduleId}，等待 ${gateSeen.waiting.taskId}，在跑 ${gateSeen.running.map(entry => `${entry.task.taskId}/${entry.run.runId}`).join(', ')}；放行 ${released === null ? '注记或未放行' : `人（${released.status}）`}`);
  } else rec.fail('gate', '整个运行期间 goals/overlap-gates 没有出现带在跑 Run 的门');
  // `executions/read` has no `changedFiles` in this tree; `files/compare` against the initial commit gives the paths.
  const compared = ready(await host.client.read('files/compare', project.scope, {
    workspace: { aggregateType: 'Workspace', ...project.scope }, before: { kind: 'git', commit: baseline }, after: { kind: 'working_tree' } }));
  const changed = [...new Set((textOf(compared).match(/"path":"[^"]+"/g) ?? []).map(entry => entry.slice(8, -1)))];
  rec.facts.changedPaths = changed;
  rec.check('paths', changed.includes('src/users.js') && changed.includes('src/orders.js') && changed.includes('src/rules.js'),
    `files/compare 给出：${changed.join(', ') || '无'}`);
  const tasks = ready(await host.client.read('tasks/query', project.scope, { goalRef: goal.ref }))?.tasks ?? [];
  const phase = taskId => tasks.find(task => task.ref.taskId === taskId)?.effectivePhase;
  const source = path => { try { return readFileSync(join(project.root, path), 'utf8'); } catch { return ''; } };
  rec.check('kept', phase('t-users') === 'satisfied' && phase('t-orders') === 'satisfied'
    && /isEmail|rules/.test(source('src/users.js')) && /isEmail|rules/.test(source('src/orders.js')),
  `t-users ${phase('t-users')}，t-orders ${phase('t-orders')}`);
  const sessions = new Map();
  let doubled = null;
  for (const item of runs) {
    const key = claimSession(item);
    for (const other of sessions.get(key) ?? []) {
      const [a0, a1] = intervalOf(item);
      const [b0, b1] = intervalOf(other);
      if (Math.min(a1, b1) > Math.max(a0, b0)) doubled = `${item.run.ref.runId} 和 ${other.run.ref.runId} 在 ${key}`;
    }
    sessions.set(key, [...(sessions.get(key) ?? []), item]);
  }
  rec.check('single-occupancy', doubled === null, doubled ?? `${runs.length} 个 Run，没有同 Session 时间重叠`);
  const users_ = source('src/users.js');
  const orders_ = source('src/orders.js');
  const rules = source('src/rules.js');
  rec.check('convention', /export\s+(function|const)\s+isEmail/.test(rules) && /rules(\.js)?['"]/.test(users_) && /rules(\.js)?['"]/.test(orders_)
    && !/function\s+isEmail/.test(orders_), `rules.js 定义 isEmail：${/isEmail/.test(rules)}；users/orders 都从 rules 引用`);

  // Judged by turn identity (lead ruling 11-14 #9): the Work Runs' own successful `project_source` results, and the
  // reviewer's final answers; reading a file (input or a read result) is never a report.
  const workTurns = [];
  for (const item of runs) workTurns.push(...turnsOf(await runHistory(project, item.run.ref)));
  // Second review #5: only the duplicate candidates' two locations count (`ports.ts:188-194`), not a file name anywhere
  // in the comparison: a candidate with the planted copy at one location and another file at the other.
  const compares = workTurns.flatMap(turn => turn.results).filter(result => result.name === 'project_source'
    && /"duplicates"\s*:\s*true/.test(JSON.stringify(result.args ?? {})));
  const candidates = compares.flatMap(result => findAll(result.values, node => Array.isArray(node.candidates)).flatMap(report => report.candidates));
  const plantedPair = candidates.find(candidate => [candidate.first?.path, candidate.second?.path].includes(PLANTED_COPY)
    && candidate.first?.path !== candidate.second?.path);
  rec.check('duplicates', plantedPair !== undefined, plantedPair === undefined
    ? `成功的 project_source（duplicates:true）结果 ${compares.length} 个，候选 ${candidates.length} 条，没有一条的两处位置之一是 ${PLANTED_COPY}`
    : `候选：${plantedPair.first.path}:${plantedPair.first.line} ↔ ${plantedPair.second.path}:${plantedPair.second.line}`);
  // Quick check #5: the accepted Answer is read through its round. The round that answers the reviewer requirement →
  // that round's review Evidence (its `source.checkId` is null, `verification-round-read.ts:258-290`) → the Evidence's
  // own summary and body. A link that cannot be read is `uncovered`, never judged on another answer of the line.
  const usersRounds = (await taskRounds(project, goal.ref, 't-users')).flatMap(entry => entry.rounds);
  const reviewRound = usersRounds.filter(round => round.delivery.requirements.some(entry => entry.kind === 'reviewer')).at(-1);
  const reviewState = reviewRound?.delivery.requirements.find(entry => entry.kind === 'reviewer')?.state ?? null;
  rec.facts.checkRoundRef = reviewRound?.roundRef ?? null;
  const look = reviewRound === undefined ? null : ready(await host.client.read('graph/look', project.scope, { goalRef: goal.ref,
    target: { kind: 'node', node: { kind: 'round', ref: reviewRound.roundRef } }, relation: 'evidence', page: { afterCursor: null, limit: 20 } }));
  const review = findAll(look, node => node.evidence?.source?.checkId === null && typeof node.evidence?.outcome === 'string')[0]?.evidence ?? null;
  let answer = null;
  if (review !== null) {
    answer = review.summary?.text ?? '';
    if (review.summary?.artifactRef) {
      const material = ready(await host.client.read('materials/open', project.scope, { ref: review.summary.artifactRef, usage: 'historical_explanation' }));
      if (typeof material?.body === 'string') answer += `\n${material.body}`;
    }
  }
  if (answer === null) {
    const missing = reviewRound === undefined ? 't-users 的检查轮里没有一轮带 reviewer 要求' : `轮 ${JSON.stringify(reviewRound.roundRef)} 没有可读的正式审阅 Evidence`;
    for (const id of ['reviewer', 'name-different', 'name-same']) rec.uncover(id, 'entry-missing', `接不上：${missing}（审阅要求状态 ${reviewState}）`);
  } else {
    rec.check('reviewer', ['PASS', 'FAIL'].includes(review.outcome),
      `轮 ${JSON.stringify(reviewRound.roundRef)} 的正式审阅 Evidence ${review.evidenceId}：${review.outcome}；审阅要求状态 ${reviewState}`);
    judgeSentence(rec, 'name-different', conclusions(answer, plantedNames), true, 'contact-check.js / looksLikeMailAddress');
    judgeSentence(rec, 'name-same', conclusions(answer, [sameNameFile]), false, 'is-email.js');
  }
  const untracked = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: project.root, encoding: 'utf8' })
    .split('\n').filter(line => line.startsWith('??')).map(line => line.slice(3));
  ctx.report.command(`git status --porcelain --untracked-files=all (in ${project.root}) -> 0`);
  const planned = ['test/users.test.js', 'test/orders.test.js', ...Object.keys(PLANTED)];
  const extra = untracked.filter(path => !planned.includes(path));
  rec.check('temporary', extra.length === 0, extra.length === 0 ? '没有计划外的未跟踪文件' : `计划外的未跟踪文件：${extra.join(', ')}`);
  rec.uncover('line-choice', 'entry-missing', '公开读口不给派工时的候选线和六键排序依据（lines/list 只给结果），驱动看不到排除和排序本身');
  ctx.shared.e05 = { project, goalRef: goal.ref, runs, module };
}

export default { ...def, run };
