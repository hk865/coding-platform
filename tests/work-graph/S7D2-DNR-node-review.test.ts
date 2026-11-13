/**
 * nr (node-level review) business rows, memory unless a row says why not (rule sheet S3). Test spec
 * `nr-tests.frozen.md` read with `dnr-errata.frozen.md` (E4 NR-T21, E5 the `edit` input) and `nr-repoint.md`
 * (§2.2 NR-T22, L9–L13); lead rulings 11-13 (next1113c: NR-24 takes both S9 and K3 pending reviews). World:
 * `tests/helpers/S7D2-DNR-node-world.ts`. Where the spec reads `goals/delivery.nodes[taskId]` (acc's page read, not
 * in nr), the rows read the same `TaskNodeReviewRowV1` from nr's published port `platform.nodeCommits.readNodeRows`.
 * NR-T10 is not here: `goals/delivery.secretary` is acc's read (NR-16; reply question 1). NR-T07 is deleted (spec).
 *
 * Red today (7c862a02, nr absent), green when nr lands — each row:
 * - T01/T02/T05/T06/T09/T12/T13/T17/T18/T19: at the first `platform.nodeCommits` read or `nodes/commit` post (no
 *   port: TypeError; no route: 404). T01 is also red at `state: 'waiting'` (the Goal loop claims the next node).
 *   Green: readNodeRows/commitNode exist with NR-01..NR-23, the gate is in `selectNext` (NR-04).
 * - T08: `nodes/commit` answers `not_found` (unpublished route) instead of `forbidden`.
 * - T20/T21: the driver never parks on `live_work` / `node_review_pending:<A>` (no gate), so the bounded wait times
 *   out. Green: NR-04's gate, and NR-17 puts TaskNodeCommit in GOAL_WAIT_WAKE_AGGREGATE_TYPES (B starts on its own).
 * - T22: the Goal-level `select_work` does not wait on `live_work` (no NR-24). Green: NR-24 counts the open S9 review
 *   round and the K3 record awaiting advice as live work.
 * Named mutations are nr's new code (the gate, the filters, the port): none can be shown on today's tree.
 *
 * After the Astra review (11-13): T22's two rows drive the Goal loop itself. A's own round goes out and settles there
 * (N1), B is not claimed meanwhile, and the S9 row sees B start after it; the K3 row starts after a Host restart. Red
 * with the old `live_work` early return: no `send_system_round` on the Goal drive. The two E7 rows (erratum 7) are
 * red with the raw-blob comparison: the CRLF row's "acknowledge" is `source_stale`, the mode row's "commit" too. T09
 * stages a file outside the node first: a node commit without its pathspec would take it.
 * Lead ruling 11-13: a K3 record in `needs_decision` is a review pending on A too; T22's third row is red without it
 * (the Goal drive's next step claims B).
 */
import { existsSync } from 'node:fs';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type {
  WorkflowAdvanceInput, WorkflowAdvanceResult, WorkflowStepReceipt,
} from '../../src/business/workflow/contracts.js';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RuntimeTask } from '../../src/contracts/plan.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { waitFor } from '../scenarios/harness.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { runsOf, startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { heartbeatUntil, heartbeatUntilModel } from '../helpers/IV-host-fixture.js';
import {
  adviserRoundsOf, advanceK3L3, answerK3L3Round, controlK3L3Goal, crashK3L3Command, k3l3CardOf, readK3L3Review,
  selectK3L3, type K3L3World,
} from '../helpers/K3L3-adviser-world.js';
import {
  adoptPLMixedPlan, createPLAdviserLine, createPLLine, openPLConsumptionWorld,
} from '../helpers/PL-consumption-fixture.js';
import { advancePLGoal, plPlanChangeDraft } from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import {
  applyDNRPlan, createFile, dnrCommit, dnrCommitBody, dnrLine, dnrRow, DNR_GATE, gitOut, headCount, openDNRPendingNode,
  openDNRWorld, replaceText, runDNRNode, writeText, type DNRWorld,
} from '../helpers/S7D2-DNR-node-world.js';
import { openS9ReviewRound, openS9ReviewWorld } from '../helpers/S9-review-fixture.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';

// NR-T22's K3 entry: the record comes from a crash while the K3 seam holds the Work Run's `shell` call
// (K3L3-adviser-world.ts); unarmed, the seam builds the real shell tool.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]):
    ToolDefinition => (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const SLOW = 240_000;
/** In order: a row's held gates and its driver first (`unshift`), then its worlds. */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  shellSeam.release();
  for (const close of closers.splice(0)) await close().catch(() => undefined);
});

