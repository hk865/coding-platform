/**
 * P.5/P.6 (7a:242–:245, :729): the claim chain carries the acknowledgement — shape-checked input, present-only in
 * the fingerprint and the `TaskClaimed` event, and the committed result carries the formal `proofReceipt` of its
 * own commit on the first success and every replay. An old call without one keeps exactly its four keys, and after
 * a Host restart the same acknowledged request replays the full receipt (memory has no restart, so SQLite only).
 * Every prior state comes from the frozen fixture's public steps; the store is never read.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EffectWriteResultV1, SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { ReverifyOutcomeV1 } from '../../src/core/work-graph/model/evidence-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import {
  AG2B_RESULT_FILE, AG2B_RESULT_TEXT, ag2bChecksConfiguration, ag2bPlanDraft, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { advanceUntil, post } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { callS7A2PublishedOwner, claimRequestS7A2, sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { openS7AWorkWorld } from '../helpers/S7A-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

type ClaimWrite = EffectWriteResultV1<TaskClaim>;

/** One claim world: two real person messages and the Workflow's own unperformed claim of the line's second Task. */
async function openClaimRow(backend: 'memory' | 'sqlite') {
  const opened = await openS7AWorkWorld({ backend });
  worlds.push(opened.world);
  const first = await sendS7A2PersonMessage(opened.world, { label: 'ack-first', recipient: opened.line.ref });
  const other = await sendS7A2PersonMessage(opened.world, { label: 'ack-other', recipient: opened.line.ref });
  const request = await claimRequestS7A2(opened.world, { goal: opened.goal, line: opened.line, label: 'ack' });
  return { ...opened, request, first: first.ref, other: other.ref };
}

function withAcknowledgement(request: GraphWrite<ClaimTaskInput>, acknowledgement: SessionMessageRef):
GraphWrite<ClaimTaskInput> {
  return { ...request, input: { ...request.input, acknowledgement } };
}

function claim(world: S6AHostWorld, request: GraphWrite<ClaimTaskInput>): Promise<ClaimWrite> {
  return callS7A2PublishedOwner(world,
    { owner: 'claims.claimTask', wave: '7a2e-p', scope: S6A_SCOPE }, request) as Promise<ClaimWrite>;
}

describe('P-effect-acks: the claim row', () => {
  it('an acknowledged claim commits with the receipt of its own commit (memory)', async () => {
    const row = await openClaimRow('memory');
    const written = await claim(row.world, withAcknowledgement(row.request, row.first));
    expect(written).toMatchObject({ status: 'committed', replayed: false });
    if (written.status !== 'committed') return;
    const receipt = written.proofReceipt;
    expect(receipt).toEqual({ identityKey: expect.any(String), fingerprint: expect.any(String), cursor: written.cursor });
    expect(receipt?.identityKey.length).toBeGreaterThan(0);
    expect(receipt?.fingerprint.length).toBeGreaterThan(0);
  });

  it('the same request with the other acknowledgement, or with none, is an idempotency_conflict (memory)', async () => {
    const row = await openClaimRow('memory');
    expect(await claim(row.world, withAcknowledgement(row.request, row.first)))
      .toMatchObject({ status: 'committed', replayed: false });
    expect(await claim(row.world, withAcknowledgement(row.request, row.other)))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await claim(row.world, row.request))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });

  it('an old call without an acknowledgement keeps exactly its four keys, on the first success and the replay (memory)', async () => {
    const row = await openClaimRow('memory');
    const first = await claim(row.world, row.request);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    expect(Object.keys(first).sort()).toEqual(['cursor', 'replayed', 'status', 'value']);
    expect(first).not.toHaveProperty('proofReceipt');
    const again = await claim(row.world, row.request);
    expect(again).toMatchObject({ status: 'committed', replayed: true });
    expect(Object.keys(again).sort()).toEqual(['cursor', 'replayed', 'status', 'value']);
    expect(again).not.toHaveProperty('proofReceipt');
  });

  describe.each(['memory', 'sqlite'] as const)('the acknowledged replay (%s)', backend => {
    it('the same acknowledged request is replayed and carries the same proofReceipt', async () => {
      const row = await openClaimRow(backend);
      const first = await claim(row.world, withAcknowledgement(row.request, row.first));
      expect(first).toMatchObject({ status: 'committed', replayed: false });
      if (first.status !== 'committed') return;
      const again = await claim(row.world, withAcknowledgement(row.request, row.first));
      expect(again).toMatchObject({ status: 'committed', replayed: true });
      if (again.status !== 'committed') return;
      expect(again.cursor).toEqual(first.cursor);
      expect(first.proofReceipt).toBeDefined();
      expect(again.proofReceipt).toBeDefined();
      expect(again.proofReceipt).toEqual(first.proofReceipt);
    });
  });

  it('a committed acknowledgement whose result was lost replays the full receipt after a restart (SQLite only)', async () => {
    const row = await openClaimRow('sqlite');
    // The claim commits; its result is not read, so this Host holds no receipt of it.
    await claim(row.world, withAcknowledgement(row.request, row.first));
    await row.world.crash();
    const replayed = await claim(row.world, withAcknowledgement(row.request, row.first));
    expect(replayed).toMatchObject({ status: 'committed', replayed: true });
    if (replayed.status !== 'committed') return;
    expect(replayed.proofReceipt).toEqual({ identityKey: expect.any(String), fingerprint: expect.any(String),
      cursor: replayed.cursor });
    expect(replayed.proofReceipt?.identityKey.length).toBeGreaterThan(0);
    expect(replayed.proofReceipt?.fingerprint.length).toBeGreaterThan(0);
    const twice = await claim(row.world, withAcknowledgement(row.request, row.first));
    expect(twice).toMatchObject({ status: 'committed', replayed: true, proofReceipt: replayed.proofReceipt });
  });
});

