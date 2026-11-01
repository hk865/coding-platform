/**
 * H-brief-entered (storage row, both backends; C63's public observations).
 *
 * One real manual handoff hands t2 and t3 plus the two note-free Goals' Tasks
 * to a created executor successor. The real composite drives the operation to
 * its notice write, so record 5 is ready and unconsumed. The successor's Runs
 * are then prepared and entered through the public Workflow advance:
 *
 * 1. its first manifest carries the handoff brief exactly once (binding/material),
 *    and the next Run carries none after the entered commit consumed it;
 * 2. a prepared attempt that never entered (a public cancel) leaves the brief
 *    for the next real Run;
 * 3. a named real preparation read failure writes nothing, and re-preparing the
 *    same Run still carries the brief;
 * 4. replaying the same entered/start commit does not enter twice, and the next
 *    Run still carries none.
 *
 * No `consumedBy` field is read and no store port is used: the proof is the
 * successor's public preparation/next Run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { HandoffProgressV1 } from '../../src/core/work-graph/model/session-handoff-contracts.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { WORK_HANDOFF_BRIEF_BY_SESSION_LOOKUP } from '../../src/core/work-graph/state/work-handoff-brief.js';
import { advanceUntil, driveWorkflow, submitControl } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { openS7CHandoffWorld, type S7CHandoffWorld } from '../helpers/S7C-handoff-fixture.js';
import { committed, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import * as hostModule from '../../src/app/host.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

/**
 * The real Host factory captured before any row's wrapper. The consume world's
 * factory wrapper is replayed by `restoreMocks` across rows, so every open first
 * resets the export to the real factory (the same hygiene `IV-host-fixture.ts`
 * documents); otherwise a second backend's open wraps a previous row's wrapper.
 */
const REAL_FACTORY = hostModule.createLocalWorkbenchHost;
function resetHostFactory(): void {
  Object.defineProperty(hostModule, 'createLocalWorkbenchHost',
    { value: REAL_FACTORY, configurable: true, writable: true });
}

const opened: S7CHandoffWorld[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of opened.splice(0)) await world.close();
});

/** The successor's prepared manifest, opened from the start perform's prepared envelope. */
async function successorManifestOf(world: S7CHandoffWorld, start: WorkflowAdvanceInput): Promise<PreparedTaskManifestV1> {
  if (start.kind !== 'perform' || start.operation.kind !== 'start') {
    throw new Error('S7C H-brief-entered: the Workflow next step is not the successor start');
  }
  const prepared = (start.operation.request as unknown as { prepared: { envelope: { bundleRef: unknown } } })
    .prepared;
  const openedMaterial = ready<{ body: string }>(
    await world.world.post('materials/open', plain(S6A_SCOPE, {
      ref: prepared.envelope.bundleRef, usage: 'historical_explanation',
    })), 'materials/open');
  return JSON.parse(openedMaterial.body) as PreparedTaskManifestV1;
}

/** The Goal's autonomy through the public settings route, so its Tasks may enter after the plan is adopted. */
async function setAutonomy(world: S7CHandoffWorld, goal: { aggregateType: 'Goal'; projectId: string; goalId: string }):
Promise<void> {
  const read = ready<{ goal: { revision: number } }>(
    await world.world.post('goals/read', plain(S6A_SCOPE, goal)), 'goals/read');
  const written = await world.world.post('goals/settings/set', graphWrite(S6A_SCOPE, {
    goalRef: goal, autonomy: 'after_plan_confirmation', waitForGoalRef: null,
  }, `s7c-h-entered-autonomy-${goal.goalId}`, [{ ref: goal, revision: read.goal.revision }]));
  committed(written, 'goals/settings/set');
}

type SuccessorFlow = {
  readonly world: S7CHandoffWorld;
  readonly successor: SessionRef;
  readonly select: (flowId: string, goal: GoalRef, task: TaskTriple) => WorkflowAdvanceInput;
};

/**
 * The real manual handoff to a created executor successor, driven to its notice write (record 5 ready), then the
 * successor's two note-free Goals made enterable and the line scripted for the Runs these rows prepare/start.
 */
