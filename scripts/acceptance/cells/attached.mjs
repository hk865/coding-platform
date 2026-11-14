// The attached Goals after the eight scenarios (ruling 14:0x §2.2: run, not pre-declared `not-run`): C-216 cold start
// on an existing project, C-221 the whole E01→E02 cell (empty store → first plan → adopt → work → FAIL rework →
// delivery), C-222 a member the secretary creates really starting work. Each runs on W-accept under its own 50M cap.
import { ready } from '../lib/http.mjs';
import { chooseModel, coldStart, executions, lines, openProject, taskRounds, textOf, waitGoal } from '../lib/flows.mjs';

const MINUTE = 60_000;

const EXISTING = {
  'package.json': '{\n  "name": "g6-existing",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# inventory\n\nA small inventory library.\n',
  'src/store.js': 'const items = new Map();\nexport function put(sku, count) { items.set(sku, (items.get(sku) ?? 0) + count); }\nexport function get(sku) { return items.get(sku) ?? 0; }\n',
  'src/report.js': 'import { get } from \'./store.js\';\nexport function line(sku) { return `${sku}: ${get(sku)}`; }\n',
  'test/store.test.js': 'import test from \'node:test\';\nimport assert from \'node:assert\';\nimport { put, get } from \'../src/store.js\';\ntest(\'put adds\', () => { put(\'a\', 2); assert.equal(get(\'a\'), 2); });\n',
};

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
    const started = await coldStart(ctx, project, text, rec);
    const architecture = ready(await host.client.read('architecture/read', project.scope, { selection: { kind: 'current' } }));
    const paths = (architecture?.catalog?.catalog?.modules ?? []).flatMap(module => module.paths);
    rec.check('observed-start', paths.some(path => path.startsWith('src')), `采用的架构模块路径：${paths.join(', ') || '无'}`);
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
    const done = await waitGoal(ctx, project, started.goalRef, { timeoutMs: 90 * MINUTE, rec });
    const created = [];
    for (const row of await lines(project)) {
      const record = ready(await host.client.read('sessions/read', project.scope, row.key));
      if (record?.record?.secretaryCreated === true) created.push(row.key.sessionId);
    }
    rec.check('created', created.length > 0, `secretaryCreated 的线：${created.join(', ') || '无'}`);
    const runs = (await executions(project, started.goalRef)).filter(item => created.includes(item.outbox?.claim?.sessionRef?.sessionId));
    rec.check('started', runs.some(item => item.run.outcome === 'completed') && done.display.phase === 'COMPLETED',
      `建出的线上 Run：${runs.map(item => `${item.run.ref.runId}/${item.run.outcome}`).join(', ') || '无'}；Goal ${done.display.phase}；${textOf(done.display.cause).slice(0, 120)}`);
  },
};

export default { cells: [c216, c221, c222] };