// ---------------------------------------------------------------------------
// P-late: the requeue, recheck, proposal and committed-refusal sub-rows.
// Each precondition is the row's own composition of public steps (R3-4);
// `world.post` answers `{ httpStatus, body }`, so `.body` is taken first and
// narrowed after (rulings 5 item 4b). D8-20 puts the four owners in one table.
// ---------------------------------------------------------------------------

const EFFECT_ROWS = [
  { effect: 'requeue', backend: 'memory' },
  { effect: 'requeue', backend: 'sqlite' },
  { effect: 'recheck', backend: 'memory' },
  { effect: 'recheck', backend: 'sqlite' },
  { effect: 'proposal', backend: 'memory' },
  { effect: 'proposal', backend: 'sqlite' },
  { effect: 'refusal', backend: 'memory' },
] as const;

describe('P-effect-acks: the four effect owners', () => {
  it.each(EFFECT_ROWS)('the $effect row commits and replays ($backend)', async ({ effect, backend }) => {
    if (effect === 'requeue') {
      const world = await openS6AHostWorld({ backend,
        extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR }) } });
      worlds.push(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, main, world.goals);
      const goal = (await main.createGoal('s7a2-ack-requeue-goal', 'S7A2 ack requeue goal')).ref;
      const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-ack-requeue',
        taskIds: ['s7a2-ack-requeue-1'], role: S6A_WORK_ROLE.templateId });
      const created = await createS6BLine(main, { label: 's7a2-ack-requeue-line', role: S6A_WORK_ROLE, tasks });
      const card = await world.readSession(created.ref);
      const line: S6ASession = { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
        role: structuredClone(card.record.role), createdAt: card.record.createdAt };
      await world.scripted.script(line, [{ kind: 'text', text: 'S7A2 ack requeue first Task' }]);
      const message = await sendS7A2PersonMessage(world, { label: 'ack-requeue', recipient: line.ref });
      const other = await sendS7A2PersonMessage(world, { label: 'ack-requeue-other', recipient: line.ref });
      const step = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-ack-requeue', sessionHint: line.ref, kind: 'select_work' as const }, 'requeue_task');
      if (step.kind !== 'perform' || step.operation.kind !== 'requeue_task') {
        throw new Error(`S7A2: the Workflow did not stop at requeue_task: ${step.kind}`);
      }
      const acknowledged = { ...step.operation.request,
        input: { ...step.operation.request.input, acknowledgement: message.ref } };
      const firstShell = await world.post('tasks/requeue', { scope: S6A_SCOPE, request: acknowledged });
      expect(firstShell.httpStatus).toBe(200);
      const first = firstShell.body as EffectWriteResultV1<TaskRequeueOutcomeV1>;
      expect(first).toMatchObject({ status: 'committed', replayed: false });
      if (first.status !== 'committed') throw new Error(`the acknowledged requeue is ${first.code}`);
      expect(Object.keys(first).sort()).toEqual(['cursor', 'proofReceipt', 'replayed', 'status', 'value']);
      expect(first.proofReceipt).toEqual({ identityKey: expect.any(String), fingerprint: expect.any(String),
        cursor: first.cursor });
      const replayShell = await world.post('tasks/requeue', { scope: S6A_SCOPE, request: acknowledged });
      expect(replayShell.httpStatus).toBe(200);
      const replay = replayShell.body as EffectWriteResultV1<TaskRequeueOutcomeV1>;
      expect(replay).toMatchObject({ status: 'committed', replayed: true });
      if (replay.status !== 'committed') throw new Error(`the replayed requeue is ${replay.code}`);
      expect(replay.proofReceipt).toEqual(first.proofReceipt);
      const otherShell = await world.post('tasks/requeue', { scope: S6A_SCOPE, request: {
        ...acknowledged, input: { ...acknowledged.input, acknowledgement: other.ref } } });
      expect(otherShell.body).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      // An old call without the key keeps the four-key result: a fresh FAILing first Task, the same public steps.
      const oldWorld = await openS6AHostWorld({ backend,
        extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR }) } });
      worlds.push(oldWorld);
      const oldMain = s6aCardsWorkspace(oldWorld, S6A_SCOPE);
      await governS6B(oldWorld, oldMain, oldWorld.goals);
      const oldGoal = (await oldMain.createGoal('s7a2-ack-requeue-old-goal', 'S7A2 old requeue goal')).ref;
      const oldPlan = await adoptS6BPlan(oldMain, oldGoal, { label: 's7a2-ack-requeue-old',
        taskIds: ['s7a2-ack-requeue-old-1'], role: S6A_WORK_ROLE.templateId });
      const oldCreated = await createS6BLine(oldMain, { label: 's7a2-ack-requeue-old-line',
        role: S6A_WORK_ROLE, tasks: oldPlan.tasks });
      const oldCard = await oldWorld.readSession(oldCreated.ref);
      const oldLine: S6ASession = { label: oldCreated.label, ref: oldCreated.ref, aggregateRef: oldCard.record.ref,
        role: structuredClone(oldCard.record.role), createdAt: oldCard.record.createdAt };
      await oldWorld.scripted.script(oldLine, [{ kind: 'text', text: 'S7A2 old requeue first Task' }]);
      const oldStep = await advanceUntil(oldWorld.ag2b, { schemaVersion: 1 as const, goalRef: oldGoal,
        flowId: 's7a2-ack-requeue-old', sessionHint: oldLine.ref, kind: 'select_work' as const }, 'requeue_task');
      if (oldStep.kind !== 'perform' || oldStep.operation.kind !== 'requeue_task') {
        throw new Error(`S7A2: the old Workflow did not stop at requeue_task: ${oldStep.kind}`);
      }
      const oldShell = await oldWorld.post('tasks/requeue', { scope: S6A_SCOPE, request: oldStep.operation.request });
      expect(oldShell.body).toMatchObject({ status: 'committed', replayed: false });
      expect(Object.keys(oldShell.body as object).sort()).toEqual(['cursor', 'replayed', 'status', 'value']);
      return;
    }
    if (effect === 'recheck') {
      const world = await openS6AHostWorld({ backend,
        extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR }) } });
      worlds.push(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, main, world.goals);
      const goal = (await main.createGoal('s7a2-ack-reverify-goal', 'S7A2 ack recheck goal')).ref;
      const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-ack-reverify',
        taskIds: ['s7a2-ack-reverify-1'], role: S6A_WORK_ROLE.templateId });
      const created = await createS6BLine(main, { label: 's7a2-ack-reverify-line', role: S6A_WORK_ROLE, tasks });
      const card = await world.readSession(created.ref);
      const line: S6ASession = { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
        role: structuredClone(card.record.role), createdAt: card.record.createdAt };
      await world.scripted.script(line, [
        { kind: 'calls', calls: [{ callId: 's7a2-ack-result', name: 'edit', args: { mode: 'create',
          path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
        { kind: 'text', text: 'S7A2 ack recheck: the work is done' }]);
      const message = await sendS7A2PersonMessage(world, { label: 'ack-reverify', recipient: line.ref });
      const other = await sendS7A2PersonMessage(world, { label: 'ack-reverify-other', recipient: line.ref });
      // A2 `:199`: stop before the check runs, then change the source the round froze.
      const runCheck = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-ack-reverify', sessionHint: line.ref, kind: 'select_work' as const,
        taskId: tasks[0]!.taskId }, 'run_check');
      await writeFile(join(world.ag2b.root, 'src', 'module.ts'),
        'export const ag2bMarker = "S7A2_SOURCE_CHANGED_AFTER_OPEN";\n');
      const checked = await post<WorkflowAdvanceResult>(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, runCheck));
      if (checked.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(checked)}`);
      if (checked.value.next === null) throw new Error('the Workflow must finalize');
      const finalizeCall = await post<WorkflowAdvanceResult>(world.ag2b, 'workflow/advance',
        plain(S6A_SCOPE, checked.value.next));
      if (finalizeCall.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(finalizeCall)}`);
      const finalized = finalizeCall.value;
      expect(finalized).toMatchObject({ state: 'advance', next: { kind: 'select_work' },
        receipt: { kind: 'finalize_checks', result: { status: 'committed', value: { outcome: 'INCONCLUSIVE' } } } });
      const reverifyStep = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
        flowId: 's7a2-ack-reverify-2', sessionHint: line.ref, kind: 'select_work' as const,
        taskId: tasks[0]!.taskId }, 'reverify_round');
      if (reverifyStep.kind !== 'perform' || reverifyStep.operation.kind !== 'reverify_round') {
        throw new Error(`S7A2: the Workflow did not stop at reverify_round: ${reverifyStep.kind}`);
      }
      const acknowledged = { ...reverifyStep.operation.request,
        input: { ...reverifyStep.operation.request.input, acknowledgement: message.ref } };
      const firstShell = await world.post('verification/reverify', { scope: S6A_SCOPE, request: acknowledged });
      expect(firstShell.httpStatus).toBe(200);
      const first = firstShell.body as EffectWriteResultV1<ReverifyOutcomeV1>;
      expect(first).toMatchObject({ status: 'committed', replayed: false });
      if (first.status !== 'committed') throw new Error(`the acknowledged recheck is ${first.code}`);
      expect(Object.keys(first).sort()).toEqual(['cursor', 'proofReceipt', 'replayed', 'status', 'value']);
      expect(first.proofReceipt).toEqual({ identityKey: expect.any(String), fingerprint: expect.any(String),
        cursor: first.cursor });
      const replayShell = await world.post('verification/reverify', { scope: S6A_SCOPE, request: acknowledged });
      expect(replayShell.httpStatus).toBe(200);
      const replay = replayShell.body as EffectWriteResultV1<ReverifyOutcomeV1>;
      expect(replay).toMatchObject({ status: 'committed', replayed: true });
      if (replay.status !== 'committed') throw new Error(`the replayed recheck is ${replay.code}`);
      expect(replay.proofReceipt).toEqual(first.proofReceipt);
      const otherShell = await world.post('verification/reverify', { scope: S6A_SCOPE, request: {
        ...acknowledged, input: { ...acknowledged.input, acknowledgement: other.ref } } });
      expect(otherShell.body).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      // An old call without the key keeps the four-key result: a fresh INCONCLUSIVE round, the same public steps.
      const oldWorld = await openS6AHostWorld({ backend,
        extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR }) } });
      worlds.push(oldWorld);
      const oldMain = s6aCardsWorkspace(oldWorld, S6A_SCOPE);
      await governS6B(oldWorld, oldMain, oldWorld.goals);
      const oldGoal = (await oldMain.createGoal('s7a2-ack-reverify-old-goal', 'S7A2 old recheck goal')).ref;
      const oldPlan = await adoptS6BPlan(oldMain, oldGoal, { label: 's7a2-ack-reverify-old',
        taskIds: ['s7a2-ack-reverify-old-1'], role: S6A_WORK_ROLE.templateId });
      const oldCreated = await createS6BLine(oldMain, { label: 's7a2-ack-reverify-old-line',
        role: S6A_WORK_ROLE, tasks: oldPlan.tasks });
      const oldCard = await oldWorld.readSession(oldCreated.ref);
      const oldLine: S6ASession = { label: oldCreated.label, ref: oldCreated.ref, aggregateRef: oldCard.record.ref,
        role: structuredClone(oldCard.record.role), createdAt: oldCard.record.createdAt };
      await oldWorld.scripted.script(oldLine, [
        { kind: 'calls', calls: [{ callId: 's7a2-ack-old-result', name: 'edit', args: { mode: 'create',
          path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
        { kind: 'text', text: 'S7A2 old recheck: the work is done' }]);
      const oldRunCheck = await advanceUntil(oldWorld.ag2b, { schemaVersion: 1 as const, goalRef: oldGoal,
        flowId: 's7a2-ack-reverify-old', sessionHint: oldLine.ref, kind: 'select_work' as const,
        taskId: oldPlan.tasks[0]!.taskId }, 'run_check');
      await writeFile(join(oldWorld.ag2b.root, 'src', 'module.ts'),
        'export const ag2bMarker = "S7A2_OLD_SOURCE_CHANGED_AFTER_OPEN";\n');
      const oldChecked = await post<WorkflowAdvanceResult>(oldWorld.ag2b, 'workflow/advance',
        plain(S6A_SCOPE, oldRunCheck));
      if (oldChecked.status !== 'ready') throw new Error(`the old Workflow call was not ready: ${JSON.stringify(oldChecked)}`);
      if (oldChecked.value.next === null) throw new Error('the old Workflow must finalize');
      const oldFinalize = await post<WorkflowAdvanceResult>(oldWorld.ag2b, 'workflow/advance',
        plain(S6A_SCOPE, oldChecked.value.next));
      if (oldFinalize.status !== 'ready') throw new Error(`the old Workflow call was not ready: ${JSON.stringify(oldFinalize)}`);
      const oldStep = await advanceUntil(oldWorld.ag2b, { schemaVersion: 1 as const, goalRef: oldGoal,
        flowId: 's7a2-ack-reverify-old-2', sessionHint: oldLine.ref, kind: 'select_work' as const,
        taskId: oldPlan.tasks[0]!.taskId }, 'reverify_round');
      if (oldStep.kind !== 'perform' || oldStep.operation.kind !== 'reverify_round') {
        throw new Error(`S7A2: the old Workflow did not stop at reverify_round: ${oldStep.kind}`);
      }
      const oldShell = await oldWorld.post('verification/reverify', { scope: S6A_SCOPE,
        request: oldStep.operation.request });
      expect(oldShell.body).toMatchObject({ status: 'committed', replayed: false });
      expect(Object.keys(oldShell.body as object).sort()).toEqual(['cursor', 'replayed', 'status', 'value']);
      return;
    }
    if (effect === 'proposal') {
      const world = await openS6AHostWorld({ backend });
      worlds.push(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, main, world.goals);
      const goal = (await main.createGoal('s7a2-ack-propose-goal', 'S7A2 ack proposal goal')).ref;
      const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-ack-propose',
        taskIds: ['s7a2-ack-propose-1'], role: S6A_WORK_ROLE.templateId });
      const created = await createS6BLine(main, { label: 's7a2-ack-propose-line', role: S6A_WORK_ROLE, tasks });
      const current = await main.activePlan(goal);
      if (current === null) throw new Error('S7A2_PRECONDITION: the Goal has no adopted Plan to move from');
      const workIds = current.tasks.filter(task => task.taskKind === 'work').map(task => task.taskId);
      const draft = { ...ag2bPlanDraft(workIds), planId: 's7a2-ack-plan', goalId: goal.goalId,
        planRevision: current.planRevision + 1 };
      const message = await sendS7A2PersonMessage(world, { label: 'ack-propose', recipient: created.ref });
      const request = graphWrite(S6A_SCOPE, { goalRef: goal, basedOn: current.ref, draft,
        reason: { text: 'S7A2 ack proposal', sources: [] }, acknowledgement: message.ref }, 's7a2-ack-propose-1', []);
      const firstShell = await world.post('plans/propose', request);
      expect(firstShell.httpStatus).toBe(200);
      const first = firstShell.body as WriteResult<PlanProposal>;
      expect(first).toMatchObject({ status: 'committed', replayed: false });
      if (first.status !== 'committed') throw new Error(`the acknowledged proposal is ${first.code}`);
      expect(Object.keys(first).sort()).toEqual(['cursor', 'proofReceipt', 'replayed', 'status', 'value']);
      expect((first as { proofReceipt?: unknown }).proofReceipt).toEqual({ identityKey: expect.any(String),
        fingerprint: expect.any(String), cursor: first.cursor });
      const read = await world.post('plans/proposal', plain(S6A_SCOPE, first.value.ref));
      expect(read.body).toMatchObject({ status: 'ready', value: { ref: first.value.ref, status: 'candidate' } });
      const replayShell = await world.post('plans/propose', request);
      const replay = replayShell.body as WriteResult<PlanProposal>;
      expect(replay).toMatchObject({ status: 'committed', replayed: true });
      if (replay.status !== 'committed') throw new Error(`the replayed proposal is ${replay.code}`);
      expect((replay as { proofReceipt?: unknown }).proofReceipt)
        .toEqual((first as { proofReceipt?: unknown }).proofReceipt);
      const other = await sendS7A2PersonMessage(world, { label: 'ack-propose-other', recipient: created.ref });
      const conflictShell = await world.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: goal, basedOn: current.ref, draft, reason: { text: 'S7A2 ack proposal', sources: [] },
        acknowledgement: other.ref }, 's7a2-ack-propose-1', []));
      expect(conflictShell.body).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      const oldShell = await world.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: goal, basedOn: current.ref, draft, reason: { text: 'S7A2 ack proposal', sources: [] },
      }, 's7a2-ack-propose-old', []));
      expect(Object.keys(oldShell.body as object).sort()).toEqual(['cursor', 'replayed', 'status', 'value']);
      return;
    }
    const world = await openS6AHostWorld({ backend,
      extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR }) } });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, main, world.goals);
    const goal = (await main.createGoal('s7a2-ack-refusal-goal', 'S7A2 ack refusal goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-ack-refusal',
      taskIds: ['s7a2-ack-refusal-1'], role: S6A_WORK_ROLE.templateId });
    const created = await createS6BLine(main, { label: 's7a2-ack-refusal-line', role: S6A_WORK_ROLE, tasks });
    const card = await world.readSession(created.ref);
    const line: S6ASession = { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
      role: structuredClone(card.record.role), createdAt: card.record.createdAt };
    // A2 `:55–:57`: the answer is text only, so the registered check FAILs.
    await world.scripted.script(line, [{ kind: 'text', text: 'S7A2 ack refusal: an answer without the file' }]);
    const message = await sendS7A2PersonMessage(world, { label: 'ack-refusal', recipient: line.ref });
    const requeue = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
      flowId: 's7a2-ack-refusal', sessionHint: line.ref, kind: 'select_work' as const }, 'requeue_task');
    expect(requeue.kind).toBe('perform');
    if (requeue.kind !== 'perform') throw new Error('the drive did not stop at a perform');
    expect(requeue.operation.kind).toBe('requeue_task');
    // A2 `:65–:70`: the chain head pin comes from the Task row alone.
    const graphShell = await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal }));
    expect(graphShell.httpStatus).toBe(200);
    const graph = graphShell.body as
      { status: string; value?: { tasks: Array<{ ref: { taskId: string };
        failure: { round: { roundRef: unknown; revision: number; status: string; outcome: string; ordinal: number } | null }
          | null }> } };
    expect(graph.status).toBe('ready');
    const row = graph.value?.tasks.find(task => task.ref.taskId === tasks[0]!.taskId);
    if (row === undefined || row.failure === null || row.failure.round === null) {
      throw new Error('S7A2: the work Task has no failure round');
    }
    const head = row.failure.round;
    expect(head).toMatchObject({ status: 'finalized', outcome: 'FAIL', ordinal: 1 });
    const headPin = { ref: head.roundRef, revision: head.revision };
    const shell = await world.post('verification/reverify', graphWrite(S6A_SCOPE, {
      predecessorRoundRef: head.roundRef, onlyIfSourceChanged: true, acknowledgement: message.ref,
    }, 's7a2-ack-refusal-unchanged', [headPin]));
    expect(shell.httpStatus).toBe(200);
    const written = shell.body as EffectWriteResultV1<ReverifyOutcomeV1>;
    expect(written).toMatchObject({ status: 'committed', replayed: false, value: { kind: 'refused',
      refusal: { code: 'source_unchanged' } } });
    expect(written).not.toHaveProperty('proofReceipt');
  });
});

