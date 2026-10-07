/**
 * A.2 step 5.6 restart scenarios through real Hosts on one SQLite ledger and
 * Kernel store (docs/refactor/STATE-MACHINES-SPEC.md §12). Shared by the
 * restart scenarios (`tests/scenarios/A8-host-restart*.test.ts`) and the scenario help code.
 *
 * Two ways a Host "stops" here:
 * - closed: `host.close()` drains every request and removes its own lock
 *   (HL-06); a stale lock naming an exited process is then written, as a
 *   crashed Host would leave it (HL-03 on the next start);
 * - abandoned (the crash): the Host is left running with an execution blocked
 *   inside a scripted model request (the Kernel Turn is open); its lock is
 *   rewritten to name an exited process and the next Host takes it over. The
 *   abandoned Host is released and closed only after the assertions.
 *
 * Scripted model replies only; no real model is called.
 */
import { expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PLATFORM_TOKEN_META_NAME, PLATFORM_TOKEN_PLACEHOLDER, type QueryJobRef, type QueryRunRef, type TaskExecutionRecord,
} from '../../src/app/core-http-types.js';
import { HOST_INSTANCE_LOCK_FILE } from '../../src/app/host-instance-lease.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { ControlIntentSnapshotV1, SubmittedControl } from '../../src/contracts/control-intent.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { TaskAutomationPolicyV1 } from '../../src/contracts/task-requeue.js';
import type { GoalControlOutcomeV1 } from '../../src/app/goal-fan-out-driver.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import {
  AG2B_GOAL_REF, AG2B_PROJECT_REF, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_ROLE_BINDING, AG2B_WORK_TASK_ID,
  AG2B_WORKSPACE_REF, corePost, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost, type AG2bHost,
} from './AG2b-collaboration-fixture.js';

const temporary: string[] = [];

/** Removes every directory this fixture created (call from `afterEach`, after `cleanupAG2b`). */
export async function cleanupRestart(): Promise<void> {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
}

export async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

export async function publicDirectory(): Promise<string> {
  const publicDir = await tempDir('a2-restart-public-');
  await writeFile(join(publicDir, 'index.html'),
    `<!doctype html><meta name="${PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  return publicDir;
}

export const TASK = { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: AG2B_WORK_TASK_ID };

export async function post<T>(host: AG2bHost, suffix: string, body: unknown): Promise<T> {
  const response = await corePost(host.base, suffix, host.token, body);
  expect(response.status, suffix).toBe(200);
  return await response.json() as T;
}

/** Any answer of a route, refused or not: a refusal travels as a non-200 with its rejection body. */
export async function answer(host: AG2bHost, suffix: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await corePost(host.base, suffix, host.token, body);
  expect(response.status, suffix).not.toBe(500);
  return await response.json() as Record<string, unknown>;
}

export const selectWork = (flowId: string, goalLevel = false): WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef: AG2B_GOAL_REF,
  flowId, sessionHint: null, kind: 'select_work', ...(goalLevel ? {} : { taskId: AG2B_WORK_TASK_ID }) });

export type AdvanceValue = Extract<WorkflowAdvanceResult, { status: 'ready' }>['value'];

export async function driveWorkflow(host: AG2bHost, input: WorkflowAdvanceInput): Promise<AdvanceValue[]> {
  const steps: AdvanceValue[] = [];
  let current = input;
  for (let guard = 0; guard < 32; guard += 1) {
    const result = await post<WorkflowAdvanceResult>(host, 'workflow/advance', plain(AG2B_SCOPE, current));
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    steps.push(result.value);
    if (result.value.state === 'completed' || result.value.next === null) return steps;
    current = result.value.next;
  }
  throw new Error('the Workflow did not settle');
}

/** Drives the Workflow until its next request is a `perform` of `kind`, which is returned unperformed. */
export async function advanceUntil(host: AG2bHost, input: WorkflowAdvanceInput, kind: string): Promise<WorkflowAdvanceInput> {
  let current = input;
  for (let guard = 0; guard < 32; guard += 1) {
    if (current.kind === 'perform' && current.operation.kind === kind) return current;
    const result = await post<WorkflowAdvanceResult>(host, 'workflow/advance', plain(AG2B_SCOPE, current));
    if (result.status !== 'ready' || result.value.next === null) {
      throw new Error(`the Workflow stopped before ${kind}: ${JSON.stringify(result)}`);
    }
    current = result.value.next;
  }
  throw new Error(`the Workflow did not reach ${kind}`);
}

export type TaskRowLike = Record<string, unknown> & { execution: RunRef | null };

export async function workRow(host: AG2bHost, taskId = AG2B_WORK_TASK_ID): Promise<TaskRowLike> {
  const graph = await post<ReadResult<{ tasks: Array<{ ref: { taskId: string }; execution: RunRef | null } & Record<string, unknown>> }>>(
    host, 'tasks/query', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (graph.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(graph)}`);
  const row = graph.value.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`the Task ${taskId} must be in the graph`);
  return row;
}

