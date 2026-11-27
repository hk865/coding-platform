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
 *
 * NR-B (frozen ruling `nrb-rulings.md` §7, §11; the ruling's `NRB-world.ts` extends this file instead of a new world),
 * at the end of the file:
 * - The clock. The world's clock is the faked process `Date` and does not move by itself
 *   (`S6A-request-fixture.ts:535`, `:589-593`), so a switch into every_step and a node finished after it carry the same
 *   instant. 2-5 compares the two (`reducedAt <= nodeReviewSince`, ruling §5), so a step that comes after the switch
 *   is put `NRB_TICK` later through the world's clock, a Host input (RULES A8).
 * - `openNRBPendingNode`: an every_step Goal, one tick, then the node `<label>-a` changes `src/module.ts` on its own line
 *   (kept: a reworked node is claimed again from the same holder, `workflow.ts:2889-2890`).
 * - `startNRBNode`: the line's scripted calls (and `text`, its last reply) and the node's own `select_work`, stopped
 *   before `open_checks` (the start of `S7D2-RL-17.test.ts:23-26`); `finish` drives it on to `satisfied`.
 * - `acrossTheSwitch`: ruling §11 (NRQ-1..3) with the round-1 ruling 13: both nodes started under
 *   after_plan_confirmation @t0, one tick, the switch @t1, one tick, both finished @t2, so a cut-off compared with the
 *   Runs' start (t0 < t1) would leave both out while the reductions (t2) are after it.
 * - `bornEveryStepGoal`: a Goal born every_step: the second Goal switched, cancelled and copied (`goals/copy-confirm`).
 *   The copy keeps autonomy and order only (`state/goal-copy.ts:57-63`; ruling §5 last bullet), so its record has the
 *   five settings keys and no cut-off, the shape of a Goal written before NR-B. `fileNodeOn` runs one node on it.
 * - Reads: `goals/delivery` (node rows and their `draft`), `main/read` (`nodeReceipts`), `decisions/queue`
 *   (`node_review` cards); the `nodes/rework` body pins `dnrPins`. The NR-B fields are local types: the base tree has
 *   none of them.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalAutonomyV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { TaskNodeReviewRowV1 } from '../../src/core/work-graph/model/task-node-commit-contracts.js';
import { gitIn } from '../scenarios/support/git-workspace.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { AG2B_GATE_TASK_ID, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { adoptPLMixedPlan, createPLLine, openPLConsumptionWorld } from './PL-consumption-fixture.js';
import type { S6AHostWorld, S6AReply } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6ASession } from './S6A-request-fixture.js';
import { assertTaskCompleted, cancelS7AGoal, committed, ready, setS7AAutonomy } from './S7A-fixture.js';

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

// ---------------------------------------------------------------------------
// NR-B (ruling `nrb-rulings.md` §7, §11): see the header
// ---------------------------------------------------------------------------

/** One second of the world's clock between two dated facts (the switch, a reduction). */
export const NRB_TICK = 1_000;

/** Ruling §3.2 `NodeReviewDraftV1`. */
export type NRBDraft = {
  status: 'drafting' | 'ready' | 'failed'; text: string | null; request: QueryJobRef | null;
  requestedAt: string | null; failureReason: string | null;
};
export type NRBRow = TaskNodeReviewRowV1 & { draft?: NRBDraft | null };
/** Ruling §3.1 `NodeReviewReceiptV1`. */
export type NRBReceipt = {
  taskRef: { taskId: string; title: string | null }; decision: 'committed' | 'acknowledged';
  sha: string | null; message: string | null; reviewedAt: string;
  reviewedBy: { kind: 'human' | 'system'; id: string }; files: number;
};
export type NRBPending = DNRWorld & { readonly line: S6ASession; readonly taskId: string };
export type NRBStarted = { readonly taskId: string; finish(): Promise<void> };

const exportOf = (name: string): string => `export const ${name.replace(/-/g, '_')} = 1;\n`;

export async function openNRBPendingNode(label: string, backend: S6ABackend = 'memory'): Promise<NRBPending> {
  const taskId = `${label}-a`;
  const w = await openDNRWorld({ label, autonomy: 'every_step', taskIds: [taskId], backend });
  try {
    w.world.clock.advance(NRB_TICK);
    const before = await readFile(join(w.world.root, 'src', 'module.ts'), 'utf8');
    const line = await dnrLine(w, `${label}-line`, [taskId]);
    await runDNRNode(w, line, taskId,
      [replaceText(`${label}-edit`, 'src/module.ts', before, before, `${before}${exportOf(label)}`)]);
    return { ...w, line, taskId };
  } catch (error) {
    await w.close().catch(() => undefined);
    throw error;
  }
}

export async function startNRBNode(w: DNRWorld, line: S6ASession, taskId: string, calls: readonly DNRCall[],
  input: { flowId?: string; goal?: GoalRef; text?: string } = {}): Promise<NRBStarted> {
  const goal = input.goal ?? w.goal;
  await w.world.scripted.script(line, [...(calls.length === 0 ? [] : [{ kind: 'calls' as const, calls }]),
    { kind: 'text', text: input.text ?? `NRB ${taskId} done` }]);
  const steps = await driveWorkflow(w.world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: input.flowId ?? `nrb-${taskId}`,
    sessionHint: line.ref, kind: 'select_work', taskId }, { stopBefore: 'open_checks' });
  const next = steps[steps.length - 1]?.next ?? null;
  if (next === null) throw new Error(`NRB: ${taskId} did not stop before its checks`);
  return { taskId, finish: async () => {
    await driveWorkflow(w.world.ag2b, next);
    await assertTaskCompleted(w.world, goal, taskId);
  } };
}

