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
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { continuationBriefDigest, continuationBriefMarker, type ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, cleanupAG2b, corePost, graphWrite, plain,
  seedAG2bWorkGraph, startAG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  cleanupRestart, driveWorkflow, post, publicDirectory, readExecution, selectWork, TASK, workRow,
} from '../helpers/A2-restart-fixture.js';

afterEach(async () => {
  await cleanupAG2b();
  await cleanupRestart();
});

it('tasks/requeue and executions/brief: a failed Task is requeued over HTTP, continues with its brief and completes', async () => {
  const publicDir = await publicDirectory();
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
    const firstSteps = await driveWorkflow(host, selectWork('a2-requeue-route-1'), { stopBefore: 'requeue_task' });
    const first = firstSteps.at(-1)!;
    expect(first.state).not.toBe('completed');
    const failed = await workRow(host);
    expect(failed).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' },
      failure: { failureClass: 'check_failed',
        automation: { verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } } } });
    const run1Ref = failed.execution;
    if (run1Ref === null) throw new Error('Run 1 must be selected');
    const run1 = (await readExecution(host, run1Ref)).run;
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
    const secondSteps = await driveWorkflow(host, selectWork('a2-requeue-route-2'), { stopBefore: 'requeue_task' });
    expect(secondSteps.at(-1)).toMatchObject({ state: 'completed' });
    expect(await readFile(join(host.root, AG2B_RESULT_FILE), 'utf8')).toBe(AG2B_RESULT_TEXT);
    const done = await workRow(host);
    expect(done).toMatchObject({ effectivePhase: 'satisfied' });
    const run2Ref = done.execution;
    if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be selected');
    const run2 = (await readExecution(host, run2Ref)).run;
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
