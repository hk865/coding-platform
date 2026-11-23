/**
 * P2 T6 (frozen `p2-frozen.md` §5 row T6, §2.5; lead 11-21 F1): a dispatch to a Task whose
 * module-overlap gate does not exist yet. The target loop opens the gate and asks for the
 * module note; after the note is satisfied the Task is claimed exactly once. With no line the
 * request neither fails nor answers `no_line`; a qualified line that appears later is claimed
 * once. A qualified preferred line goes first; an unqualified preferred line waits for nothing.
 *
 * The world is the existing S7C module world (`openS7C1World`): m1 runs in `s6a-core` (held at
 * its real model request) and m2 declares the same module, so m2's gate does not exist until the
 * selection reaches it. The dispatch is the scripted model's `dispatch_task` call in a real
 * secretary request round (`holdS6BRequestRound`); the gate and its note are read through
 * `goals/overlap-gates` and `messages/read`, the note is a person's real `notes/write`, and the
 * claim is the Workflow's own `workflow/advance`. 红-setup：G3 的
 * `buildStageTwo`/`readRunningCommands` 装配（`src/app/core-routes.ts:1301`）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { toolResultOf } from '../helpers/P2-tool-result.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { holdS6BRequestRound, createS6BLine } from '../helpers/S6B1-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { openS7C1World, S7C1_CREATE_ROLE, type S7C1World } from '../helpers/S7C-member-fixture.js';

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

const LONG = 600_000;
const CORE = 's6a-core';

type Line = Awaited<ReturnType<typeof createS6BLine>>;

/** The scripted model's one `dispatch_task` call in a real secretary request round; its tool result. */
async function dispatchCall(target: S7C1World, label: string,
  args: Record<string, unknown>): Promise<unknown> {
  const callId = `p2-${label}-dispatch`;
  const held = await holdS6BRequestRound(target.world, { label, goalId: target.goal.goalId,
    replies: () => [
      { kind: 'calls', calls: [{ callId, name: 'dispatch_task', args }] },
      { kind: 'text', text: `P2 ${label} after dispatch` },
    ] }, async inner => inner.secretary);
  return toolResultOf(await target.world.scripted.requests(held.value), callId);
}

/** The gate's public record and its one sent note request. */
async function openedGate(target: S7C1World, taskId: string): Promise<ModuleOverlapGateV1> {
  const page = valueOf<{ gates: ModuleOverlapGateV1[]; nextCursor: string | null }>(
    (await target.world.post('goals/overlap-gates', plain(S6A_SCOPE, {
      goalRef: target.goal, page: { limit: 10 },
    }))).body, 'ready', 'the T6 overlap gates');
  const gate = page.gates.find(entry => entry.ref.taskId === taskId);
  if (gate === undefined) throw new Error(`T6: the module gate of ${taskId} is not among ${JSON.stringify(page.gates)}`);
  return gate;
}

/**
 * Drives the target loop through the gate open + note request and checks the frozen gate facts: the gate
 * opened, it asked for the module note, and nothing was claimed before that note exists.
 */
async function openGateAndNote(target: S7C1World, label: string, taskId: string): Promise<void> {
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(target.world.ag2b, ({ schemaVersion: 1, goalRef: target.goal,
    flowId: `p2-t6-${label}-gate`, sessionHint: null, kind: 'select_work' } satisfies WorkflowAdvanceInput),
  { stopBefore: operation => operation.kind === 'host_pick_member', receipts });
  expect(receipts.find(receipt => receipt.kind === 'open_overlap_gate'),
    'T6: the target loop opens the module gate and writes the note request').toMatchObject({
      kind: 'open_overlap_gate', result: { status: 'opened', noteRequest: 'sent' },
    });
  // The rule is about the GATED Task: a module-gate-blocked candidate is skipped at Goal scope and the other Tasks
  // carry on (workflow.ts's L46/gate `skip`), so the non-overlapping `s7c-n1` may be claimed while this Task waits.
  const gatedClaims = receipts.filter(receipt => receipt.kind === 'claim_task'
    && receipt.result.status === 'committed' && receipt.result.value.task.taskId === taskId);
  expect(gatedClaims, 'T6: nothing is claimed before the note is satisfied').toHaveLength(0);
  // The public effect, not just the receipts: the Task still has no Run while its gate waits for the note.
  const graph = valueOf<{ tasks: Array<{ ref: { taskId: string }; execution: unknown }> }>(
    (await target.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: target.goal }))).body, 'ready',
    'the T6 task graph');
  expect(graph.tasks.find(entry => entry.ref.taskId === taskId)?.execution ?? null,
    'T6: the Task has no Run before the note is satisfied').toBeNull();
  const gate = await openedGate(target, taskId);
  expect(gate).toMatchObject({ moduleId: CORE, ref: { taskId } });
  expect(gate.noteRequest, 'T6: the gate records the one note request').toMatchObject({
    messageRef: expect.objectContaining({ aggregateType: 'SessionMessage' }),
  });
  const noteRef = gate.noteRequest?.messageRef;
  if (noteRef === undefined) throw new Error(`T6: the opened gate has no note message: ${JSON.stringify(gate)}`);
  // The stored message record carries no text: the note's body is the message part of `messages/body`.
  const note = valueOf<{ text: string }>((await target.world.post('messages/body',
    plain(S6A_SCOPE, { messageRef: noteRef, part: 'message' }))).body, 'ready', 'the T6 overlap note request');
  expect(note.text, 'T6: the note request names the module').toContain(CORE);
}