/** Both nodes started @t0 on their own lines, tick, the switch into every_step @t1, tick, both finished @t2. */
export async function acrossTheSwitch(w: DNRWorld, nodes: ReadonlyArray<{ taskId: string; path: string }>): Promise<void> {
  const started: NRBStarted[] = [];
  for (const node of nodes) {
    started.push(await startNRBNode(w, await dnrLine(w, `${node.taskId}-line`, [node.taskId]), node.taskId,
      [createFile(`${node.taskId}-edit`, node.path, exportOf(node.taskId))]));
  }
  w.world.clock.advance(NRB_TICK);
  await setS7AAutonomy(w.world, w.goal, 'every_step');
  w.world.clock.advance(NRB_TICK);
  for (const node of started) await node.finish();
}

/** A Goal born every_step: the second Goal (a Plan, every_step, cancelled) copied through `goals/copy-confirm`. */
export async function bornEveryStepGoal(w: DNRWorld, label: string): Promise<GoalRef> {
  const source = w.world.goals.second;
  await adoptPLMixedPlan(w.world, { goal: source, label: `${label}-source`,
    tasks: [{ taskId: `${label}-source`, role: S6A_WORK_ROLE.templateId }] });
  await setS7AAutonomy(w.world, source, 'every_step');
  await cancelS7AGoal(w.world, source);
  const draft = ready<{ source: { goal: GoalRef; revision: number } }>(
    await w.world.post('goals/copy-draft', plain(S6A_SCOPE, { goalRef: source })), 'NRB: the copy draft');
  return committed<{ goal: { ref: GoalRef } }>(await w.world.post('goals/copy-confirm', plain(S6A_SCOPE, {
    commandId: `${label}-copy`, sourceGoalRef: draft.source.goal, expectedSourceRevision: draft.source.revision,
    selectedInterventions: [],
  })), 'NRB: the copy').goal.ref;
}

/** A Plan with the one work node `taskId` on `goal`, its line, and the node run to `satisfied` with one new file. */
export async function fileNodeOn(w: DNRWorld, goal: GoalRef, taskId: string): Promise<void> {
  await adoptPLMixedPlan(w.world, { goal, label: taskId, tasks: [{ taskId, role: S6A_WORK_ROLE.templateId }] });
  const line = await createPLLine(w.world, { label: `${taskId}-line`, role: S6A_WORK_ROLE,
    tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId }] });
  await runDNRNode(w, line, taskId, [createFile(`${taskId}-edit`, `src/${taskId}.ts`, exportOf(taskId))], goal);
}

export async function nrbDelivery(w: DNRWorld, goal: GoalRef = w.goal):
Promise<{ nodes: NRBRow[]; secretary: SessionRef | null }> {
  return ready<{ nodes: NRBRow[]; secretary: SessionRef | null }>(
    await w.world.post('goals/delivery', plain(S6A_SCOPE, { goalRef: goal })), 'NRB: goals/delivery');
}

export async function nrbRow(w: DNRWorld, taskId: string, goal: GoalRef = w.goal): Promise<NRBRow> {
  const row = (await nrbDelivery(w, goal)).nodes.find(entry => entry.task.taskId === taskId);
  if (row === undefined) throw new Error(`NRB: goals/delivery has no row for ${taskId}`);
  return row;
}

/** `main/read` of the Goal's view; `nodeReceipts` as the page answers it (absent on the base tree). */
export async function nrbReceipts(w: DNRWorld, goal: GoalRef = w.goal): Promise<NRBReceipt[] | undefined> {
  return ready<{ nodeReceipts?: NRBReceipt[] }>(await w.world.post('main/read',
    plain(S6A_SCOPE, { goalId: goal.goalId, cursor: null })), 'NRB: main/read').nodeReceipts;
}

/** `decisions/queue` of one Goal, `waiting_answer` only: its `node_review` cards and the section count. */
export async function nodeReviewQueue(w: DNRWorld, goal: GoalRef = w.goal):
Promise<{ cards: DecisionCardV1[]; waitingAnswer: number }> {
  const queue = ready<DecisionQueueReadV1>(await w.world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef: goal, sections: ['waiting_answer'], page: { limit: 100 },
  })), 'NRB: decisions/queue');
  return { cards: queue.waitingAnswer.filter(card => card.source.kind === 'node_review'),
    waitingAnswer: queue.counts.waitingAnswer };
}

export type NRBReworkInput = { taskId: string; requestId: string; reason: string; expected?: unknown[] };

/** The `nodes/rework` body (ruling §2.1); `expected` defaults to `[Goal@now, TaskReduction@the row's revision]`. */
export async function nrbReworkBody(w: DNRWorld, input: NRBReworkInput): Promise<unknown> {
  return graphWrite(S6A_SCOPE, { goalRef: w.goal, taskRef: w.task(input.taskId), reason: input.reason },
    input.requestId, input.expected ?? await dnrPins(w, input.taskId));
}

export async function postRework(w: DNRWorld, body: unknown): Promise<unknown> {
  return (await w.world.post('nodes/rework', body)).body;
}

export async function nrbRework(w: DNRWorld, input: NRBReworkInput): Promise<unknown> {
  return await postRework(w, await nrbReworkBody(w, input));
}