const LOST_ROWS = ['requeue', 'recheck', 'proposal'] as const;

describe('P-effect-acks: the committed-but-lost recovery', () => {
  it.each(LOST_ROWS)('a committed %s whose result was lost replays the full receipt after a restart (SQLite only)',
    async effect => {
      if (effect === 'requeue') {
        const world = await openS6AHostWorld({ backend: 'sqlite',
          extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR }) } });
        worlds.push(world);
        const main = s6aCardsWorkspace(world, S6A_SCOPE);
        await governS6B(world, main, world.goals);
        const goal = (await main.createGoal('s7a2-ack-requeue-lost-goal', 'S7A2 ack requeue lost goal')).ref;
        const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-ack-requeue-lost',
          taskIds: ['s7a2-ack-requeue-lost-1'], role: S6A_WORK_ROLE.templateId });
        const created = await createS6BLine(main, { label: 's7a2-ack-requeue-lost-line',
          role: S6A_WORK_ROLE, tasks });
        const card = await world.readSession(created.ref);
        const line: S6ASession = { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
          role: structuredClone(card.record.role), createdAt: card.record.createdAt };
        await world.scripted.script(line, [{ kind: 'text', text: 'S7A2 ack requeue lost first Task' }]);
        const message = await sendS7A2PersonMessage(world, { label: 'ack-requeue-lost', recipient: line.ref });
        const step = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
          flowId: 's7a2-ack-requeue-lost', sessionHint: line.ref, kind: 'select_work' as const }, 'requeue_task');
        if (step.kind !== 'perform' || step.operation.kind !== 'requeue_task') {
          throw new Error(`S7A2: the Workflow did not stop at requeue_task: ${step.kind}`);
        }
        const acknowledged = { ...step.operation.request,
          input: { ...step.operation.request.input, acknowledgement: message.ref } };
        // The requeue commits; its result is not read, so this Host holds no receipt of it.
        await world.post('tasks/requeue', { scope: S6A_SCOPE, request: acknowledged });
        await world.crash();
        const replayedShell = await world.post('tasks/requeue', { scope: S6A_SCOPE, request: acknowledged });
        expect(replayedShell.body).toMatchObject({ status: 'committed', replayed: true });
        const replayed = replayedShell.body as EffectWriteResultV1<TaskRequeueOutcomeV1>;
        if (replayed.status !== 'committed') throw new Error(`the replayed requeue is ${replayed.code}`);
        expect(replayed.proofReceipt).toEqual({ identityKey: expect.any(String), fingerprint: expect.any(String),
          cursor: replayed.cursor });
        expect(replayed.proofReceipt?.identityKey.length).toBeGreaterThan(0);
        expect(replayed.proofReceipt?.fingerprint.length).toBeGreaterThan(0);
        return;
      }
      if (effect === 'recheck') {
        const world = await openS6AHostWorld({ backend: 'sqlite',
          extraHostOptions: { checks: ag2bChecksConfiguration({ actor: OPERATOR }) } });
        worlds.push(world);
        const main = s6aCardsWorkspace(world, S6A_SCOPE);
        await governS6B(world, main, world.goals);
        const goal = (await main.createGoal('s7a2-ack-reverify-lost-goal', 'S7A2 ack recheck lost goal')).ref;
        const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-ack-reverify-lost',
          taskIds: ['s7a2-ack-reverify-lost-1'], role: S6A_WORK_ROLE.templateId });
        const created = await createS6BLine(main, { label: 's7a2-ack-reverify-lost-line',
          role: S6A_WORK_ROLE, tasks });
        const card = await world.readSession(created.ref);
        const line: S6ASession = { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
          role: structuredClone(card.record.role), createdAt: card.record.createdAt };
        await world.scripted.script(line, [
          { kind: 'calls', calls: [{ callId: 's7a2-ack-lost-result', name: 'edit', args: { mode: 'create',
            path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
          { kind: 'text', text: 'S7A2 ack recheck lost: the work is done' }]);
        const message = await sendS7A2PersonMessage(world, { label: 'ack-reverify-lost', recipient: line.ref });
        const runCheck = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
          flowId: 's7a2-ack-reverify-lost', sessionHint: line.ref, kind: 'select_work' as const,
          taskId: tasks[0]!.taskId }, 'run_check');
        await writeFile(join(world.ag2b.root, 'src', 'module.ts'),
          'export const ag2bMarker = "S7A2_LOST_SOURCE_CHANGED_AFTER_OPEN";\n');
        const checked = await post<WorkflowAdvanceResult>(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, runCheck));
        if (checked.status !== 'ready' || checked.value.next === null) throw new Error('the Workflow must finalize');
        const finalizeCall = await post<WorkflowAdvanceResult>(world.ag2b, 'workflow/advance',
          plain(S6A_SCOPE, checked.value.next));
        if (finalizeCall.status !== 'ready') throw new Error('the Workflow call was not ready');
        const reverifyStep = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal,
          flowId: 's7a2-ack-reverify-lost-2', sessionHint: line.ref, kind: 'select_work' as const,
          taskId: tasks[0]!.taskId }, 'reverify_round');
        if (reverifyStep.kind !== 'perform' || reverifyStep.operation.kind !== 'reverify_round') {
          throw new Error(`S7A2: the Workflow did not stop at reverify_round: ${reverifyStep.kind}`);
        }
        const acknowledged = { ...reverifyStep.operation.request,
          input: { ...reverifyStep.operation.request.input, acknowledgement: message.ref } };
        // The recheck commits; its result is not read.
        await world.post('verification/reverify', { scope: S6A_SCOPE, request: acknowledged });
        await world.crash();
        const replayedShell = await world.post('verification/reverify', { scope: S6A_SCOPE, request: acknowledged });
        expect(replayedShell.body).toMatchObject({ status: 'committed', replayed: true });
        const replayed = replayedShell.body as EffectWriteResultV1<ReverifyOutcomeV1>;
        if (replayed.status !== 'committed') throw new Error(`the replayed recheck is ${replayed.code}`);
        expect(replayed.proofReceipt).toEqual({ identityKey: expect.any(String), fingerprint: expect.any(String),
          cursor: replayed.cursor });
        expect(replayed.proofReceipt?.identityKey.length).toBeGreaterThan(0);
        expect(replayed.proofReceipt?.fingerprint.length).toBeGreaterThan(0);
        return;
      }
      const world = await openS6AHostWorld({ backend: 'sqlite' });
      worlds.push(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, main, world.goals);
      const goal = (await main.createGoal('s7a2-ack-propose-lost-goal', 'S7A2 ack proposal lost goal')).ref;
      const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a2-ack-propose-lost',
        taskIds: ['s7a2-ack-propose-lost-1'], role: S6A_WORK_ROLE.templateId });
      const created = await createS6BLine(main, { label: 's7a2-ack-propose-lost-line', role: S6A_WORK_ROLE, tasks });
      const current = await main.activePlan(goal);
      if (current === null) throw new Error('S7A2_PRECONDITION: the Goal has no adopted Plan to move from');
      const workIds = current.tasks.filter(task => task.taskKind === 'work').map(task => task.taskId);
      const draft = { ...ag2bPlanDraft(workIds), planId: 's7a2-ack-lost-plan', goalId: goal.goalId,
        planRevision: current.planRevision + 1 };
      const message = await sendS7A2PersonMessage(world, { label: 'ack-propose-lost', recipient: created.ref });
      const request = graphWrite(S6A_SCOPE, { goalRef: goal, basedOn: current.ref, draft,
        reason: { text: 'S7A2 ack lost proposal', sources: [] }, acknowledgement: message.ref },
      's7a2-ack-propose-lost-1', []);
      // The proposal commits; its result is not read.
      await world.post('plans/propose', request);
      await world.crash();
      const replayedShell = await world.post('plans/propose', request);
      const replayed = replayedShell.body as WriteResult<PlanProposal>;
      expect(replayed).toMatchObject({ status: 'committed', replayed: true });
      if (replayed.status !== 'committed') throw new Error(`the replayed proposal is ${replayed.code}`);
      expect((replayed as { proofReceipt?: unknown }).proofReceipt).toEqual({ identityKey: expect.any(String),
        fingerprint: expect.any(String), cursor: replayed.cursor });
      const receipt = (replayed as { proofReceipt?: { identityKey: string; fingerprint: string } }).proofReceipt;
      expect(receipt?.identityKey.length).toBeGreaterThan(0);
      expect(receipt?.fingerprint.length).toBeGreaterThan(0);
    });
});
