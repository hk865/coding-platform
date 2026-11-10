/**
 * 7D2 DKTID R2, R3 (ktid-tests.frozen.md §1 R2/R3, §3; rulings K2, K3, K6, K8, K9, K10): a line whose Kernel history
 * is rejected for good (a tool call id repeated across two completed Turns) ends its next Query round and its next
 * Work Run with the named reason and frees the line, instead of keeping the round `running` or the Run `starting`.
 *
 * Entry: a real Host (`createTargetPlatform`, memory platform, real SQLite Kernel), its Query routes (R2) and its
 * Workflow (R3); every assertion reads a public route (`queries/read`, `executions/read`, `sessions/read`,
 * `workflow/advance`).
 *
 * The world's one exception (K4, K9; it is not a pattern for other tests): rule F3 forbids appending records by hand,
 * but these two rows preset the two bad Turns through `KernelSessionFixture` (public `SqliteStores` only, on the
 * Kernel store the Host registered for the line). The public route cannot make that history: a reply that repeats a
 * call id inside itself is refused by the model stream check (`model-client-port.js:185–:187` `duplicate_tool_call`
 * → `model-stream-consumer.js:101–:110` `protocol_error` → `runtime-runner.ts:850–:858` `model_protocol`) and never
 * reaches the history restore (`session-history.ts:492`). After the preset one ordinary round or Run runs through the
 * public steps, so the platform publishes a completed boundary past the bad Turns; the next one restores them.
 *
 * Expected literals: `history_rejected` is the build's code (K3, K8); the original reason is the Kernel's restore
 * refusal, its label `Session 历史前缀` (`session-history.ts:492`) and its text `重复 ToolCall call_0` (`:141`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowAdvanceResult, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { plain, startBusyQuery } from '../helpers/AG2b-collaboration-fixture.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { KernelSessionFixture } from '../helpers/K-session-support.js';
import {
  openS6ARequestWorld, S6A_SCOPE, type S6AQueryRefs, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { claimedRunOf, openS7AWorkSetup, ready, runS7ASameSessionAgain } from '../helpers/S7A-fixture.js';

const worlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/**
 * K9's preset (§3.3): two completed Turns on the line's own Kernel Session, each calling `read` as `call_0` with its
 * result. `tool.started` comes before `tool.completed` because the reducer settles only a running call.
 */
async function presetRepeatedCallIds(world: S6ARequestWorld, session: S6ASession): Promise<void> {
  const { kernel } = (await world.readSession(session)).record;
  await world.platform.kernelStores.withStore(kernel.adapterId, async (store) => {
    const f = await KernelSessionFixture.open(store, kernel.kernelSessionId);
    for (const n of [1, 2]) {
      await f.startTurn({ runId: `dkt-r${String(n)}`, turnId: `dkt-t${String(n)}`, input: `DKTID preset ${String(n)}` });
      await f.event('run.started', {});
      await f.event('model.request_started', { requestId: `dkt-r${String(n)}-req1`, retryOfRequestId: null });
      await f.event('assistant.message_completed', {
        requestId: `dkt-r${String(n)}-req1`,
        message: { schemaVersion: 1, messageId: `dkt-t${String(n)}-a1`, role: 'assistant', content: 'calling' },
        toolCalls: [{ schemaVersion: 1, callId: 'call_0', name: 'read', arguments: { path: 'a.txt' } }],
      });
      await f.event('tool.started', {
        call: { schemaVersion: 1, callId: 'call_0', name: 'read', arguments: { path: 'a.txt' } },
      });
      await f.event('tool.completed', {
        callId: 'call_0',
        result: {
          status: 'success', schemaVersion: 1, callId: 'call_0',
          output: [{ kind: 'text', text: `DKTID preset ${String(n)} result` }],
          effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
        },
      });
      await f.event('model.request_started', { requestId: `dkt-r${String(n)}-req2`, retryOfRequestId: null });
      await f.event('assistant.message_completed', {
        requestId: `dkt-r${String(n)}-req2`,
        message: { schemaVersion: 1, messageId: `dkt-t${String(n)}-a2`, role: 'assistant', content: 'done' },
        toolCalls: [],
      });
      await f.event('run.completed', { finalMessageId: `dkt-t${String(n)}-a2` });
    }
  });
}

async function readQuery(world: S6ARequestWorld, refs: S6AQueryRefs): Promise<QueryJobRecord> {
  return ready<QueryJobRecord>((await world.post('queries/read', plain(S6A_SCOPE, refs.queryJobRef))).body,
    `the Query ${refs.suffix}`);
}

/**
 * Bounded poll of `queries/read` until the round leaves `running` (rule F9: public state, no sleep); the last read is
 * returned either way, so a round that never settles fails on the row's own terminal assertion.
 */
async function settledQuery(world: S6ARequestWorld, refs: S6AQueryRefs): Promise<QueryJobRecord> {
  let read = await readQuery(world, refs);
  for (let attempt = 0; attempt < 50 && read.run.run.status === 'running'; attempt += 1) read = await readQuery(world, refs);
  return read;
}