async function openSuccessor(backend: 'memory' | 'sqlite', label: string): Promise<SuccessorFlow> {
  resetHostFactory();
  const world = await openS7CHandoffWorld({ backend });
  opened.push(world);
  const handed: TaskTriple[] = [...world.tasks.slice(0, 3), world.clean.task, world.other.task];
  const accepted = committed<{ operation: { aggregateType: 'CoreOperation'; projectId: string; operationId: string } }>(
    await (async () => ({ httpStatus: 200, body: await world.world.platform.sessionHandoff.acceptHandoff(
      world.world.humanContext(), {
        commandId: `s7c-h-entered-${backend}-${label}`, workspace: { ...S6A_SCOPE }, source: world.lines.source.ref,
        trigger: 'manual', assignments: [{ target: { kind: 'create', duty: 'executor' }, tasks: handed }],
      }) }))(), 'handoff accept');
  const operation = accepted.operation;

  // Drive the real composite to the notice write; record 5 is written by the archive step just before it.
  let progress: HandoffProgressV1 | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const answer = await world.world.platform.workflow.sessionHandoff.advance(
      world.world.systemContext(), { operation });
    progress = ready<HandoffProgressV1>({ httpStatus: 200, body: answer }, 'handoff advance');
    if (progress.stage === 'notice' || progress.stage === 'finished' || progress.phase === 'completed') break;
  }
  if (progress === null || progress.successor === null) {
    throw new Error(`S7C H-brief-entered: the handoff did not transfer: ${JSON.stringify(progress)}`);
  }
  const successor: SessionRef = { projectId: progress.successor.projectId, sessionId: progress.successor.sessionId };
  const successorCard = await world.world.readSession(successor);
  const line: S6ASession = { label: `s7c-h-entered-${label}`, ref: successor,
    aggregateRef: successorCard.record.ref, role: successorCard.record.role, createdAt: successorCard.record.createdAt };

  await setAutonomy(world, world.clean.goal);
  await setAutonomy(world, world.other.goal);
  await world.world.scripted.script(line, [
    { kind: 'text', text: `S7C H-brief-entered ${label} first answer` },
    { kind: 'text', text: `S7C H-brief-entered ${label} next answer` },
  ]);
  return {
    world, successor,
    select: (flowId, goal, task) => ({ schemaVersion: 1, goalRef: goal, flowId,
      sessionHint: successor, kind: 'select_work', taskId: task.taskId }),
  };
}

/** The successor Run a select_work/claim left in the Session's facts. */
async function latestRunOf(world: S7CHandoffWorld, successor: SessionRef) {
  const facts = ready<{ latestWork: { runRef: { aggregateType: 'Run'; projectId: string; goalId: string;
    runId: string } } | null }>(await world.world.post('sessions/facts', plain(S6A_SCOPE, successor)),
  'the successor facts');
  if (facts.latestWork === null) throw new Error('S7C H-brief-entered: the successor has no Work claim');
  return facts.latestWork.runRef;
}

