/**
 * A.2 step 5.4 through the real Host over HTTP (docs/refactor/STATE-MACHINES-SPEC.md
 * §4 TASK-16, P4, TASK-03; §6.1 contract (e) and §7.7 C3; routes `tasks/requeue`
 * and `executions/brief`).
 *
 * The Workflow runs the work Task over `workflow/advance` on a real SQLite
 * ledger and Kernel. Run 1 only answers with text, so the registered check
 * (the result file must exist with the expected text) fails and the Task is
 * `failed`. The operator requeues over `tasks/requeue`; the Task reads
 * `pending/requeued` from `tasks/query`; the Workflow claims the requeue, the
 * continuation brief reaches the model, Run 2 writes the file, its round
 * passes and the Goal completes. `executions/brief` returns Run 2's brief
 * (digest-checked) and `null` for Run 1.
 *
 * Three scripted model calls (Run 1's text; Run 2's edit and final text).
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PLATFORM_TOKEN_PLACEHOLDER, type TaskExecutionRecord,
} from '../../src/app/core-http-types.js';
import { UI_PLATFORM_TOKEN_META_NAME } from '../../src/ui/api/protocol.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import { continuationBriefDigest, continuationBriefMarker, type ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_WORK_TASK_ID, cleanupAG2b, corePost, graphWrite, plain,
  seedAG2bWorkGraph, startAG2bHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';

const temporary: string[] = [];
afterEach(async () => {
  await cleanupAG2b();
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

const TASK = { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: AG2B_WORK_TASK_ID };

async function post<T>(host: AG2bHost, suffix: string, body: unknown): Promise<T> {
  const response = await corePost(host.base, suffix, host.token, body);
  expect(response.status, suffix).toBe(200);
  return await response.json() as T;
}

/**
 * Drive `workflow/advance` until the Workflow settles. Since A.2 step 5.8 the Workflow requeues a failed
 * Task automatically (C8); this test is the operator's `tasks/requeue`, so the Host stops before that
 * automatic `requeue_task` (tests/scenarios/A1-rework-same-session.test.ts drives it).
 */
async function driveWorkflow(host: AG2bHost, flowId: string): Promise<Extract<WorkflowAdvanceResult, { status: 'ready' }>['value']> {
  let input: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId, sessionHint: null, kind: 'select_work',
    taskId: AG2B_WORK_TASK_ID };
  for (let guard = 0; guard < 32; guard += 1) {
    const result: WorkflowAdvanceResult = await post<WorkflowAdvanceResult>(host, 'workflow/advance', plain(AG2B_SCOPE, input));
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.state === 'completed' || result.value.next === null) return result.value;
    input = result.value.next;
    if (input.kind === 'perform' && input.operation.kind === 'requeue_task') return result.value;
  }
  throw new Error('the Workflow did not settle');
}

