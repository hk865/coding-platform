// B06 closing cells on W-accept (draft §5.4; slice-B06-SPEC.md:599-608): one Goal per cell, a read-only explore Task
// with a `witness` requirement (`requiredReadPaths`, the shape of `tests/helpers/SB06-witness-fixture.ts:50-66`),
// a real executor. The workspace's trusted checks come from a cold-start seed (as in E05). W1b, W4, W6, W8, W11, W13
// are cited from B06 G2's green tests, not rerun. The report never writes the slice-9 review pass as B06 passing.
import { newId, ready } from '../lib/http.mjs';
import { chooseModel, coldStart, createGoal, driverStart, ensurePolicy, openProject, openRoleLine,
  proposeAndApply, taskRounds, waitFor, waitGoal } from '../lib/flows.mjs';

const MINUTE = 60_000;
const READ_PATHS = ['src/module.js', 'package.json', 'README.md'];
const FILES = {
  'package.json': '{\n  "name": "g6-b06",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6-b06\n\nA module to be read.\n',
  'src/module.js': 'export const answer = () => 42;\n',
};
const SEED_REQUEST = '初始化这个项目：在 README.md 末尾加一行“只读核对用”。验收：node --test 通过。只改 README.md。';

const def = {
  id: 'B06', rows: ['B06-W1a', 'B06-W2', 'B06-W3', 'B06-W5', 'B06-W10', 'B06-W12'],
  checks: [
    { id: 'W1a', rows: ['B06-W1a'], text: '只读 Task 经 native read 读 requiredReadPaths，最终文字非空，witness PASS，complete_task 成功' },
    { id: 'W2', rows: ['B06-W2'], text: 'Run 写了文件 → witness FAIL，不完成' },
    { id: 'W3', rows: ['B06-W3'], text: '没读 → FAIL' },
    { id: 'W5', rows: ['B06-W5'], text: '非 Git → INCONCLUSIVE，不完成' },
    { id: 'W10', rows: ['B06-W10'], text: 'witness PASS 不能满足 reviewer 要求' },
    { id: 'W12', rows: ['B06-W12'], text: 'tasks/query → graph/look checks/evidence → materials/open 四段下钻，body 为 {roundRef,subjectRunRef,reportText}' },
    { id: 'explore', rows: ['B06-cond3'], text: '非 plan_only 的只读 explore 走同一链；漏写 witness 要求不被硬拒，也不冒充通过' },
  ],
};

