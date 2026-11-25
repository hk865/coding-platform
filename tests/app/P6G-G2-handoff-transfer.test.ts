/**
 * P6G G2 (lead start ruling `p6g-rulings.md` §G2 and its test line; P6 diagnosis 2 rows 7–8, E06): a handoff asked
 * for while the source line's own Work Run is still running finishes its task transfer once that Run ends, and the
 * successor line takes the brief's tasks and consumes the brief; a version conflict met on the way is read again and
 * retried, never a silent stop at `transfer`.
 *
 * World: FL-1's read world (`openS7CReadWorld`, `tests/helpers/S7C-L2-world.ts`; memory, and G2-2's version conflict
 * also on SQLite per RULES S3; the A4 record/body mocks
 * below as `tests/app/S7C-L2.test.ts:42-68` installs them). Its executor line answers for both plan Tasks and has
 * `hand_off`; the Host's trusted check FAILs while `S7C_L2_RESULT_PATH` is missing, so a Task whose Run ended is
 * requeued after its round. The source Run of Task 2 writes its Goal understanding with the real `record_note`, then
 * calls the real `hand_off` for both Tasks to a new executor line (E06's `{kind:'create'}`), and is held at its next
 * model request, so the Work Run is still running after the accept. This world's Host runs without the request
 * driver, so the rows make the Host lifecycle pass's own call, the published `workflow.sessionHandoff.continueHandoff`
 * (`src/app/host.ts:1649`), at the points E06's Host made it: once while the source Run runs, then after it ended.
 * Every fact is read through `sessions/operation`, `sessions/read`, `workflow/advance` and `materials/open`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { understandingNote } from '../helpers/S4C2-note-card-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { openS7CReadWorld, type S7CReadWorld } from '../helpers/S7C-L2-world.js';

const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const wrapped = await barrier.inMemoryBarrierModule(async () => actual);
  const create = wrapped.createInMemoryRecordBackend;
  return { ...wrapped, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    if (shared.backend === undefined) shared.backend = { ...create(options), close: async () => undefined };
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() {
      shared.bodies ??= new actual.RawArtifactBodyStore();
      return shared.bodies as never;
    }
  } as never };
});

// One world per row: the A4 backend is shared only inside that row's open/reopen pair.
beforeEach(() => { shared.backend = undefined; shared.bodies = undefined; });

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

/** The handoff operation's public record (`sessions/operation`): only what the rows read. */
type HandoffRead = { revision: number; action: { kind: string; progress: {
  successor?: unknown;
  assignments: { successor: SessionRef | null; transfers: { input: { expected: { toSession: number } } | null }[] }[];
} } };

type HandoffScene = {
  readonly opened: S7CReadWorld;
  readonly world: S6AHostWorld;
  readonly tasks: readonly TaskTriple[];
  readonly operation: OperationRef;
  /** Releases the held source Run and waits until it ended. */
  readonly endSource: () => Promise<void>;
};

/**
 * The source Run of Task 2 hands both Tasks to a new executor line and is then held at its next model request: the
 * `hand_off` result is in that request, so the accept is committed while the Work Run still runs.
 */
async function handOffWhileRunning(label: string, backend: 'memory' | 'sqlite' = 'memory'): Promise<HandoffScene> {
  const opened = await openS7CReadWorld({ backend });
  const world = opened.world;
  worlds.push(world);
  const { goal, line } = opened;
  const tasks = opened.tools.tasks;
  const running = tasks[1]!;
  const anchor = { kind: 'goal' as const, goalId: goal.goalId };
  const pointer = await world.platform.notes.listByAnchor(world.humanContext(), { anchor, limit: 1, cursor: null });
  if (pointer.status !== 'ready' || pointer.value.pointer === null) {
    throw new Error(`${label}: the understanding pointer is not readable: ${JSON.stringify(pointer)}`);
  }
  const current = pointer.value.pointer;
  const draft = understandingNote({ anchor, topic: `${label}-understanding`,
    conclusion: `${label}: the source Run understands both tasks`, structural: false,
    replaces: current.noteId === null ? [] : [current.noteId] });
  if (draft.kind !== 'understanding') throw new Error(`${label}: the note is not an understanding`);
  await world.scripted.script(line, [
    { kind: 'calls', calls: [{ callId: `${label}-note`, name: 'record_note', args: { op: 'write', kind: draft.kind,
      topic: draft.topic, conclusion: draft.conclusion, anchor: draft.anchor, sections: draft.sections,
      structural: draft.structural, replaces: draft.replaces, expectedPointerRevision: current.revision } }] },
    { kind: 'calls', calls: [{ callId: `${label}-handoff`, name: 'hand_off', args: {
      source: { projectId: line.ref.projectId, sessionId: line.ref.sessionId },
      assignments: [{ target: { kind: 'create', duty: 'executor' }, tasks: tasks.map(task => ({ ...task })) }],
      reason: `${label}: hand both tasks to a new executor line` } }] },
    { kind: 'text', text: `${label}: the source Run ends after the handoff` },
  ]);
  const toolGate = await world.gates.toolCall(line, 'hand_off');
  const receipts: WorkflowStepReceipt[] = [];
  const driving = (async () => {
    const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: `${label}-source`,
      sessionHint: line.ref, kind: 'select_work', taskId: running.taskId }, 'claim_task');
    return await driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks', receipts });
  })();
  await toolGate.reached;
  const after = await world.gates.modelRequest(line);
  toolGate.release();
  const request = await after.reached;
  const tool = request.messages.find(message => message.role === 'tool' && message.callId === `${label}-handoff`);
  const accepted = (tool as { result?: { output?: { value?: unknown }[] } } | undefined)?.result?.output
    ?.map(entry => entry.value)
    .find((value): value is { status: string; operation: OperationRef } =>
      typeof value === 'object' && value !== null && 'operation' in value);
  if (accepted === undefined) throw new Error(`${label}: hand_off returned no operation: ${JSON.stringify(tool)}`);
  expect(accepted.status).toBe('accepted');
  return { opened, world, tasks, operation: accepted.operation,
    endSource: async () => { after.release(); await driving; } };
}