describe.each(['memory', 'sqlite'] as const)('%s H-brief-entered', (backend) => {
  it('H-brief-entered: the first Run carries and consumes the brief once; the next Run carries none', async () => {
    const flow = await openSuccessor(backend, 'normal');
    const startInput = await advanceUntil(flow.world.world.ag2b, flow.select(`s7c-h-entered-${backend}-normal-1`,
      flow.world.clean.goal, flow.world.clean.task), 'start');
    const first = await successorManifestOf(flow.world, startInput);
    expect(first.handoffBrief).toBeDefined();
    expect(first.continuationBrief).toBeUndefined();
    expect(first.handoffBrief?.binding.successor).toEqual(flow.successor);
    const material = first.handoffBrief?.material;
    expect(material?.duty).toBe('executor');
    if (material?.duty !== 'executor') throw new Error('S7C H-brief-entered: the successor brief is not an executor brief');
    const handed = [...flow.world.tasks.slice(0, 3), flow.world.clean.task, flow.world.other.task];
    expect(new Set(material.tasks.map(entry => JSON.stringify(entry.task)))).toEqual(new Set(handed.map(task => JSON.stringify(task))));
    expect(first.contextAssembly.callKind).toBe('handoff');

    const startAnswer = await flow.world.world.post('workflow/advance', plain(S6A_SCOPE, startInput));
    const started = ready<{ next: WorkflowAdvanceInput | null }>(startAnswer, 'successor start');
    expect(started.next).not.toBeNull();
    if (started.next !== null) await driveWorkflow(flow.world.world.ag2b, started.next);

    const nextStart = await advanceUntil(flow.world.world.ag2b, flow.select(`s7c-h-entered-${backend}-normal-2`,
      flow.world.other.goal, flow.world.other.task), 'start');
    const next = await successorManifestOf(flow.world, nextStart);
    expect(next.handoffBrief).toBeUndefined();
    expect(next.continuationBrief).toBeUndefined();
    expect(nextStart.kind).toBe('perform');
  });

  it('H-brief-entered: a prepared attempt that never entered leaves the brief for the next Run', async () => {
    const flow = await openSuccessor(backend, 'not-entered');
    const startInput = await advanceUntil(flow.world.world.ag2b, flow.select(`s7c-h-entered-${backend}-not-entered-1`,
      flow.world.clean.goal, flow.world.clean.task), 'start');
    expect((await successorManifestOf(flow.world, startInput)).handoffBrief).toBeDefined();
    const run = await latestRunOf(flow.world, flow.successor);
    const cancelled = await submitControl(flow.world.world.ag2b, run, 'cancel',
      'the person stops the prepared attempt before it starts', `s7c-h-entered-${backend}-not-entered-cancel`);
    expect(cancelled.intent).toMatchObject({ kind: 'cancel', status: 'applied' });
    const execution = ready<{ run: { status: string; outcome?: string; startedAt: string | null } }>(
      await flow.world.world.post('executions/read', plain(S6A_SCOPE, run)), 'the cancelled attempt');
    expect(execution.run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });

    const nextStart = await advanceUntil(flow.world.world.ag2b, flow.select(`s7c-h-entered-${backend}-not-entered-2`,
      flow.world.other.goal, flow.world.other.task), 'start');
    expect((await successorManifestOf(flow.world, nextStart)).handoffBrief).toBeDefined();
  });

  it('H-brief-entered: a failed preparation writes nothing, and re-preparing still carries the brief', async () => {
    const flow = await openSuccessor(backend, 'failed-prepare');
    const select = flow.select(`s7c-h-entered-${backend}-failed-prepare`, flow.world.clean.goal, flow.world.clean.task);
    // The named brief read fails once: the prepare step answers waiting instead of a start.
    const fault = commitBarrier.failReads(WORK_HANDOFF_BRIEF_BY_SESSION_LOOKUP, 'throw-once');
    let stopped: unknown;
    try {
      await advanceUntil(flow.world.world.ag2b, select, 'start');
    } catch (error) {
      stopped = error;
    }
    expect(stopped).toBeInstanceOf(Error);
    expect(fault.calls()).toBe(1);
    const run = await latestRunOf(flow.world, flow.successor);
    const attempt = ready<{ run: { status: string; startedAt: string | null } }>(
      await flow.world.world.post('executions/read', plain(S6A_SCOPE, run)), 'the failed attempt');
    expect(attempt.run).toMatchObject({ status: 'starting', startedAt: null });

    // The same selection again: re-preparing the Run still carries the brief.
    const retried = await advanceUntil(flow.world.world.ag2b, select, 'start');
    expect((await successorManifestOf(flow.world, retried)).handoffBrief).toBeDefined();
  });

  it('H-brief-entered: replaying the same entered/start commit does not enter twice, and the next Run has no brief', async () => {
    const flow = await openSuccessor(backend, 'replay');
    const startInput = await advanceUntil(flow.world.world.ag2b, flow.select(`s7c-h-entered-${backend}-replay-1`,
      flow.world.clean.goal, flow.world.clean.task), 'start');
    expect((await successorManifestOf(flow.world, startInput)).handoffBrief).toBeDefined();
    const started = ready<{ next: WorkflowAdvanceInput | null }>(
      await flow.world.world.post('workflow/advance', plain(S6A_SCOPE, startInput)), 'the first start');
    const replay = ready<{ state: string; receipt: { kind: string; result: { status: string } } | null }>(
      await flow.world.world.post('workflow/advance', plain(S6A_SCOPE, startInput)), 'the replayed start');
    // The Runtime answers the same start from the committed record; the Run is not entered a second time.
    expect(replay).toMatchObject({ state: 'advance', receipt: { kind: 'start', result: { status: 'ready' } } });
    if (started.next !== null) await driveWorkflow(flow.world.world.ag2b, started.next);

    const nextStart = await advanceUntil(flow.world.world.ag2b, flow.select(`s7c-h-entered-${backend}-replay-2`,
      flow.world.other.goal, flow.world.other.task), 'start');
    expect((await successorManifestOf(flow.world, nextStart)).handoffBrief).toBeUndefined();
  });
});