async function readRun(world: S6ARequestWorld, run: TaskExecutionRecord['run']['ref']): Promise<TaskExecutionRecord> {
  return ready<TaskExecutionRecord>(await world.post('executions/read', plain(S6A_SCOPE, run)), `the Run ${run.runId}`);
}

/** The Run step (`prepare`, `start` or `observe`) an advance answer asks for next on `runId`, or null. */
function runStepOn(answer: WorkflowAdvanceResult, runId: string): string | null {
  if (answer.status !== 'ready') return null;
  const next = answer.value.next;
  if (next?.kind !== 'perform') return null;
  const { kind, request } = next.operation;
  return ['prepare', 'start', 'observe'].includes(kind) && JSON.stringify(request).includes(runId) ? kind : null;
}

describe('7D2 DKTID: a deterministically rejected history ends the round or Run (real Host, memory, Kernel SQLite)', () => {
  it('DKTID-R2 the next Query round on the line closes failed with history_rejected and frees the line', async () => {
    const world = await openS6ARequestWorld({ backend: 'memory' });
    worlds.push(world);
    const session = await world.createSecretary('dktid-r2');
    await presetRepeatedCallIds(world, session);
    // A normal round runs on its own Turn (no completed boundary yet) and publishes its end as the boundary.
    const normal = await world.occupy(session);
    await world.finishQuery(normal);
    expect((await readQuery(world, normal)).run.run.outcome, 'the normal round is answered').toBe('answered');
    expect((await world.readSession(session)).record.historyCursor, 'the boundary moved').not.toBeNull();
    const target = await world.occupy(session);
    const requests = world.model.calls();

    // No reply is scripted: the history refusal comes before any model request. The start's answer is kept and
    // checked after the terminal read (K9), so a refused start fails on the row's own terminal assertion.
    const start = await startBusyQuery(world.ag2b, target, 'dktid-target')
      .then(() => 'ready', (error: unknown) => String(error));
    const settled = await settledQuery(world, target);

    expect(settled.run.run).toMatchObject({ status: 'closed', outcome: 'failed' });
    // K10: the code prefix appears exactly once, before the Kernel's own refusal text.
    expect(settled.job.job.closeReason?.message).toBe('history_rejected: Session 历史前缀：重复 ToolCall call_0');
    expect(start, 'queries/start answers ready').toBe('ready');
    const again = await readQuery(world, target);
    expect(again.run.run, 'a second read is still terminal').toMatchObject({ status: 'closed', outcome: 'failed' });
    expect(world.model.calls(), 'no model request').toBe(requests);
    expect((await world.readSession(session)).record.occupancy, 'the line is free').toBeNull();
  });

  it('DKTID-R3 the next Work Run on the line ends crashed with history_rejected, frees the line and is not waited on as starting', async () => {
    const setup = await openS7AWorkSetup({ backend: 'memory' });
    worlds.push(setup.world);
    const { world, line } = setup;
    await presetRepeatedCallIds(world, line);
    // The first Task's Run runs on its own Turn (no completed boundary yet) and publishes its end as the boundary.
    await world.scripted.script(line, [{ kind: 'text', text: 'S7A first Work answer' }]);
    const claimInput = await advanceUntil(world.ag2b, setup.select, 'claim_task');
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, claimInput, { stopBefore: 'claim_task', receipts });
    const first = claimedRunOf(receipts, 'the first Task').run;
    expect((await readRun(world, first)).run, 'the first Run completed').toMatchObject({ status: 'ended', outcome: 'completed' });

    const target = await runS7ASameSessionAgain(world, line);
    const read = await readRun(world, target.run);

    expect(read.run).toMatchObject({ status: 'ended', outcome: 'crashed' });
    // K8: the Run's error text names the code and keeps the Kernel's refusal.
    expect(read.run.terminalPayload).toMatchObject({ kind: 'crashed', error: expect.stringContaining('history_rejected') });
    expect(read.run.terminalPayload).toMatchObject({ error: expect.stringContaining('重复 ToolCall call_0') });
    expect((await world.readSession(line)).record.occupancy, 'the line is free').toBeNull();
    // The second advance claims a new Run or stops for a decision (FC-9, the automatic cap): it neither waits on the
    // target Run as starting nor takes it up again.
    const again = (await world.post('workflow/advance', plain(S6A_SCOPE, { schemaVersion: 1, goalRef: setup.goal,
      flowId: 'dktid-r3-again', sessionHint: line.ref, kind: 'select_work', taskId: setup.tasks[1]!.taskId })))
      .body as WorkflowAdvanceResult;
    expect(again.status, 'the second advance answers').toBe('ready');
    expect(again.status === 'ready' ? again.value.reason ?? '' : '', 'not waited on as starting')
      .not.toMatch(/still starting/);
    expect(runStepOn(again, target.run.runId), 'the target Run is not taken up again').toBeNull();
  });
});