/** The Host lifecycle pass's call for this operation; its own answer (a wait, a refusal) is not the row's subject. */
async function lifecyclePass(scene: HandoffScene): Promise<unknown> {
  return await scene.world.platform.workflow.sessionHandoff.continueHandoff(scene.world.systemContext(),
    { operation: scene.operation });
}

async function readOperation(scene: HandoffScene): Promise<HandoffRead> {
  return ready<HandoffRead>(await scene.world.post('sessions/operation', plain(S6A_SCOPE, scene.operation)),
    'the handoff operation');
}

async function sessionCardOf(world: S6AHostWorld, session: SessionRef): Promise<SessionCard> {
  return ready<SessionCard>(await world.post('sessions/read', plain(S6A_SCOPE, session)), 'sessions/read');
}

const answersFor = (card: SessionCard, task: TaskTriple): boolean => card.links.some(link =>
  link.ref.relation === 'responsible' && link.until === null && link.ref.target.kind === 'task'
  && link.ref.target.ref.taskId === task.taskId);

/** Host lifecycle passes (at most 12) until the successor answers for every handed Task; returns the successor. */
async function passUntilTransferred(scene: HandoffScene, what: string): Promise<SessionRef> {
  for (let pass = 0; pass < 12; pass += 1) {
    await lifecyclePass(scene);
    const successor = (await readOperation(scene)).action.progress.assignments[0]?.successor ?? null;
    if (successor === null) continue;
    const card = await sessionCardOf(scene.world, successor);
    if (scene.tasks.every(task => answersFor(card, task))) return { projectId: successor.projectId, sessionId: successor.sessionId };
  }
  const read = await readOperation(scene);
  throw new Error(`${what}: the task transfer did not finish after 12 Host passes: ${JSON.stringify(read.action.progress)}`);
}

/** The successor's prepared manifest, opened from the start perform's prepared envelope. */
async function startManifestOf(world: S6AHostWorld, start: WorkflowAdvanceInput): Promise<PreparedTaskManifestV1> {
  if (start.kind !== 'perform' || start.operation.kind !== 'start') throw new Error('the next step is not a start');
  const prepared = (start.operation.request as unknown as { prepared: { envelope: { bundleRef: unknown } } }).prepared;
  const material = ready<{ body: string }>(await world.post('materials/open', plain(S6A_SCOPE, {
    ref: prepared.envelope.bundleRef, usage: 'historical_explanation' })), 'materials/open');
  return JSON.parse(material.body) as PreparedTaskManifestV1;
}

function lastClaimLineOf(receipts: readonly WorkflowStepReceipt[]): SessionRef {
  const claim = [...receipts].reverse().find(receipt => receipt.kind === 'claim_task');
  if (claim === undefined || claim.result.status !== 'committed') {
    throw new Error(`no committed claim: ${JSON.stringify(receipts.map(receipt => receipt.kind))}`);
  }
  return { projectId: claim.result.value.sessionRef.projectId, sessionId: claim.result.value.sessionRef.sessionId };
}

/**
 * The successor takes the brief's Tasks: Task 1 (never run) is its first Run and its manifest carries the brief with
 * both Tasks; after that Run, the source Run's Task 2 fails its round, is requeued and is claimed on the successor,
 * whose next manifest carries no brief (the first Run consumed it).
 */