/** The person's real accepted note on the module: `notes/write` at the Goal, no pointer revision. */
async function writeModuleNote(target: S7C1World, label: string): Promise<void> {
  const answer = await target.world.post('notes/write', plain(S6A_SCOPE, {
    commandId: `p2-t6-${label}-note`, goalId: target.goal.goalId, expectedPointerRevision: null,
    note: { kind: 'convention', topic: `p2-t6-${label}`, conclusion: `P2 T6 ${label} module note`,
      anchor: { kind: 'module', moduleId: CORE }, extraAnchors: [], facts: [], basisFiles: [],
      structural: false, replaces: [], contradicts: [], coexistWith: [], body: `P2 T6 ${label} note body` },
  }));
  expect(answer.body, 'T6: the person note on the module is accepted').toMatchObject({
    write: { status: 'accepted' },
  });
}

/** A fresh idle executor line responsible for the module Task. */
async function lineFor(target: S7C1World, label: string): Promise<Line> {
  return await createS6BLine(target.main, {
    label: `p2-t6-${label}-line`, role: S7C1_CREATE_ROLE, tasks: [target.tasks[1]!],
  });
}

/** Drives the target loop to the one claim (stopping before the Run start) and answers the claims. */
async function claimStep(target: S7C1World, label: string): Promise<WorkflowStepReceipt[]> {
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(target.world.ag2b, ({ schemaVersion: 1, goalRef: target.goal,
    flowId: `p2-t6-${label}-claim`, sessionHint: null, kind: 'select_work' } satisfies WorkflowAdvanceInput),
  { stopBefore: 'start', receipts });
  return receipts.filter(receipt => receipt.kind === 'claim_task');
}

function claimedSession(receipts: readonly WorkflowStepReceipt[]): SessionRef {
  const claim = receipts[0];
  if (receipts.length !== 1 || claim === undefined || claim.kind !== 'claim_task'
    || claim.result.status !== 'committed') {
    throw new Error(`T6: the Task was not claimed exactly once: ${JSON.stringify(receipts)}`);
  }
  return claim.result.value.sessionRef;
}

describe('P2 T6: dispatch into a module-overlap gate', () => {
  it('no qualified line: the request stays open, the gate asks for the note, and a later line claims once', async () => {
    const target = await openS7C1World({ firstRun: 'held' });
    world = target;
    const task = target.tasks[1]!;

    const dispatched = await dispatchCall(target, 'no-line',
      { taskRef: task, reason: 'P2 T6 no qualified line' });
    // Frozen §2.5/§5: with no eligible line the request is accepted and kept; it never answers `no_line`.
    expect(dispatched, 'T6: a dispatch with no qualified line is accepted').toMatchObject({ status: 'requested' });
    expect(dispatched, 'T6: no qualified line never produces no_line').not.toMatchObject({ status: 'no_line' });

    await openGateAndNote(target, 'no-line', task.taskId);
    await writeModuleNote(target, 'no-line');
    const line = await lineFor(target, 'no-line');
    const claims = await claimStep(target, 'no-line');
    expect(claimedSession(claims), 'T6: the qualified line that appeared later claims once')
      .toMatchObject({ sessionId: line.ref.sessionId });
  }, LONG);

  it('a qualified preferred line is claimed first', async () => {
    const target = await openS7C1World({ firstRun: 'held' });
    world = target;
    const task = target.tasks[1]!;
    const first = await lineFor(target, 'qualified-first');
    const preferred = await lineFor(target, 'qualified-preferred');

    const dispatched = await dispatchCall(target, 'qualified-preferred',
      { taskRef: task, reason: 'P2 T6 qualified preferred', preferredLine: preferred.ref });
    expect(dispatched, 'T6: a dispatch naming a qualified preferred line is accepted')
      .toMatchObject({ status: 'requested' });

    await openGateAndNote(target, 'qualified-preferred', task.taskId);
    await writeModuleNote(target, 'qualified-preferred');
    const claims = await claimStep(target, 'qualified-preferred');
    expect(claimedSession(claims), 'T6: the qualified preferred line is first').toMatchObject({
      sessionId: preferred.ref.sessionId,
    });
    expect(claimedSession(claims).sessionId, 'T6: the other qualified line is not claimed')
      .not.toBe(first.ref.sessionId);
  }, LONG);

  it('an unqualified preferred line does not block or wait: a later qualified line claims', async () => {
    const target = await openS7C1World({ firstRun: 'held' });
    world = target;
    const task = target.tasks[1]!;
    // m1's line holds m2's responsible link but is occupied by the running m1 Run, so it is not eligible.
    const busyPreferred = target.lines.module;

    const dispatched = await dispatchCall(target, 'unqualified-preferred',
      { taskRef: task, reason: 'P2 T6 unqualified preferred', preferredLine: busyPreferred.ref });
    expect(dispatched, 'T6: an unqualified preferred line does not fail the dispatch')
      .toMatchObject({ status: 'requested' });

    await openGateAndNote(target, 'unqualified-preferred', task.taskId);
    await writeModuleNote(target, 'unqualified-preferred');
    const line = await lineFor(target, 'unqualified-preferred');
    const claims = await claimStep(target, 'unqualified-preferred');
    expect(claimedSession(claims), 'T6: a later qualified line claims without waiting for the preferred one')
      .toMatchObject({ sessionId: line.ref.sessionId });
  }, LONG);
});