async function dnrWorld(input: Parameters<typeof openDNRWorld>[0]): Promise<DNRWorld> {
  const w = await openDNRWorld(input);
  closers.push(w.close);
  return w;
}
async function pendingNode(label: string): Promise<DNRWorld> {
  const w = await openDNRPendingNode(label);
  closers.push(w.close);
  return w;
}
async function selectGoal(world: S6AHostWorld, goal: GoalRef, flowId: string): Promise<WorkflowAdvanceResult> {
  return await advancePLGoal(world, goal, flowId) as WorkflowAdvanceResult;
}
const reasonsOf = (result: WorkflowAdvanceResult | null | undefined): readonly string[] =>
  result?.status === 'ready' ? result.value.waitBasis?.reasons ?? [] : [];
const driverReasons = (snapshot: CollaborationSnapshot): readonly string[] => reasonsOf(snapshot.last);
const note = (label: string): string => `export const ${label.replace(/-/g, '_')} = 1;\n`;

describe('nr: which nodes wait for the person (NR-01..NR-04)', () => {
  it('NR-T01 an every_step node that changed a file stops the Goal loop and is pending', async () => {
    const w = await dnrWorld({ label: 'nrt01', autonomy: 'every_step', taskIds: ['nrt01-a', 'nrt01-b'] });
    await runDNRNode(w, await dnrLine(w, 'nrt01-line', ['nrt01-a', 'nrt01-b']), 'nrt01-a',
      [createFile('nrt01-edit', 'src/nrt01.ts', note('nrt01'))]);
    const selected = await selectGoal(w.world, w.goal, 'nrt01-goal');
    expect(selected).toMatchObject({ status: 'ready', value: { state: 'waiting' } });
    expect(reasonsOf(selected)).toContain('node_review_pending:nrt01-a');
    expect(await dnrRow(w, 'nrt01-a')).toMatchObject({ pending: true, review: null });
  }, SLOW);

  it('NR-T05 after_plan_confirmation has no node review', async () => {
    const w = await dnrWorld({ label: 'nrt05', autonomy: 'after_plan_confirmation', taskIds: ['nrt05-a', 'nrt05-b'] });
    await runDNRNode(w, await dnrLine(w, 'nrt05-line', ['nrt05-a', 'nrt05-b']), 'nrt05-a',
      [createFile('nrt05-edit', 'src/nrt05.ts', note('nrt05'))]);
    expect(reasonsOf(await selectGoal(w.world, w.goal, 'nrt05-goal'))).not.toContain('node_review_pending:nrt05-a');
    expect(await dnrRow(w, 'nrt05-a')).toMatchObject({ pending: false, review: null });
  }, SLOW);

  it('NR-T06 a satisfied work node that only read is not pending', async () => {
    const w = await dnrWorld({ label: 'nrt06', autonomy: 'every_step', taskIds: ['nrt06-a', 'nrt06-b'] });
    await runDNRNode(w, await dnrLine(w, 'nrt06-line', ['nrt06-a', 'nrt06-b']), 'nrt06-a',
      [{ callId: 'nrt06-read', name: 'read', args: { path: 'src/module.ts' } }]);
    expect(reasonsOf(await selectGoal(w.world, w.goal, 'nrt06-goal'))).not.toContain('node_review_pending:nrt06-a');
    expect(await dnrRow(w, 'nrt06-a')).toMatchObject({ pending: false, files: [] });
  }, SLOW);
});