async function successorTakesTheBrief(scene: HandoffScene, successor: SessionRef, label: string): Promise<void> {
  const { world, tasks } = scene;
  const goal = scene.opened.goal;
  const card = await sessionCardOf(world, successor);
  const line: S6ASession = { label: `${label}-successor`, ref: successor, aggregateRef: card.record.ref,
    role: card.record.role, createdAt: card.record.createdAt };
  await world.scripted.script(line, [
    { kind: 'text', text: `${label}: the successor's first Run answers` },
    { kind: 'text', text: `${label}: the successor's second Run answers` },
  ]);
  const selectTask = (flowId: string, task: TaskTriple): WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef: goal,
    flowId, sessionHint: null, kind: 'select_work', taskId: task.taskId });

  const firstReceipts: WorkflowStepReceipt[] = [];
  const firstSteps = await driveWorkflow(world.ag2b, selectTask(`${label}-successor-1`, tasks[0]!),
    { stopBefore: 'start', receipts: firstReceipts });
  expect(lastClaimLineOf(firstReceipts)).toEqual(successor);
  const firstStart = firstSteps.at(-1)?.next;
  if (firstStart === null || firstStart === undefined) throw new Error(`${label}: the successor's first Run has no start`);
  const first = await startManifestOf(world, firstStart);
  expect(first.handoffBrief?.binding.successor).toEqual(successor);
  const material = first.handoffBrief?.material;
  if (material?.duty !== 'executor') throw new Error(`${label}: the first manifest carries no executor brief`);
  expect(new Set(material.tasks.map(entry => entry.task.taskId))).toEqual(new Set(tasks.map(task => task.taskId)));
  await driveWorkflow(world.ag2b, firstStart, { stopBefore: 'open_checks' });

  const secondReceipts: WorkflowStepReceipt[] = [];
  const secondSteps = await driveWorkflow(world.ag2b, selectTask(`${label}-successor-2`, tasks[1]!),
    { stopBefore: 'start', receipts: secondReceipts });
  expect(lastClaimLineOf(secondReceipts)).toEqual(successor);
  const secondStart = secondSteps.at(-1)?.next;
  if (secondStart === null || secondStart === undefined) throw new Error(`${label}: Task 2 has no start on the successor`);
  expect((await startManifestOf(world, secondStart)).handoffBrief).toBeUndefined();
}

describe('G2: the handoff transfer finishes after the source Work Run', () => {
  it('G2-1: a handoff accepted while the source Work Run runs transfers both Tasks once that Run ends; the successor '
    + 'takes the brief\'s Tasks and consumes the brief', async () => {
    const scene = await handOffWhileRunning('p6g-g2-1');
    const source = scene.opened.line.ref;
    // The Host's pass while the source Work Run is still running: the source keeps both Tasks.
    await lifecyclePass(scene);
    const during = await sessionCardOf(scene.world, source);
    expect(scene.tasks.map(task => answersFor(during, task))).toEqual([true, true]);

    await scene.endSource();
    const successor = await passUntilTransferred(scene, 'G2-1');
    const after = await sessionCardOf(scene.world, source);
    expect(scene.tasks.map(task => answersFor(after, task))).toEqual([false, false]);
    await successorTakesTheBrief(scene, successor, 'p6g-g2-1');
  }, 240_000);

  // A version conflict is a storage row (RULES S3): memory and SQLite.
  it.each(['memory', 'sqlite'] as const)('G2-2 (%s): a version conflict met by the transfer is read again and retried; '
    + 'the transfer still finishes', async backend => {
    const scene = await handOffWhileRunning('p6g-g2-2', backend);
    await scene.endSource();
    // The first transfer commit is held after its pins were saved; a person's real link on the new line moves the
    // successor's revision past the saved pin, so the held commit meets a version conflict when it is released.
    const hold = commitBarrier.hold(byIdentityPrefix('session-responsibility-transfer:'), 'the first transfer commit');
    const passing = lifecyclePass(scene);
    await hold.reached;
    const saved = (await readOperation(scene)).action.progress.assignments[0]!;
    const successor = saved.successor;
    const pinned = saved.transfers[0]?.input?.expected.toSession;
    if (successor === null || pinned === undefined) throw new Error(`G2-2: no saved transfer pins: ${JSON.stringify(saved)}`);
    const card = await sessionCardOf(scene.world, successor);
    const goalTarget = { kind: 'goal' as const, ref: scene.opened.goal };
    committed(await scene.world.post('sessions/link', graphWrite(S6A_SCOPE, {
      sessionRef: successor, target: goalTarget, relation: 'participates', active: true,
    }, 'p6g-g2-2-conflict', [
      { ref: card.record.ref, revision: card.record.revision },
      { ref: { ...successor, aggregateType: 'SessionWorkLink', target: goalTarget, relation: 'participates' }, revision: 0 },
    ])), 'the person\'s link on the new line');
    expect((await sessionCardOf(scene.world, successor)).record.revision).toBeGreaterThan(pinned);
    hold.release();
    await passing;

    expect(await passUntilTransferred(scene, 'G2-2')).toEqual({ projectId: successor.projectId,
      sessionId: successor.sessionId });
    await successorTakesTheBrief(scene, successor, 'p6g-g2-2');
  }, 240_000);
});
