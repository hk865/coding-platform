/**
 * A.2 step 5.3 through the real Host (docs/refactor/STATE-MACHINES-SPEC.md §4.1
 * P5, P17, P18 and TD-5; §4.3 TASK-21..23): the projection of a yielded wait
 * follows the stop pointer of its Run.
 *
 * The Workflow claims and starts the work Run over HTTP (`workflow/advance`);
 * the scripted model sends an explicit inquiry wait message to a linked Session, so
 * the Run really yields with a durable continuation. No driver is started, so
 * nobody answers the wait. Controls are submitted on the yielded Run through
 * `controls/submit`, and every step reads `tasks/query` and selects the Task
 * again through the Workflow:
 *
 * - P5: the held continuation is `ready`; the Workflow waits for the answer.
 * - P18 (TASK-22): a pause shows `blocked/continuation_paused`; the Workflow
 *   offers no continuation claim.
 * - P5 again (TASK-23): a resume returns the Task to `ready`.
 * - P17 (TASK-22): a cancel shows `failed/continuation_cancelled`; the Workflow
 *   offers no continuation claim.
 *
 * One model call (the wait message); nothing answers or continues the Run.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PLATFORM_TOKEN_PLACEHOLDER, type SessionRef,
} from '../../src/app/core-http-types.js';
import { UI_PLATFORM_TOKEN_META_NAME } from '../../src/ui/api/protocol.js';
import type { ControlIntentKindV1, SubmittedControl } from '../../src/contracts/control-intent.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, cleanupAG2b, corePost, createAG2bSession, graphWrite, plain,
  seedAG2bWorkGraph, startAG2bHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow, post, readExecution, selectWork, workRow } from '../helpers/A2-restart-fixture.js';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';

const temporary: string[] = [];
afterEach(async () => {
  await cleanupAG2b();
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function control(host: AG2bHost, runRef: RunRef, kind: ControlIntentKindV1): Promise<SubmittedControl> {
  const run = (await readExecution(host, runRef)).run;
  const response = await corePost(host.base, 'controls/submit', host.token, graphWrite(AG2B_SCOPE,
    { runRef, kind, reason: null }, `a2-td5-${kind}`, [{ ref: runRef, revision: run.revision }]));
  const submitted = await response.json() as WriteResult<SubmittedControl>;
  if (submitted.status !== 'committed') throw new Error(`the ${kind} must commit: ${JSON.stringify(submitted)}`);
  return submitted.value;
}

/** One `workflow/advance` call, through the same public route the drive uses. */
async function advanceOnce(host: AG2bHost, flowId: string) {
  const result = await post<WorkflowAdvanceResult>(host, 'workflow/advance', plain(AG2B_SCOPE, selectWork(flowId)));
  if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
  return result.value;
}

it('TD-5: a paused yielded wait is blocked, a resumed one ready, a cancelled one failed; the Workflow claims neither stopped one', async () => {
  const publicDir = await mkdtemp(join(tmpdir(), 'a2-td5-public-'));
  temporary.push(publicDir);
  await writeFile(join(publicDir, 'index.html'),
    `<!doctype html><meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  let recipient: SessionRef | undefined;
  const send = { callId: 'a2-td5-send', name: 'send_session_message',
    args: { recipient: {}, text: 'A2 TD-5 question that nobody answers', intent: 'inquiry', needsReply: true, waitAfterSend: true } as Record<string, unknown> };
  const replies: ScriptedReply[] = [{ kind: 'calls', calls: [send] }];
  const host = await startAG2bHost(publicDir, { replies, beforeReply: async (_request, index) => {
    if (index === 0 && recipient !== undefined) send.args['recipient'] = { projectId: recipient.projectId, sessionId: recipient.sessionId };
  } });
  try {
    const { workTarget } = await seedAG2bWorkGraph(host);
    recipient = (await createAG2bSession(host, 'a2-td5-recipient', AG2B_QUERY_ROLE,
      [{ target: workTarget, relation: 'participates' }])).sessionRef;

    // The Workflow creates the work Session, claims, prepares and starts the Run; the Run yields on its wait.
    const steps = await driveWorkflow(host, selectWork('a2-td5-flow'));
    const step = steps.at(-1)!;
    const start = step.receipt;
    if (start?.kind !== 'start' || start.result.status !== 'ready') throw new Error(`the Run must start: ${JSON.stringify(step)}`);
    const runRef = start.result.value.run.ref;
    expect(start.result.value.run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
    expect(step).toMatchObject({ state: 'waiting', next: null });

    // P5: the held continuation is ready; the Workflow waits for the answer, it claims nothing.
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'ready' });
    expect((await workRow(host))['phaseCause']).toBeUndefined();
    expect(await advanceOnce(host, 'a2-td5-ready-1')).toMatchObject({ state: 'waiting', next: null,
      reason: 'the continuation wait has not been answered yet' });

    // P18 (TASK-22): a pause on the wait holds the continuation; the Task is blocked and is not selected.
    await control(host, runRef, 'pause');
    expect((await readExecution(host, runRef)).run.controlState).toMatchObject({ desiredState: 'paused' });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'continuation_paused' } });
    expect(await advanceOnce(host, 'a2-td5-paused')).toMatchObject({ state: 'waiting', next: null,
      reason: `the selected Task ${AG2B_WORK_TASK_ID} is not executable right now` });

    // TASK-23: the resume returns the Task to ready (P5).
    await control(host, runRef, 'resume');
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'ready' });
    expect(await advanceOnce(host, 'a2-td5-ready-2')).toMatchObject({ state: 'waiting', next: null,
      reason: 'the continuation wait has not been answered yet' });

    // P17 (TASK-22): a cancel fences the continuation; the Task is failed and is not selected.
    // Hand calculation: the Run already yielded (ended) and nobody consumed its
    // wait reply, so the cancel is a queued fence intent, not an applied stop
    // (a non-entered Run is the only path applied at once, RUN-09); it keeps the
    // Run ended/yielded and the projection reports continuation_cancelled.
    const cancelled = await control(host, runRef, 'cancel');
    expect(cancelled.intent.status).toBe('queued');
    expect((await readExecution(host, runRef)).run).toMatchObject({ status: 'ended', outcome: 'yielded',
      controlState: { desiredState: 'cancelled' } });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'continuation_cancelled' } });
    expect(await advanceOnce(host, 'a2-td5-cancelled')).toMatchObject({ state: 'waiting', next: null,
      reason: `the selected Task ${AG2B_WORK_TASK_ID} is not executable right now` });
    expect(host.scripted.calls(), 'only the wait message called the model').toBe(1);
  } finally {
    await host.host.close();
  }
}, 60_000);
