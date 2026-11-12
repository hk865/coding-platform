/**
 * KLS-2c-1 the two reconcile triggers besides the idle heartbeat ([2C1-24]): a Work Run that ends reconciles its
 * workspace (K38); an adoption reconciles the project's workspaces before it adopts (K39). Both worlds take an idle
 * threshold no row reaches, so only the named trigger can reconcile.
 * - K38: the S8E semantic world (a real Host, scripted model, Goal, Plan and scribe line) holds one scribe Work Run at
 *   its model request (`holdS8EScribeRun`) while a person edits a note file; after the Run, at most 20 rounds of three
 *   heartbeats, reading `notes/list` after each.
 * - K39: the KLS2C Host world; policy, Goal, an adopted Plan with a `core` module task and a future revision of it
 *   (whose adoption reads the current architecture) through the public routes, then the conflict and `plans/apply`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeat } from '../helpers/IV-host-fixture.js';
import {
  KLS2C_NEVER_IDLE_MS, kls2cAdopt, kls2cConflict, kls2cNoteWrite, kls2cScopePins, openKLS2CHost,
} from '../helpers/KLS2C-knowledge-host.js';
import { committedValue } from '../helpers/S6A-memory-fixture.js';
import { holdS8EScribeRun, openS8ESemanticWorld, S8E_SCOPE } from '../helpers/S8E-semantic-world.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  await cleanupRestart();
});

it('K38 a Work Run that ends reconciles its workspace: a note edited during the Run is marked external_edit', async () => {
  const world = await openS8ESemanticWorld({ scribeTasks: 1,
    hostOptions: { scribeReminderPeriodMs: 25, linkBatchIdleMs: KLS2C_NEVER_IDLE_MS } });
  closers.push(() => world.close());
  const anchor = { kind: 'module', moduleId: 'wg' } as const;
  const written = (await world.post('notes/write', kls2cNoteWrite(S8E_SCOPE, 'kls2c1-k38', { topic: 'k38', anchor })))
    .body as { write: { status: string; noteId?: string } };
  const noteId = written.write.noteId;
  if (written.write.status !== 'accepted' || noteId === undefined) throw new Error(`notes/write: ${JSON.stringify(written)}`);
  const file = join(world.root, '.workbench/notes', S8E_SCOPE.workspaceId, `${noteId}.md`);
  const held = await holdS8EScribeRun(world, 'kls2c1-k38');
  try {
    writeFileSync(file, readFileSync(file, 'utf8').replace('"conclusion": "k38 结论"', '"conclusion": "k38 Run 期间人改的"'));
  } finally {
    await held.release();
  }
  const verifyOf = async (): Promise<{ reason?: string } | null> => {
    const page = (await world.post('notes/list', plain(S8E_SCOPE, { anchor, limit: 100, cursor: null }))).body as {
      value?: { items: { noteId: string; verify: { reason?: string } | null }[] } };
    return page.value?.items.find(item => item.noteId === noteId)?.verify ?? null;
  };
  let verify = await verifyOf();
  for (let round = 0; round < 20 && verify?.reason !== 'external_edit'; round += 1) {
    for (let beat = 0; beat < 3; beat += 1) await heartbeat(world, 25);
    verify = await verifyOf();
  }
  // [2C1-24] Run 结束：Work Run 计数归零时 reconcile(…,'run_end')；[2C1-16] 未提交的外部改动标待核实。
  // 具名改坏：删掉 create-platform countInFlight 里 Work Run 计数归零处的对账 → 20 轮后仍 verify: null，红在这一句。
  expect(verify).toEqual({ state: 'needs_verification', reason: 'external_edit' });
}, 300_000);

it('K39 an adoption reconciles first: plans/apply is unavailable and there is one knowledge_conflict notice', async () => {
  const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
  closers.push(() => world.close());
  const { projectId } = world.scope;
  const commit = async (suffix: string, input: unknown, id: string, expected: unknown[] = []) => committedValue<
    Record<string, unknown>>(await world.call(suffix, graphWrite(world.scope, input, `kls2c1-k39-${id}`, expected)), suffix);
  await kls2cAdopt(world, ['core', 'other']);
  const [project] = await kls2cScopePins(world);
  const policy = await commit('completion-policies/install', { policyId: 'kls2c-policy', contentRevision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } }, 'policy',
  [project, { ref: { aggregateType: 'CompletionPolicyRevision', projectId, policyId: 'kls2c-policy', revision: 1 }, revision: 0 }]);
  await commit('completion-policies/activate', { target: { ref: policy['ref'], digest: policy['contentDigest'] } }, 'activate',
    [project, { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId }, revision: 0 }]);
  const goalRef = { aggregateType: 'Goal', projectId, goalId: 'kls2c1-k39-goal' };
  await commit('goals/create', { goalId: goalRef.goalId, workspace: world.scope, objective: 'K39' }, 'goal',
    await kls2cScopePins(world));
  // One work Task on module `core`: a future adoption checks its module tasks against the current architecture.
  const base = ag2bPlanDraft(['kls2c1-k39-work']);
  const draft = { ...base, planId: 'kls2c1-k39-plan', goalId: goalRef.goalId, stages: [{ stageId: 'k39', title: 'K39' }],
    tasks: base.tasks.map(task => task.taskKind === 'work'
      ? { ...task, scope: { kind: 'module' as const, stageId: 'k39', moduleRef: 'core' } } : task) };
  const reason = { text: 'K39', sources: [] };
  const first = await commit('plans/propose', { goalRef, basedOn: null, draft, reason }, 'propose-1');
  const adopted = await commit('plans/apply', { proposalRef: first['ref'], expectedProposalRevision: first['revision'],
    decisionRefs: [] }, 'apply-1');
  const next = await commit('plans/propose', { goalRef, basedOn: adopted['ref'],
    draft: { ...draft, planId: 'kls2c1-k39-plan-2', planRevision: draft.planRevision + 1 }, reason }, 'propose-2');
  kls2cConflict(world, 'same_id');
  const applied = await world.call('plans/apply', graphWrite(world.scope, { proposalRef: next['ref'],
    expectedProposalRevision: next['revision'], decisionRefs: [] }, 'kls2c1-k39-apply-2'));
  // [2C1-24] 采用前：采用读到的目录本来就是 unavailable（2a-1 的读回闸门）。
  expect(applied).toMatchObject({ status: 'rejected', code: 'unavailable' });
  // [2C1-24] + 定稿第五节：adoptAndExport 调底层之前 reconcile(…,'before_adopt')，出一条 knowledge_conflict。
  // 具名改坏：删掉采用包装里的 before_adopt 对账 → 0 条，红在这一句。
  expect(await world.notices('knowledge_conflict')).toHaveLength(1);
}, 120_000);