export async function readExecution(host: AG2bHost, runRef: RunRef): Promise<TaskExecutionRecord> {
  const read = await post<ReadResult<TaskExecutionRecord>>(host, 'executions/read', plain(AG2B_SCOPE, runRef));
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

export async function readGoal(host: AG2bHost): Promise<GoalSnapshot> {
  const read = await post<ReadResult<{ goal: GoalSnapshot }>>(host, 'goals/read', plain(AG2B_SCOPE, AG2B_GOAL_REF));
  if (read.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(read)}`);
  return read.value.goal;
}

export async function readControl(host: AG2bHost, ref: ControlIntentSnapshotV1['ref']): Promise<ControlIntentSnapshotV1> {
  const read = await post<ReadResult<ControlIntentSnapshotV1>>(host, 'controls/read', plain(AG2B_SCOPE, ref));
  if (read.status !== 'ready') throw new Error(`the control intent must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

export async function readQuery(host: AG2bHost, queryJobRef: QueryJobRef): Promise<QueryJobRecord> {
  const read = await post<ReadResult<QueryJobRecord>>(host, 'queries/read', plain(AG2B_SCOPE, queryJobRef));
  if (read.status !== 'ready') throw new Error(`the Query must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

/** controls/submit of one control on a Run at its current revision. */
export async function submitControl(host: AG2bHost, runRef: RunRef, kind: 'pause' | 'cancel' | 'resume' | 'steer',
  reason: string | null, requestId: string): Promise<SubmittedControl> {
  const run = (await readExecution(host, runRef)).run;
  const submitted = await post<WriteResult<SubmittedControl>>(host, 'controls/submit', graphWrite(AG2B_SCOPE,
    { runRef, kind, reason }, requestId, [{ ref: runRef, revision: run.revision }]));
  if (submitted.status !== 'committed') throw new Error(`${kind}: ${JSON.stringify(submitted)}`);
  return submitted.value;
}

/** goals/control of the seeded Goal at its current revision. */
export async function controlGoal(host: AG2bHost, control: 'pause' | 'resume' | 'cancel', requestId: string):
  Promise<WriteResult<GoalControlOutcomeV1>> {
  const goal = await readGoal(host);
  return post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control', graphWrite(AG2B_SCOPE,
    { goalRef: AG2B_GOAL_REF, control, reason: `operator ${control}` }, requestId, [{ ref: AG2B_GOAL_REF, revision: goal.revision }]));
}

/** A pid that answers no signal: a short child process that has already exited. */
export function exitedPid(): number {
  const child = spawnSync(process.execPath, ['-e', '0']);
  if (typeof child.pid !== 'number' || child.pid <= 0) throw new Error('the child process did not start');
  return child.pid;
}

/** The lock a crashed Host leaves: it names a process that no longer exists (the next start is HL-03). */
export async function writeStaleLock(database: string): Promise<{ lockPath: string; crashedPid: number }> {
  const lockPath = join(database, HOST_INSTANCE_LOCK_FILE);
  const crashedPid = exitedPid();
  await writeFile(lockPath, JSON.stringify({ pid: crashedPid, hostInstanceId: 'a2-crashed-host', startedAt: '2026-10-05T00:00:00.000Z' }));
  return { lockPath, crashedPid };
}

export type Deferred<T = void> = { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void };
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail; });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

const KERNEL_FILES = ['kernel.sqlite', 'kernel.sqlite-wal', 'kernel.sqlite-shm', 'kernel.sqlite-journal'];

/** The mapped Kernel database becomes unreadable (probe `missing`); the files are kept aside for `restoreKernel`. */
export async function moveKernelAside(database: string): Promise<string> {
  const aside = await tempDir('a2-restart-kernel-aside-');
  for (const name of KERNEL_FILES) {
    if (existsSync(join(database, name))) await rename(join(database, name), join(aside, name));
  }
  return aside;
}

export async function restoreKernel(database: string, aside: string): Promise<void> {
  for (const name of KERNEL_FILES) {
    if (existsSync(join(aside, name))) await rename(join(aside, name), join(database, name));
  }
}

/** The private Host settings file beside the ledger with `automation` set (C8); the rest is kept or minimal. */
export async function writeAutomationSettings(database: string, automation: TaskAutomationPolicyV1): Promise<void> {
  const directory = join(database, 'host-settings');
  const path = join(directory, 'host-settings.json');
  await mkdir(directory, { recursive: true });
  let current: Record<string, unknown> = { schemaVersion: 1, models: [], selection: {}, workspaces: [] };
  if (existsSync(path)) current = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  await writeFile(path, JSON.stringify({ ...current, automation }));
}

/** queries/submit + queries/claim of one work-role semantic Query on `session`; returns the refs and the claim answer. */
export async function claimQueryOn(host: AG2bHost, session: TaskExecutionRecord['session'] | { ref: unknown; revision: number },
  suffix: string, roleBinding = AG2B_WORK_ROLE_BINDING): Promise<{ queryJobRef: QueryJobRef; queryRunRef: QueryRunRef; claim: Record<string, unknown> }> {
  const goal = await readGoal(host);
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...AG2B_SCOPE, queryJobId: `a2-restart-job-${suffix}` };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...AG2B_SCOPE, queryJobId: queryJobRef.queryJobId,
    runId: `a2-restart-query-${suffix}` };
  const intent = {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: AG2B_SCOPE.projectId, workspaceId: AG2B_SCOPE.workspaceId,
    goalId: AG2B_GOAL_REF.goalId, question: `A2 restart claim ${suffix}`, focusTaskRefs: [], budget: AG2B_QUERY_BUDGET,
    multiTurn: { maxRounds: 1 }, correlationId: `a2-restart-corr-${suffix}`,
    execution: { kind: 'semantic_query', roleBinding, runtimeBudget: AG2B_RUNTIME_BUDGET },
  };
  const submitted = await answer(host, 'queries/submit', graphWrite(AG2B_SCOPE, { queryJobId: queryJobRef.queryJobId,
    runId: queryRunRef.runId, intent }, `a2-restart-submit-${suffix}`, [
    { ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }, { ref: AG2B_GOAL_REF, revision: goal.revision },
    { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }]));
  expect(submitted, 'the Query is submitted').toMatchObject({ status: 'committed' });
  const claim = await answer(host, 'queries/claim', graphWrite(AG2B_SCOPE, { queryRunRef, sessionRef: session.ref },
    `a2-restart-claim-${suffix}`, [{ ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
      { ref: session.ref, revision: session.revision }]));
  return { queryJobRef, queryRunRef, claim };
}

export type PausedOnClosedHost = { runRef: RunRef; pauseIntentRef: ControlIntentSnapshotV1['ref'];
  oldSession: TaskExecutionRecord['session']; lockPath: string; crashedPid: number };

/**
 * Host 1: the Workflow enters the work Run; during the first model request the
 * operator pauses the Run (`controls/submit`) or the whole Goal (`goals/control`,
 * whose fan-out pauses the Run), so the Kernel Turn pauses at the safe point
 * after the first tool call. Host 1 closes (HL-06 removes its lock) unless
 * `keepOpen`; a stale lock naming an exited process is left, as a crashed Host
 * would leave it.
 */
export async function pausedRunOnClosedHost(root: string, database: string, publicDir: string, pause: 'run' | 'goal' = 'run',
  options: { beforeClose?: (host: AG2bHost, runRef: RunRef, pauseIntentRef: ControlIntentSnapshotV1['ref']) => Promise<void> } = {}):
Promise<PausedOnClosedHost> {
  let first: AG2bHost | undefined;
  let pauseSubmitted: WriteResult<SubmittedControl> | undefined;
  let goalPaused: WriteResult<GoalControlOutcomeV1> | undefined;
  first = await startAG2bHost(publicDir, { root, database,
    replies: [{ kind: 'calls', calls: [{ callId: 'a2-restart-read', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: 'A2 restart: never reached on the first Host' }],
    beforeReply: async (_request, index) => {
      if (index !== 0 || first === undefined) return;
      const runRef = (await workRow(first)).execution;
      if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
      if (pause === 'goal') {
        const goal = await readGoal(first);
        goalPaused = await post<WriteResult<GoalControlOutcomeV1>>(first, 'goals/control', graphWrite(AG2B_SCOPE,
          { goalRef: AG2B_GOAL_REF, control: 'pause', reason: 'operator pauses the Goal before the restart' }, 'a2-restart-goal-pause',
          [{ ref: AG2B_GOAL_REF, revision: goal.revision }]));
        return;
      }
      const run = (await readExecution(first, runRef)).run;
      pauseSubmitted = await post<WriteResult<SubmittedControl>>(first, 'controls/submit', graphWrite(AG2B_SCOPE,
        { runRef, kind: 'pause', reason: 'operator pause before the restart' }, 'a2-restart-pause',
        [{ ref: runRef, revision: run.revision }]));
    } });
  let runRef: RunRef;
  let pauseIntentRef: ControlIntentSnapshotV1['ref'];
  let oldSession: TaskExecutionRecord['session'];
  try {
    expect(first.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-01',
      report: { runs: [], queries: [], checks: [], controls: [], redriveGoals: [], problems: [] } });
    await seedAG2bWorkGraph(first);
    const steps = await driveWorkflow(first, selectWork('a2-restart-1'));
    expect(steps.at(-1)).toMatchObject({ state: 'waiting', next: null });
    expect(first.scripted.calls(), 'the pause landed at the safe point after the first tool call').toBe(1);
    if (pause === 'goal') {
      if (goalPaused?.status !== 'committed') throw new Error(`goal pause: ${JSON.stringify(goalPaused)}`);
      const [fanOut] = goalPaused.value.fanOut.runs;
      expect(fanOut).toMatchObject({ outcome: 'submitted', reason: null });
      pauseIntentRef = fanOut!.intentRef!;
    } else {
      if (pauseSubmitted?.status !== 'committed') throw new Error(`pause: ${JSON.stringify(pauseSubmitted)}`);
      pauseIntentRef = pauseSubmitted.value.intent.ref;
    }
    const row = await workRow(first);
    if (row.execution === null) throw new Error('the work Task must select its Run');
    runRef = row.execution;
    const paused = await readExecution(first, runRef);
    expect(paused.run).toMatchObject({ status: 'running', controlState: { intentRef: pauseIntentRef, desiredState: 'paused' } });
    expect(await post(first, 'controls/read', plain(AG2B_SCOPE, pauseIntentRef))).toMatchObject({ status: 'ready',
      value: { kind: 'pause', status: 'applied', observation: { kind: 'paused' } } });
    oldSession = paused.session;
    expect(oldSession.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: runRef.runId } });
    await options.beforeClose?.(first, runRef, pauseIntentRef);
  } finally {
    await first.host.close();
  }

  // HL-06: the closed Host removed its own lock. A crashed Host leaves one naming an exited process.
  const lockPath = join(database, HOST_INSTANCE_LOCK_FILE);
  expect(existsSync(lockPath)).toBe(false);
  const stale = await writeStaleLock(database);
  return { runRef, pauseIntentRef, oldSession, lockPath, crashedPid: stale.crashedPid };
}
