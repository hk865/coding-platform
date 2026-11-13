/**
 * nr (node-level review) worlds, test spec `nr-tests.frozen.md` §世界 with `dnr-errata.frozen.md` E5 and
 * `nr-repoint.md` L9/L10. Every prior state is a public step; nothing here writes a record or reads the database.
 *
 * - `openDNRWorld`: the real Host world `openPLConsumptionWorld` (the Work binding's real `write`/`shell` grant on
 *   every start, which `mergeTools` cannot give: `shell` also needs `shellWorkspaceAccess`; the Host's check
 *   configuration; governance seeded). SQLite makes the root a git work tree before the first start (the store is
 *   placed by it, KLS-1a); memory gets the same baseline right after the start. One Plan on the first Goal through
 *   `adoptPLMixedPlan` (the named independent work Tasks plus the Goal gate `ag2b-gate`), the autonomy through
 *   `goals/settings/set`. The platform's own `git` child inherits `process.env`, so the world puts `gitIn`'s identity
 *   there while it is open (spec §世界: otherwise the node commit is `unavailable` for a missing author).
 * - `runDNRNode`: the line's scripted calls (the Kernel's real `edit`, E5 `{mode:'create', path, newText}` or
 *   `replace` with the text's sha256), then the node's own `select_work` drive: claim, Run, checks, `satisfied`.
 * - Node rows come from the published port `platform.nodeCommits.readNodeRows` (nr adds no read route; the
 *   `goals/delivery` page read the spec names is acc's, NR-16); a review goes through the `nodes/commit` route.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalAutonomyV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskNodeReviewRowV1 } from '../../src/core/work-graph/model/task-node-commit-contracts.js';
import { gitIn } from '../scenarios/support/git-workspace.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { AG2B_GATE_TASK_ID, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { adoptPLMixedPlan, createPLLine, openPLConsumptionWorld } from './PL-consumption-fixture.js';
import type { S6AHostWorld, S6AReply } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6ASession } from './S6A-request-fixture.js';
import { assertTaskCompleted, committed, ready, setS7AAutonomy } from './S7A-fixture.js';

export type DNRWorld = {
  readonly world: S6AHostWorld;
  readonly goal: GoalRef;
  task(taskId: string): TaskTriple;
  close(): Promise<void>;
};

export type DNRCall = { callId: string; name: string; args: Record<string, unknown> };
export type DNRRows = { rows: TaskNodeReviewRowV1[]; pending: TaskNodeReviewRowV1[]; liveWork: boolean };

const IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: 'K3 Scenario', GIT_AUTHOR_EMAIL: 'k3-scenario@example.invalid',
  GIT_COMMITTER_NAME: 'K3 Scenario', GIT_COMMITTER_EMAIL: 'k3-scenario@example.invalid',
};

export const DNR_GATE = AG2B_GATE_TASK_ID;
export const sha256 = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
export const createFile = (callId: string, path: string, text: string): DNRCall =>
  ({ callId, name: 'edit', args: { mode: 'create', path, newText: text } });
export const replaceText = (callId: string, path: string, before: string, oldText: string, newText: string): DNRCall =>
  ({ callId, name: 'edit', args: { mode: 'replace', path, oldText, newText, expectedRevision: sha256(before) } });

/** A real file in the world's root (the person's or a second writer's edit, rule sheet A1). */
export async function writeText(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}

export const gitOut = (w: DNRWorld, ...args: string[]): string => gitIn(w.world.root, ...args).trim();
export const headCount = (w: DNRWorld): number => Number(gitOut(w, 'rev-list', '--count', 'HEAD'));