async function workRow(host: AG2bHost): Promise<Record<string, unknown> & { execution: RunRef | null }> {
  const graph = await post<ReadResult<{ tasks: Array<{ ref: { taskId: string }; execution: RunRef | null } & Record<string, unknown>> }>>(
    host, 'tasks/query', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (graph.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(graph)}`);
  const row = graph.value.tasks.find(candidate => candidate.ref.taskId === AG2B_WORK_TASK_ID);
  if (row === undefined) throw new Error('the work Task must be in the graph');
  return row;
}

async function readRun(host: AG2bHost, runRef: RunRef): Promise<TaskExecutionRecord['run']> {
  const read = await post<ReadResult<TaskExecutionRecord>>(host, 'executions/read', plain(AG2B_SCOPE, runRef));
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value.run;
}

it('tasks/requeue and executions/brief: a failed Task is requeued over HTTP, continues with its brief and completes', async () => {
  const publicDir = await mkdtemp(join(tmpdir(), 'a2-requeue-public-'));
  temporary.push(publicDir);
  await writeFile(join(publicDir, 'index.html'),
    `<!doctype html><meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  const replies: ScriptedReply[] = [
    { kind: 'text', text: 'A2 requeue: first attempt without the result file' },
    { kind: 'calls', calls: [{ callId: 'a2-requeue-edit', name: 'edit',
      args: { mode: 'create', path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
    { kind: 'text', text: 'A2 requeue: the result file is written' },
  ];
  const host = await startAG2bHost(publicDir, { replies });
  try {
    await seedAG2bWorkGraph(host);

    // Run 1 ends with text only; the registered check fails and the Task is failed.
    const first = await driveWorkflow(host, 'a2-requeue-route-1');
    expect(first.state).not.toBe('completed');
    const failed = await workRow(host);
    expect(failed).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' },
      failure: { failureClass: 'check_failed',
        automation: { verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } } } });
    const run1Ref = failed.execution;
    if (run1Ref === null) throw new Error('Run 1 must be selected');
    const run1 = await readRun(host, run1Ref);
    const goal = await post<ReadResult<{ goal: GoalSnapshot }>>(host, 'goals/read', plain(AG2B_SCOPE, AG2B_GOAL_REF));
    if (goal.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(goal)}`);

    // TASK-16 over `tasks/requeue` (a Host graph write pinned to the Goal and the afterRun).
    const requeued = await post<WriteResult<TaskRequeueOutcomeV1>>(host, 'tasks/requeue', graphWrite(AG2B_SCOPE,
      { taskRef: TASK, afterRunRef: run1Ref, reason: 'the result file is missing' }, 'a2-requeue-route',
      [{ ref: AG2B_GOAL_REF, revision: goal.value.goal.revision }, { ref: run1Ref, revision: run1.revision }]));
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue: ${JSON.stringify(requeued)}`);
    const requeueRef = requeued.value.requeue.ref;
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'pending', requeueRef,
      phaseCause: { code: 'requeued', detail: { requeueRef } } });

    // The Workflow claims the requeue; Run 2 starts with the brief, writes the file and the Goal completes.
    const second = await driveWorkflow(host, 'a2-requeue-route-2');
    expect(second).toMatchObject({ state: 'completed' });
    expect(await readFile(join(host.root, AG2B_RESULT_FILE), 'utf8')).toBe(AG2B_RESULT_TEXT);
    const done = await workRow(host);
    expect(done).toMatchObject({ effectivePhase: 'satisfied' });
    const run2Ref = done.execution;
    if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be selected');
    const run2 = await readRun(host, run2Ref);
    expect(run2).toMatchObject({ requeueRef, outcome: 'completed' });
    const digest = run2.inputBinding?.continuationBriefDigest;
    if (digest === undefined) throw new Error('Run 2 must bind its brief');
    expect(JSON.stringify(host.scripted.requests[1])).toContain(continuationBriefMarker(digest));

    // `executions/brief`: the pinned brief for Run 2 (its digest checked), none for Run 1.
    const brief = await post<ReadResult<{ brief: ContinuationBriefV1; digest: string } | null>>(host, 'executions/brief',
      plain(AG2B_SCOPE, { runRef: run2Ref }));
    if (brief.status !== 'ready' || brief.value === null) throw new Error(`the brief must be readable: ${JSON.stringify(brief)}`);
    expect(brief.value.digest).toBe(digest);
    expect(continuationBriefDigest(brief.value.brief)).toBe(digest);
    expect(brief.value.brief).toMatchObject({ runRef: run2Ref, requeueRef, mode: 'rework', failureClass: 'check_failed',
      previous: { runRef: run1Ref, outcome: 'completed' }, trigger: { actorClass: 'human', requeueNumber: 1 } });
    expect(await post(host, 'executions/brief', plain(AG2B_SCOPE, { runRef: run1Ref }))).toEqual({ status: 'ready', value: null });
    // A malformed `executions/brief` body is an `invalid` refusal, never a Host failure.
    for (const input of [null, 'not-a-request', { runRef: 'not-a-run' }, { runRef: { ...run2Ref, runId: '' } }]) {
      const response = await corePost(host.base, 'executions/brief', host.token, plain(AG2B_SCOPE, input));
      expect(response.status, JSON.stringify(input)).not.toBe(500);
      expect(await response.json(), JSON.stringify(input)).toMatchObject({ status: 'rejected', code: 'invalid' });
    }
    expect(host.scripted.calls()).toBe(3);
  } finally {
    await host.host.close();
  }
}, 90_000);