function draft(goalId, instruction, { witness = true, reviewer = false } = {}) {
  const requirements = [
    ...(witness ? [{ requirementId: 'r-witness', requirementLevel: 'required', kind: 'witness', description: '只读见证', requiredReadPaths: READ_PATHS }] : []),
    ...(reviewer ? [{ requirementId: 'r-review', requirementLevel: 'required', kind: 'reviewer', description: '独立审阅' }] : []),
  ];
  return {
    schemaVersion: 2, planId: `${goalId}-plan`, planRevision: 1, goalId, stages: [],
    tasks: [
      { taskId: 'read', title: '只读核对', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: { kind: 'goal' }, executionIntent: 'request_execution', sizeClass: 'explore' },
      { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'read', role: 'local-workbench', instruction }],
    obligations: [
      ...(requirements.length === 0 ? [] : [{ obligationId: 'o-read', title: '只读核对', requirementLevel: 'required', taskIds: ['read'], verificationRequirements: requirements }]),
      { obligationId: 'o-gate', title: 'Goal gate', requirementLevel: 'required', taskIds: requirements.length === 0 ? ['read', 'gate'] : ['gate'],
        verificationRequirements: [{ requirementId: 'r-gate', requirementLevel: 'required', kind: 'static', description: 'node --test 通过' }] },
    ],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

/** The four-step read chain (condition 5): Task → its round (checks) → the round's evidence → the report material. */
async function readChain(project, goalRef) {
  const graph = ready(await project.host.client.read('tasks/query', project.scope, { goalRef }));
  const task = graph?.tasks?.find(entry => entry.ref.taskId === 'read');
  const page = { afterCursor: null, limit: 20 };
  const checks = ready(await project.host.client.read('graph/look', project.scope,
    { goalRef, target: { kind: 'node', node: { kind: 'task', ref: task?.ref, planRef: graph?.plan?.ref } }, relation: 'checks', page }));
  // The newest round of the Task (a Task with rework has several; the page order is not by ordinal).
  const roundItem = [...(checks?.items ?? [])].sort((left, right) =>
    (right.round?.ordinal ?? right.round?.roundOrdinal ?? 0) - (left.round?.ordinal ?? left.round?.roundOrdinal ?? 0))[0];
  const roundRef = roundItem?.round?.ref ?? roundItem?.node?.ref ?? null;
  const evidence = roundRef === null ? null : ready(await project.host.client.read('graph/look', project.scope,
    { goalRef, target: { kind: 'node', node: { kind: 'round', ref: roundRef } }, relation: 'evidence', page }));
  const round = evidence?.items?.[0]?.round ?? null;
  const witness = round?.checks?.find(check => check.checkId === 'platform:witness') ?? null;
  const material = witness?.reportRef === undefined || witness?.reportRef === null ? null
    : ready(await project.host.client.read('materials/open', project.scope, { ref: witness.reportRef, usage: 'historical_explanation' }));
  let body = null;
  try { body = material === null ? null : JSON.parse(material.body); } catch { body = null; }
  return { task, round, witness, body, evidence: evidence?.items?.[0]?.evidence ?? [] };
}

async function witnessGoal(ctx, project, rec, label, instruction, options) {
  const goalId = newId(`g6-b06-${label}`);
  const goal = await createGoal(ctx, project, goalId, `B06 ${label}`, rec);
  await proposeAndApply(ctx, project, goal.ref, draft(goalId, instruction, options), `B06 ${label}`, rec);
  await driverStart(ctx, project, goal.ref, { flowId: newId(`b06-${label}`), taskId: 'read' });
  // Wait until the read Task's first round is finalized (or the Goal completes), then pause so a FAIL cell does not
  // keep reworking on the budget.
  const chain = await waitFor(ctx, `the ${label} round`, () => readChain(project, goal.ref),
    value => value.round?.status === 'finalized', { timeoutMs: 40 * MINUTE });
  const display = ready(await project.host.client.read('goals/display', project.scope, { goalRef: goal.ref }));
  if (display?.display?.phase !== 'COMPLETED') {
    const read = ready(await project.host.client.read('goals/read', project.scope, goal.ref));
    if (read !== null) {
      await project.host.client.write('goals/control', project.scope, { goalRef: goal.ref, control: 'pause', reason: 'G6 B06 cell read' },
        [{ ref: goal.ref, revision: read.goal.revision }, { ref: { aggregateType: 'GoalPhase', projectId: goal.ref.projectId, goalId }, revision: 0 }],
        { expect: ['busy', 'invalid'] });
    }
  }
  return { goal, chain, display };
}

const READ = `用 read 逐个读 ${READ_PATHS.join('、')}，然后用一两句话说明 src/module.js 导出了什么。不要改任何文件。`;

async function run(ctx, rec) {
  const host = ctx.hosts['w-accept'];
  const project = await openProject(ctx, host, 'b06', FILES);
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, host, project);
  const seed = await coldStart(ctx, project, SEED_REQUEST, rec);
  await waitGoal(ctx, project, seed.goalRef, { timeoutMs: 60 * MINUTE, rec });
  await ensurePolicy(ctx, project, ['static', 'witness', 'reviewer']);

  const w1 = await witnessGoal(ctx, project, rec, 'w1a', READ);
  const w1done = await waitGoal(ctx, project, w1.goal.ref, { timeoutMs: 40 * MINUTE, rec, until: ['COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED', 'NEEDS_DECISION'] });
  const w1final = await readChain(project, w1.goal.ref);
  rec.check('W1a', w1final.witness?.outcome === 'PASS' && w1final.task?.effectivePhase === 'satisfied' && (w1final.body?.reportText ?? '').length > 0,
    `witness ${w1final.witness?.outcome}/${w1final.witness?.sourceStatus}；Task ${w1final.task?.effectivePhase}；Goal ${w1done.display.phase}；报告 ${(w1final.body?.reportText ?? '').length} 字`);
  const keys = w1.chain.body === null ? [] : Object.keys(w1.chain.body).sort();
  rec.check('W12', JSON.stringify(keys) === JSON.stringify(['reportText', 'roundRef', 'subjectRunRef']),
    `四段：task ${w1.chain.task ? '有' : '无'} → round ${w1.chain.round ? '有' : '无'} → evidence ${w1.chain.evidence.length} → material keys ${keys.join(',') || '无'}`);

  const w2 = await witnessGoal(ctx, project, rec, 'w2', `${READ} 读完以后，把这一两句话写进 notes.txt。`);
  rec.check('W2', w2.chain.witness?.outcome === 'FAIL' && w2.chain.task?.effectivePhase !== 'satisfied',
    `witness ${w2.chain.witness?.outcome}；Task ${w2.chain.task?.effectivePhase}`);
  const w3 = await witnessGoal(ctx, project, rec, 'w3', '不要读任何文件，直接回答一句“没有读文件”。不要改任何文件。');
  rec.check('W3', w3.chain.witness?.outcome === 'FAIL' && w3.chain.task?.effectivePhase !== 'satisfied',
    `witness ${w3.chain.witness?.outcome}；Task ${w3.chain.task?.effectivePhase}`);

  await openRoleLine(ctx, project, 'reviewer', [{ kind: 'project' }], rec);
  const w10 = await witnessGoal(ctx, project, rec, 'w10', READ, { reviewer: true });
  // Lead ruling 11-14 #16: the two kinds of evidence stay apart. The witness requirement is covered by the platform
  // witness check; the reviewer requirement is answered only by the booked review (`verification-round-read.ts:258-269`)
  // and never lists the witness check, so an independent reviewer's own PASS is allowed.
  // A work chain is read by its subject Run (second review #1): the newest round of the read Task's newest Run.
  const w10round = (await taskRounds(project, w10.goal.ref, 'read')).map(entry => entry.head).filter(Boolean).at(-1) ?? null;
  const requirement = kind => w10round?.delivery?.requirements?.find(entry => entry.kind === kind) ?? null;
  const witnessReq = requirement('witness');
  const reviewerReq = requirement('reviewer');
  const witnessCovers = (witnessReq?.checks ?? []).some(check => check.checkId === 'platform:witness');
  const reviewerUsesWitness = (reviewerReq?.checks ?? []).some(check => check.checkId === 'platform:witness');
  rec.check('W10', w10.chain.witness?.outcome === 'PASS' && witnessCovers && reviewerReq !== null && !reviewerUsesWitness,
    `witness ${w10.chain.witness?.outcome}，witness 要求由 platform:witness 覆盖：${witnessCovers}；reviewer 要求 ${reviewerReq?.state ?? '无'}，覆盖它的检查 ${
      (reviewerReq?.checks ?? []).map(check => check.checkId).join(', ') || '无（由独立审阅回答）'}；Task ${w10.chain.task?.effectivePhase}`);

  const explore = await witnessGoal(ctx, project, rec, 'explore', READ, { witness: false });
  rec.check('explore', explore.chain.round !== null && explore.chain.witness === null,
    `没写 witness 要求的 explore：计划被收下，轮 ${explore.chain.round?.status ?? '无'}，没有 platform:witness 检查`);

  // W5: a non-Git workspace; its trusted checks come from its own seed, then the same read-only cell.
  const plain = await openProject(ctx, host, 'b06-plain', FILES, { git: false });
  await chooseModel(ctx, host, plain, rec.facts.model.modelId);
  const plainSeed = await coldStart(ctx, plain, SEED_REQUEST, rec);
  await waitGoal(ctx, plain, plainSeed.goalRef, { timeoutMs: 60 * MINUTE, rec, until: ['COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED', 'NEEDS_DECISION'] });
  await ensurePolicy(ctx, plain, ['static', 'witness', 'reviewer']);
  const w5 = await witnessGoal(ctx, plain, rec, 'w5', READ);
  rec.check('W5', w5.chain.witness?.outcome === 'INCONCLUSIVE' && w5.chain.task?.effectivePhase !== 'satisfied',
    `非 Git：witness ${w5.chain.witness?.outcome}/${w5.chain.witness?.sourceStatus}；Task ${w5.chain.task?.effectivePhase}`);
  rec.note('B06-W1b、W4、W6、W8、W11、W13 和条件 1 引 B06 G2 的绿测（f580d77e，决定 121-122），G6 不重跑；第 9 片审阅的通过不写成 B06 通过。');
}

export default { ...def, run };