describe('sqlite H-brief-recovery', () => {
  it('H-brief-recovery: the reconcile commit that records entry does not consume a brief the ordinary Run never carried', async () => {
    resetHostFactory();
    const world = await openS7CHandoffWorld({ backend: 'sqlite' });
    opened.push(world);
    const main = s6aCardsWorkspace(world.world, S6A_SCOPE);
    const ownTask = world.tasks[3]!;
    // The handoff target is a real Work line that exists BEFORE the handoff; its own t4 Run is prepared before the transfer.
    const existing = await sessionOf(world.world, await createS6BLine(main,
      { label: 's7c-h-recovery-existing', role: S6A_WORK_ROLE, tasks: [ownTask] }));
    await world.world.scripted.script(existing, [
      { kind: 'text', text: 'the recovered ordinary Run answer' },
      { kind: 'text', text: 'the next Run answer' },
    ]);
    const ordinary = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
      flowId: 's7c-h-recovery-ordinary', sessionHint: existing.ref, kind: 'select_work', taskId: ownTask.taskId },
    'start');
    expect((await successorManifestOf(world, ordinary)).handoffBrief).toBeUndefined();
    const start = ordinary as Extract<WorkflowAdvanceInput, { kind: 'perform' }>;
    const prepared = (start.operation.request as unknown as { prepared: { claim: { runRef: RunRef; sessionRef: SessionRef } } })
      .prepared;
    expect(prepared.claim.sessionRef).toEqual(existing.ref);

    // The real manual handoff to this EXISTING successor runs through the responsibility transfer to the notice.
    const accepted = committed<{ operation: { aggregateType: 'CoreOperation'; projectId: string; operationId: string } }>(
      await (async () => ({ httpStatus: 200, body: await world.world.platform.sessionHandoff.acceptHandoff(
        world.world.humanContext(), {
          commandId: 's7c-h-recovery-accept', workspace: { ...S6A_SCOPE }, source: world.lines.source.ref,
          trigger: 'manual', assignments: [{ target: { kind: 'existing', session: existing.ref },
            tasks: [...world.tasks.slice(0, 3), world.clean.task, world.other.task] }],
        }) }))(), 'handoff accept');
    const operation = accepted.operation;
    let progress: HandoffProgressV1 | null = null;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      progress = ready<HandoffProgressV1>({ httpStatus: 200,
        body: await world.world.platform.workflow.sessionHandoff.advance(world.world.systemContext(), { operation }) },
      'handoff advance');
      if (progress.stage === 'notice' || progress.stage === 'finished' || progress.phase === 'completed') break;
    }
    expect(progress?.stage === 'notice' || progress?.stage === 'finished' || progress?.phase === 'completed',
      JSON.stringify(progress)).toBe(true);

    // The prepared ordinary Run enters only now: its entered commit is held, the Host restarts, and the reconcile
    // commit is the one that first records entry. Its frozen manifest names no brief.
    const hold = commitBarrier.hold(byIdentityPrefix('b2-entry-entered:'), 'the ordinary Run entered commit');
    const abandoned = world.world.post('workflow/advance', plain(S6A_SCOPE, ordinary));
    abandoned.catch(() => undefined);
    await hold.reached;
    await world.world.crash();
    // The old Host's entered commit stays held until every assertion on the new Host has run: releasing it earlier
    // could let it record the entry and mask a recovery commit that does not contribute its own consumption.
    try {
      const afterRecovery = ready<{ next: WorkflowAdvanceInput | null }>(
        await world.world.post('workflow/advance', plain(S6A_SCOPE, ordinary)), 'the recovered ordinary Run');
      if (afterRecovery.next !== null) await driveWorkflow(world.world.ag2b, afterRecovery.next);
      const execution = ready<{ run: { status: string; startedAt: string | null } }>(
        await world.world.post('executions/read', plain(S6A_SCOPE, prepared.claim.runRef)), 'the recovered ordinary Run');
      expect(execution.run.startedAt).not.toBeNull();

      // After the recovery and the transfer the successor's next real Run still carries the brief.
      const nextStart = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.clean.goal,
        flowId: 's7c-h-recovery-next', sessionHint: existing.ref, kind: 'select_work',
        taskId: world.clean.task.taskId }, 'start');
      const next = await successorManifestOf(world, nextStart);
      expect(next.handoffBrief).toBeDefined();
      expect(next.handoffBrief?.binding.successor).toEqual(existing.ref);
    } finally {
      hold.release();
      await abandoned.catch(() => undefined);
    }
  }, 240_000);
});