describe('nr: nodes/commit (NR-06..NR-13, NR-22, NR-23)', () => {
  it('NR-T02 the review commits exactly the node\'s file once, with the person\'s message', async () => {
    const w = await dnrWorld({ label: 'nrt02', autonomy: 'every_step', taskIds: ['nrt02-a'] });
    const line = await dnrLine(w, 'nrt02-line', ['nrt02-a']);
    const root = w.world.root;
    await writeText(root, 'notes.txt', 'the person\'s own notes\n');
    const before = await readFile(join(root, 'src', 'module.ts'), 'utf8');
    // A second writer in the same tree (N1): while the node's shell runs, `.workbench/knowledge.json` is written
    // (commands mount `.workbench/` read-only, KLS-2), so the shell's before/after snapshot lists it as changed.
    const shell = 'while [ ! -e .workbench/knowledge.json ]; do : > nrt02-started; sleep 0.05; done; rm -f nrt02-started';
    const running = runDNRNode(w, line, 'nrt02-a', [
      replaceText('nrt02-edit', 'src/module.ts', before, before, `${before}${note('nrt02')}`),
      { callId: 'nrt02-shell', name: 'shell', args: { command: shell } }]);
    await waitFor(async () => existsSync(join(root, 'nrt02-started')), started => started, 'NR-T02: the node shell runs');
    await writeText(root, '.workbench/knowledge.json', '{"modules":[]}\n');
    await running;
    const count = headCount(w);
    const message = 'DNR node nrt02-a: add marker';
    const answer = await dnrCommit(w, { taskId: 'nrt02-a', requestId: 'nrt02-commit', message }) as
      { value: { files: Array<{ path: string }> } };
    expect(answer).toMatchObject({ status: 'committed', value: { review: { kind: 'committed', message } } });
    expect(answer.value.files.map(file => file.path)).toEqual(['src/module.ts']);
    expect(gitOut(w, 'show', '--name-only', '--format=', 'HEAD')).toBe('src/module.ts');
    expect(headCount(w)).toBe(count + 1);
    expect(await dnrRow(w, 'nrt02-a')).toMatchObject({ pending: false });
  }, SLOW);

  it('⑦ a message larger than one argument commits verbatim through standard input', async () => {
    const w = await pendingNode('nrt07m');
    const message = `a node message longer than one argument\n`.repeat(4_000) + "- the person's last line";
    const answer = await dnrCommit(w, { taskId: 'nrt07m-a', requestId: 'nrt07m-commit', message }) as
      { value: { review: { kind: string; message: string } } };
    expect(answer).toMatchObject({ status: 'committed', value: { review: { kind: 'committed', message } } });
    expect(gitOut(w, 'log', '-1', '--format=%B').split('\n\nNode-Record: ')[0]).toBe(message);
  }, SLOW);

  // Refusal reason: product rule (121-45: the platform commits FOR THE PERSON; the decision is the operator's).
  it.each([
    ['a person who is not the operator', { kind: 'human' as const, id: 'nrt08-not-operator' }],
    ['the Workflow automation', WORKFLOW_AUTOMATION_ACTOR],
  ])('NR-T08 rejects: %s cannot commit a node', async (_, actor) => {
    const w = await pendingNode('nrt08');
    const count = headCount(w);
    const ctx = createHostCoreCallContext({ scope: S6A_SCOPE, actor, signal: new AbortController().signal });
    expect(await w.world.dispatch('nodes/commit', ctx, await dnrCommitBody(w, { taskId: 'nrt08-a', requestId: 'nrt08' })))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(headCount(w)).toBe(count);
    expect(await dnrRow(w, 'nrt08-a')).toMatchObject({ pending: true, review: null });
  }, SLOW);

  it('NR-T09 the node\'s paths are committed literally; files outside the node stay uncommitted, staged ones staged', async () => {
    const w = await dnrWorld({ label: 'nrt09', autonomy: 'every_step', taskIds: ['nrt09-a'],
      baseline: { 'src/module1.ts': 'export const one = 1;\n' } });
    await writeText(w.world.root, 'src/module1.ts', 'export const one = 2;\n');
    await writeText(w.world.root, '.workbench/knowledge.json', '{"modules":[]}\n');
    await writeText(w.world.root, 'notes.txt', 'the person\'s own notes\n');
    await runDNRNode(w, await dnrLine(w, 'nrt09-line', ['nrt09-a']), 'nrt09-a',
      [createFile('nrt09-edit', 'src/module[1].ts', note('nrt09'))]);
    gitOut(w, 'add', '--', 'notes.txt');
    const answer = await dnrCommit(w, { taskId: 'nrt09-a', requestId: 'nrt09-commit' }) as
      { value: { files: Array<{ path: string }> } };
    expect(gitOut(w, 'show', '--name-only', '--format=', 'HEAD')).toBe('src/module[1].ts');
    expect(answer.value.files.map(file => file.path)).toEqual(['src/module[1].ts']);
    expect(gitOut(w, 'diff', '--cached', '--name-only')).toBe('notes.txt');
    expect(gitOut(w, 'status', '--porcelain').split('\n').map(line => line.trim()))
      .toEqual(expect.arrayContaining(['M src/module1.ts', '?? .workbench/', 'A  notes.txt']));
  }, SLOW);

  // Refusal reason: product rule (NR-01/02/09: only an every_step work node with changed files is reviewed).
  it.each([
    ['an after_plan_confirmation work node', 'after_plan_confirmation' as const, 'file'],
    ['an every_step gate node', 'every_step' as const, 'gate'],
    ['an every_step work node that changed nothing', 'every_step' as const, 'read'],
  ])('NR-T12 rejects: %s is not in the review set', async (_, autonomy, kind) => {
    const label = `nrt12-${kind}`;
    const w = await dnrWorld({ label, autonomy, taskIds: [`${label}-a`] });
    const line = await dnrLine(w, `${label}-line`, [`${label}-a`]);
    await runDNRNode(w, line, `${label}-a`, kind === 'file' ? [createFile(`${label}-edit`, `src/${label}.ts`, note(label))] : []);
    if (kind === 'gate') await driveWorkflow(w.world.ag2b, { schemaVersion: 1, goalRef: w.goal, flowId: `${label}-gate`,
      sessionHint: null, kind: 'select_work' });
    const taskId = kind === 'gate' ? DNR_GATE : `${label}-a`;
    const count = headCount(w);
    expect(await dnrCommit(w, { taskId, requestId: `${label}-commit` }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(headCount(w)).toBe(count);
    expect(await dnrRow(w, taskId)).toMatchObject({ pending: false, review: null });
  }, SLOW);

  // Refusal reason: product rule (NR-12: the commit carries the secretary's text as the person edited it).
  it('NR-T13 rejects: an empty commit message', async () => {
    const w = await pendingNode('nrt13');
    const count = headCount(w);
    expect(await dnrCommit(w, { taskId: 'nrt13-a', requestId: 'nrt13-commit', message: '' }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(headCount(w)).toBe(count);
    expect(await dnrRow(w, 'nrt13-a')).toMatchObject({ pending: true, review: null });
  }, SLOW);

  it('NR-T17 adopting a Plan that only changes a future node leaves the pending node pending', async () => {
    const w = await dnrWorld({ label: 'nrt17', autonomy: 'every_step', taskIds: ['nrt17-a', 'nrt17-b'] });
    await runDNRNode(w, await dnrLine(w, 'nrt17-line', ['nrt17-a', 'nrt17-b']), 'nrt17-a',
      [createFile('nrt17-edit', 'src/nrt17.ts', note('nrt17'))]);
    const revision = (await dnrRow(w, 'nrt17-a')).reduction?.revision;
    const plan = (await s6aCardsWorkspace(w.world, S6A_SCOPE).activePlan(w.goal))!;
    await applyDNRPlan(w.world, w.goal, plan.ref, plPlanChangeDraft(plan, w.goal, { planId: `${plan.planId}-2`,
      tasks: plan.tasks.map(task => task.taskId === 'nrt17-b' ? { ...task, title: 'NR-T17 B, changed while A waits' } : task),
      assignments: plan.assignments ?? [], obligations: plan.obligations }), 'nrt17-plan-2');
    expect(await dnrRow(w, 'nrt17-a')).toMatchObject({ pending: true, review: null, reduction: { revision } });
    expect(await dnrCommit(w, { taskId: 'nrt17-a', requestId: 'nrt17-commit' })).toMatchObject({ status: 'committed' });
    expect(await dnrRow(w, 'nrt17-a')).toMatchObject({ pending: false });
  }, SLOW);

  it('NR-T18 with no difference left, "commit" is stale and "acknowledge" clears the node without a SHA', async () => {
    const w = await pendingNode('nrt18');
    gitOut(w, 'checkout', '--', 'src/module.ts');
    const count = headCount(w);
    expect(await dnrCommit(w, { taskId: 'nrt18-a', requestId: 'nrt18-commit' }))
      .toMatchObject({ status: 'rejected', code: 'source_stale' });
    const answer = await dnrCommit(w, { taskId: 'nrt18-a', requestId: 'nrt18-ack', decision: 'acknowledge', message: null }) as
      { value: { review: Record<string, unknown> } };
    expect(answer).toMatchObject({ status: 'committed', value: { review: { kind: 'acknowledged' } } });
    expect(answer.value.review).not.toHaveProperty('sha');
    expect(headCount(w)).toBe(count);
    expect(await dnrRow(w, 'nrt18-a')).toMatchObject({ pending: false, review: { review: { kind: 'acknowledged' } } });
  }, SLOW);

  // Erratum 7: a difference is what git would record, through the repository's eol conversion and with the mode.
  it('NR-T18 E7 a CRLF checkout of the LF content in HEAD is no difference: "acknowledge" clears the node', async () => {
    const w = await dnrWorld({ label: 'nrt18e', autonomy: 'every_step', taskIds: ['nrt18e-a'],
      baseline: { 'src/eol.txt': 'one\ntwo\n' } });
    await runDNRNode(w, await dnrLine(w, 'nrt18e-line', ['nrt18e-a']), 'nrt18e-a',
      [replaceText('nrt18e-edit', 'src/eol.txt', 'one\ntwo\n', 'two', 'three')]);
    gitOut(w, 'config', 'core.autocrlf', 'true');
    await writeText(w.world.root, 'src/eol.txt', 'one\r\ntwo\r\n');
    const count = headCount(w);
    expect(await dnrCommit(w, { taskId: 'nrt18e-a', requestId: 'nrt18e-commit' }))
      .toMatchObject({ status: 'rejected', code: 'source_stale' });
    expect(await dnrCommit(w, { taskId: 'nrt18e-a', requestId: 'nrt18e-ack', decision: 'acknowledge', message: null }))
      .toMatchObject({ status: 'committed', value: { review: { kind: 'acknowledged' } } });
    expect(headCount(w)).toBe(count);
    expect(await dnrRow(w, 'nrt18e-a')).toMatchObject({ pending: false });
  }, SLOW);

  it('NR-T02 E7 a mode-only change is a difference: "commit" records the executable bit', async () => {
    const w = await dnrWorld({ label: 'nrt02m', autonomy: 'every_step', taskIds: ['nrt02m-a'],
      baseline: { 'src/run.sh': 'echo one\n' } });
    await runDNRNode(w, await dnrLine(w, 'nrt02m-line', ['nrt02m-a']), 'nrt02m-a',
      [replaceText('nrt02m-edit', 'src/run.sh', 'echo one\n', 'one', 'two')]);
    await writeText(w.world.root, 'src/run.sh', 'echo one\n');
    await chmod(join(w.world.root, 'src', 'run.sh'), 0o755);
    const count = headCount(w);
    expect(await dnrCommit(w, { taskId: 'nrt02m-a', requestId: 'nrt02m-commit' }))
      .toMatchObject({ status: 'committed', value: { review: { kind: 'committed' } } });
    expect(headCount(w)).toBe(count + 1);
    expect(gitOut(w, 'show', '--name-only', '--format=', 'HEAD')).toBe('src/run.sh');
    expect(gitOut(w, 'ls-tree', 'HEAD', '--', 'src/run.sh')).toMatch(/^100755 blob /);
  }, SLOW);

  it('NR-T19 the review read marks the path another Goal of the workspace also changes', async () => {
    const w = await dnrWorld({ label: 'nrt19', autonomy: 'every_step', taskIds: ['nrt19-a'] });
    const other = w.world.goals.second;
    const { tasks } = await adoptPLMixedPlan(w.world, { goal: other, label: 'nrt19-other',
      tasks: [{ taskId: 'nrt19-other', role: S6A_WORK_ROLE.templateId }] });
    const shared = 'export const shared = "other goal";\n';
    await runDNRNode(w, await createPLLine(w.world, { label: 'nrt19-other-line', role: S6A_WORK_ROLE, tasks }),
      'nrt19-other', [createFile('nrt19-other-edit', 'src/shared.ts', shared)], other);
    await runDNRNode(w, await dnrLine(w, 'nrt19-line', ['nrt19-a']), 'nrt19-a', [
      replaceText('nrt19-shared', 'src/shared.ts', shared, 'other goal', 'both goals'),
      createFile('nrt19-own', 'src/nrt19-own.ts', note('nrt19'))]);
    const files = (await dnrRow(w, 'nrt19-a')).files;
    expect(files.find(file => file.path === 'src/shared.ts')?.sharedWithGoalRefs).toEqual([other]);
    expect(files.find(file => file.path === 'src/nrt19-own.ts')?.sharedWithGoalRefs).toEqual([]);
  }, SLOW);
});

describe('nr: every_step runs one node at a time and resumes on the commit (NR-04, NR-17, NR-18, NR-24)', () => {
  async function twoLines(label: string) {
    const w = await dnrWorld({ label, autonomy: 'every_step', taskIds: [`${label}-a`, `${label}-b`] });
    return { w, a: await dnrLine(w, `${label}-line-a`, [`${label}-a`]), b: await dnrLine(w, `${label}-line-b`, [`${label}-b`]) };
  }

  it('NR-T20 the Goal driver does not claim B while A runs or waits for review', async () => {
    const { w, a, b } = await twoLines('nrt20');
    await w.world.scripted.script(a, [{ kind: 'calls', calls: [createFile('nrt20-edit', 'src/nrt20.ts', note('nrt20'))] },
      { kind: 'text', text: 'NR-T20 A done' }]);
    await w.world.scripted.script(b, [{ kind: 'text', text: 'NR-T20 B done' }]);
    const holdA = await w.world.gates.modelRequest(a);
    const holdB = await w.world.gates.modelRequest(b);
    closers.unshift(async () => { holdA.release(); holdB.release();
      await w.world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: w.goal })); });
    await startGoalDriver(w.world, w.goal, 'nrt20');
    await holdA.reached;
    await waitDriver(w.world, w.goal, undefined, s => driverReasons(s).includes('live_work'), 'NR-T20: waits on A\'s Run');
    expect(await runsOf(w.world, w.goal, 'nrt20-b')).toHaveLength(0);
    holdA.release();
    await waitDriver(w.world, w.goal, undefined, s => driverReasons(s).includes('node_review_pending:nrt20-a'),
      'NR-T20: waits on A\'s review');
    expect(await runsOf(w.world, w.goal, 'nrt20-b')).toHaveLength(0);
    expect(await dnrCommit(w, { taskId: 'nrt20-a', requestId: 'nrt20-commit' })).toMatchObject({ status: 'committed' });
    // B's model request is held, so its one Run settles at `running`; the first read can still see it `starting`.
    const runs = await waitFor(() => runsOf(w.world, w.goal, 'nrt20-b'),
      items => items.some(item => item.run.status === 'running'), 'NR-T20: B runs');
    expect(runs.map(item => item.run.status)).toEqual(['running']);
  }, SLOW);

  it('NR-T21 after the commit the next node starts with no manual advance (the Goal wait wakes)', async () => {
    const { w, a, b } = await twoLines('nrt21');
    await runDNRNode(w, a, 'nrt21-a', [createFile('nrt21-edit', 'src/nrt21.ts', note('nrt21'))]);
    await w.world.scripted.script(b, [{ kind: 'text', text: 'NR-T21 B done' }]);
    const holdB = await w.world.gates.modelRequest(b);
    closers.unshift(async () => { holdB.release();
      await w.world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: w.goal })); });
    await startGoalDriver(w.world, w.goal, 'nrt21');
    await waitDriver(w.world, w.goal, undefined, s => driverReasons(s).includes('node_review_pending:nrt21-a'),
      'NR-T21: the driver parks on A\'s review');
    expect(await dnrCommit(w, { taskId: 'nrt21-a', requestId: 'nrt21-commit' })).toMatchObject({ status: 'committed' });
    const runs = await waitFor(() => runsOf(w.world, w.goal, 'nrt21-b'), items => items.length > 0, 'NR-T21: B starts');
    expect(['starting', 'running']).toContain(runs[0]!.run.status);
  }, SLOW);

  const goalSelect = (goal: GoalRef, flowId: string): WorkflowAdvanceInput =>
    ({ schemaVersion: 1, goalRef: goal, flowId, sessionHint: null, kind: 'select_work' });
  const kindsOf = (receipts: readonly WorkflowStepReceipt[]): string[] => receipts.map(receipt => receipt.kind);

  // NR-24 with N1: while A is under review the Goal loop claims nothing new, but A's own round still goes out and
  // settles there (after a restart no watch drives it).
  it('NR-T22 every_step: A\'s S9 review goes out and settles on the Goal loop; B starts only after it', async () => {
    const review = await openS9ReviewWorld();
    closers.push(review.close);
    const { world, goal } = review;
    const plan = (await review.main.activePlan(review.goal))!;
    const next: RuntimeTask = { taskId: 'nrt22-s9-next', title: 'NR-T22 next work', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' };
    await applyDNRPlan(review.world, review.goal, plan.ref, plPlanChangeDraft(plan, review.goal, { planId: `${plan.planId}-2`,
      tasks: [...plan.tasks, next], assignments: [...(plan.assignments ?? []),
        { taskId: next.taskId, role: S6A_WORK_ROLE.templateId, instruction: 'NR-T22 next work' }],
      obligations: plan.obligations.map(entry => entry.obligationId === 's9-obligation'
        ? { ...entry, taskIds: [...entry.taskIds, next.taskId] } : entry) }), 'nrt22-s9-plan');
    const nextLine = await createPLLine(review.world, { label: 'nrt22-s9-next-line', role: S6A_WORK_ROLE,
      tasks: [{ ...review.task, taskId: next.taskId }] });
    await setS7AAutonomy(world, goal, 'every_step');
    // A's Run ended and its command check ran; its review round is open, the review not sent yet.
    await openS9ReviewRound({ review });
    await world.scripted.script(review.reviewLine!, [{ kind: 'calls', calls: [{ callId: 'nrt22-s9-pass',
      name: 'submit_exec_review', args: { verdict: 'pass', basis: 'NR-T22 basis', report: 'NR-T22 report' } }] }]);
    const answer = await world.gates.modelRequest(review.reviewLine!);
    closers.unshift(async () => { answer.release(); });
    const sent: WorkflowStepReceipt[] = [];
    const first = await driveWorkflow(world.ag2b, goalSelect(goal, 'nrt22-s9-goal'), { receipts: sent,
      stopBefore: 'claim_task' });
    expect(kindsOf(sent)).toContain('send_system_round');
    expect(first.at(-1)).toMatchObject({ state: 'waiting' });
    expect(first.at(-1)?.waitBasis?.reasons).toContain('live_work');
    // The reviewer's answer is held at its model request: A is still under review.
    const { settled } = await heartbeatUntilModel(world, answer);
    expect((await driveWorkflow(world.ag2b, goalSelect(goal, 'nrt22-s9-held'), { stopBefore: 'claim_task' })).at(-1))
      .toMatchObject({ state: 'waiting' });
    expect(await runsOf(world, goal, next.taskId)).toHaveLength(0);
    answer.release();
    await settled;
    const sentRound = sent.find(receipt => receipt.kind === 'send_system_round')?.result as
      { value?: { ref?: SessionMessage['ref'] } } | undefined;
    const source = await heartbeatUntil(world, () => readS7BMessage(world, sentRound!.value!.ref!),
      message => message.response !== null || message.withdrawnAt !== null, 16);
    expect(source.response).not.toBeNull();
    await world.scripted.script(nextLine, [{ kind: 'text', text: 'NR-T22 next done' }]);
    const after: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, goalSelect(goal, 'nrt22-s9-after'), { receipts: after,
      stopBefore: 'send_system_round' });
    expect(kindsOf(after)).toEqual(expect.arrayContaining(['record_review', 'finalize_checks', 'claim_task', 'start']));
    expect(await runsOf(world, goal, next.taskId)).toHaveLength(1);
  }, SLOW);

  /** SQLite (the K3 record comes from a crash): A `<label>-work` and B `<label>-next`, their lines and the adviser. */
  async function k3Lines(label: string) {
    const world = await openPLConsumptionWorld({ backend: 'sqlite', label, write: 'every_start', gitRoot: true });
    closers.push(() => world.close());
    await world.setResumeOnStartup(false);
    const goal = world.goals.first;
    const { tasks } = await adoptPLMixedPlan(world, { goal, label,
      tasks: [`${label}-work`, `${label}-next`].map(taskId => ({ taskId, role: S6A_WORK_ROLE.templateId })) });
    const workLine = await createPLLine(world, { label: `${label}-work-line`, role: S6A_WORK_ROLE, tasks: [tasks[0]!] });
    const nextLine = await createPLLine(world, { label: `${label}-next-line`, role: S6A_WORK_ROLE, tasks: [tasks[1]!] });
    const k3: K3L3World = { world, goal, task: tasks[0]!, workLine,
      adviser: await createPLAdviserLine(world, `${label}-adviser`) };
    return { world, goal, k3, nextLine };
  }

  it('NR-T22 every_step, the Host restarts while A waits for its K3 adviser round: it goes out and settles on the Goal loop; B waits', async () => {
    const { world, goal, k3 } = await k3Lines('nrt22k');
    // A crash while A's `shell` call is held writes the record; the Task's own drive settles it to the adviser
    // (K3L-3 R1 ①) before the Goal turns every_step (under every_step the settle puts it before the person).
    const runRef = await crashK3L3Command(k3, 'nrt22k');
    await advanceK3L3(k3, selectK3L3(k3, 'nrt22k-a'), op => op.kind === 'send_system_round');
    expect(await readK3L3Review(k3, runRef)).toMatchObject({ status: 'awaiting_advice' });
    await setS7AAutonomy(world, goal, 'every_step');
    // The Host restarts while A waits. With `resumeOnStartup` off the restart records a Goal interruption and every
    // message of the Goal stays queued until the person continues it (decision 97-9): pause, the driver's start (the
    // one step that resolves it; a paused Goal selects nothing), its stop, resume. No watch drives A afterwards.
    await world.reopen();
    await controlK3L3Goal(k3, 'pause', 'nrt22k-reopen-pause');
    ready(await world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: goalSelect(goal, 'nrt22k-reopen-driver'),
      queryProfileIds: [] })), 'NR-T22: the driver start');
    ready(await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal })), 'NR-T22: the driver stop');
    await controlK3L3Goal(k3, 'resume', 'nrt22k-reopen-resume');
    const sent = await advanceK3L3(k3, goalSelect(goal, 'nrt22k-goal'), op => op.kind === 'claim_task');
    expect(kindsOf(sent.receipts), `the Goal drive: ${String(sent.last.reason)}`).toContain('send_system_round');
    expect(sent.last).toMatchObject({ state: 'waiting' });
    expect(sent.last.waitBasis?.reasons).toContain('live_work');
    expect(await readK3L3Review(k3, runRef)).toMatchObject({ status: 'awaiting_advice' });
    const rounds = await adviserRoundsOf(k3);
    expect(rounds).toHaveLength(1);
    expect(await runsOf(world, goal, 'nrt22k-next')).toHaveLength(0);
    await answerK3L3Round(k3, rounds[0]!.message, [{ kind: 'calls', calls: [{ callId: 'nrt22k-rerun',
      name: 'submit_unknown_call_advice', args: { choice: 'rerun_as_is', rationale: '只读命令',
        plain: '只读命令，重跑没有副作用' } }] }]);
    const applied = await advanceK3L3(k3, goalSelect(goal, 'nrt22k-apply'), op => op.kind === 'claim_task');
    expect(applied.receipts).toContainEqual(expect.objectContaining({ kind: 'apply_adviser_answer',
      result: expect.objectContaining({ status: 'committed' }) }));
    // A's adviser round is over; under every_step the owner puts the answer before the person (every-step
    // confirmation), which is still a review pending on A.
    expect(await readK3L3Review(k3, runRef)).toMatchObject({ status: 'needs_decision',
      decisionReasons: expect.arrayContaining(['confirm_each_step']) });
    expect(applied.last).toMatchObject({ state: 'waiting' });
    expect(await runsOf(world, goal, 'nrt22k-next')).toHaveLength(0);
  }, SLOW);

  // Lead ruling 11-13: a K3 record waiting for the person's decision is a review pending on A.
  it('NR-T22 every_step: A\'s K3 record waits for the person (needs_decision); B starts only after the person decides', async () => {
    const { world, goal, k3, nextLine } = await k3Lines('nrt22n');
    const runRef = await crashK3L3Command(k3, 'nrt22n');
    await setS7AAutonomy(world, goal, 'every_step');
    // Under every_step the record's settle puts it before the person (`confirm_each_step`).
    const settled = await advanceK3L3(k3, goalSelect(goal, 'nrt22n-goal'), op => op.kind === 'claim_task');
    expect(kindsOf(settled.receipts)).toContain('settle_review');
    const record = await readK3L3Review(k3, runRef);
    expect(record).toMatchObject({ status: 'needs_decision',
      decisionReasons: expect.arrayContaining(['confirm_each_step']) });
    expect(settled.last).toMatchObject({ state: 'waiting' });
    expect(settled.last.waitBasis?.reasons).toContain('live_work');
    expect(await runsOf(world, goal, 'nrt22n-next')).toHaveLength(0);
    const card = await k3l3CardOf(k3, record);
    if (card === undefined) throw new Error('NR-T22: the record has no waiting card');
    ready(await world.post('decisions/answer', graphWrite(S6A_SCOPE, { source: card.source,
      selection: { kind: 'option', optionId: 'handle_myself' }, text: '', annotations: [] }, 'nrt22n-answer',
    card.source.pins)), 'NR-T22: the person\'s decision');
    await world.scripted.script(nextLine, [{ kind: 'text', text: 'NR-T22 next done' }]);
    const after = await advanceK3L3(k3, goalSelect(goal, 'nrt22n-after'));
    expect(await readK3L3Review(k3, runRef)).toMatchObject({ status: 'resolved',
      disposition: { choice: 'handle_myself' } });
    expect(kindsOf(after.receipts)).toEqual(expect.arrayContaining(['claim_task', 'start']));
    expect(await runsOf(world, goal, 'nrt22n-next')).toHaveLength(1);
  }, SLOW);
});