export async function openDNRWorld(input: { label: string; autonomy: GoalAutonomyV1; taskIds: readonly string[];
  backend?: S6ABackend; baseline?: Readonly<Record<string, string>> }): Promise<DNRWorld> {
  const backend = input.backend ?? 'memory';
  const saved = Object.keys(IDENTITY).map(key => [key, process.env[key]] as const);
  Object.assign(process.env, IDENTITY);
  const restore = (): void => {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  };
  let world: S6AHostWorld;
  try {
    world = await openPLConsumptionWorld({ backend, label: input.label, write: 'every_start',
      gitRoot: backend === 'sqlite', checks: true });
  } catch (error) { restore(); throw error; }
  const close = async (): Promise<void> => { try { await world.close(); } finally { restore(); } };
  try {
    await world.setResumeOnStartup(false);
    if (backend === 'memory') gitIn(world.root, 'init', '-q', '-b', 'main');
    for (const [path, text] of Object.entries(input.baseline ?? {})) await writeText(world.root, path, text);
    gitIn(world.root, 'add', '-A', '--', '.', ':(exclude).workbench');
    gitIn(world.root, 'commit', '-q', '--allow-empty', '-m', `${input.label} baseline`);
    const goal = world.goals.first;
    await adoptPLMixedPlan(world, { goal, label: input.label,
      tasks: input.taskIds.map(taskId => ({ taskId, role: S6A_WORK_ROLE.templateId })) });
    if (input.autonomy !== 'after_plan_confirmation') await setS7AAutonomy(world, goal, input.autonomy);
    return { world, goal, task: taskId => ({ projectId: goal.projectId, goalId: goal.goalId, taskId }), close };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

export async function dnrLine(w: DNRWorld, label: string, taskIds: readonly string[]): Promise<S6ASession> {
  return await createPLLine(w.world, { label, role: S6A_WORK_ROLE, tasks: taskIds.map(w.task) });
}

/** The line answers with `calls` (none: text only), then the node's own `select_work` drive makes it `satisfied`. */
export async function runDNRNode(w: DNRWorld, line: S6ASession, taskId: string, calls: readonly DNRCall[],
  goal: GoalRef = w.goal): Promise<void> {
  const replies: S6AReply[] = [...(calls.length === 0 ? [] : [{ kind: 'calls' as const, calls }]),
    { kind: 'text', text: `DNR ${taskId} done` }];
  await w.world.scripted.script(line, replies);
  await driveWorkflow(w.world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: `dnr-${taskId}`,
    sessionHint: line.ref, kind: 'select_work', taskId });
  await assertTaskCompleted(w.world, goal, taskId);
}

/** An every_step world whose one node `<label>-a` changed `src/module.ts` and is satisfied (NR-T02's node). */
export async function openDNRPendingNode(label: string, backend: S6ABackend = 'memory'): Promise<DNRWorld> {
  const w = await openDNRWorld({ label, autonomy: 'every_step', taskIds: [`${label}-a`], backend });
  try {
    const before = await readFile(join(w.world.root, 'src', 'module.ts'), 'utf8');
    await runDNRNode(w, await dnrLine(w, `${label}-line`, [`${label}-a`]), `${label}-a`,
      [replaceText(`${label}-edit`, 'src/module.ts', before, before, `${before}export const ${label} = 1;\n`)]);
    return w;
  } catch (error) {
    await w.close().catch(() => undefined);
    throw error;
  }
}

export async function dnrRows(w: DNRWorld): Promise<DNRRows> {
  return ready<DNRRows>(await w.world.platform.nodeCommits.readNodeRows(w.world.humanContext(), { goalRef: w.goal }),
    'nr: readNodeRows');
}

export async function dnrRow(w: DNRWorld, taskId: string): Promise<TaskNodeReviewRowV1> {
  const row = (await dnrRows(w)).rows.find(entry => entry.task.taskId === taskId);
  if (row === undefined) throw new Error(`nr: no node row for ${taskId}`);
  return row;
}

export async function goalRevision(world: S6AHostWorld, goal: GoalRef): Promise<number> {
  return ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, goal)), 'the Goal')
    .goal.revision;
}

/** `[Goal@now, TaskReduction@the row's revision]`, both read now (NR-06). */
export async function dnrPins(w: DNRWorld, taskId: string): Promise<unknown[]> {
  const reduction = (await dnrRow(w, taskId)).reduction;
  return [{ ref: w.goal, revision: await goalRevision(w.world, w.goal) },
    { ref: { aggregateType: 'TaskReduction', ...w.task(taskId) }, revision: reduction?.revision ?? 0 }];
}

export type DNRCommitInput = {
  taskId: string; requestId: string; decision?: 'commit' | 'acknowledge'; message?: string | null;
  reviewed?: ReadonlyArray<{ path: string; blob: string | null }>; expected?: unknown[];
};

/** The `nodes/commit` body; `reviewed` and `expected` default to what the node row and the Goal read answer now. */
export async function dnrCommitBody(w: DNRWorld, input: DNRCommitInput): Promise<unknown> {
  const decision = input.decision ?? 'commit';
  const reviewed = input.reviewed
    ?? (await dnrRow(w, input.taskId)).files.map(file => ({ path: file.path, blob: file.blob }));
  return graphWrite(S6A_SCOPE, { goalRef: w.goal, taskRef: w.task(input.taskId), decision,
    message: input.message !== undefined ? input.message : decision === 'commit' ? `DNR node ${input.taskId}` : null,
    reviewed }, input.requestId, input.expected ?? await dnrPins(w, input.taskId));
}

export async function postNodeCommit(w: DNRWorld, body: unknown): Promise<unknown> {
  return (await w.world.post('nodes/commit', body)).body;
}

export async function dnrCommit(w: DNRWorld, input: DNRCommitInput): Promise<unknown> {
  return await postNodeCommit(w, await dnrCommitBody(w, input));
}

/** `plans/propose` (based on `basedOn`) + `plans/apply` of `draft`. */
export async function applyDNRPlan(world: S6AHostWorld, goal: GoalRef, basedOn: unknown, draft: unknown,
  label: string): Promise<void> {
  const proposed = committed<{ ref: unknown; revision: number }>(await world.post('plans/propose', graphWrite(S6A_SCOPE,
    { goalRef: goal, basedOn, draft, reason: { text: `DNR ${label}`, sources: [] } }, `${label}-propose`)), label);
  committed(await world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision, decisionRefs: [] }, `${label}-apply`)), `${label} apply`);
}
