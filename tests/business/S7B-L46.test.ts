/**
 * G-L46 (SR8 §8.2.3/§8.2.4, book-7b.md:788-:812, §5 :1228; P-20): the L46 pre-pass on TE8.
 * Every prior state is a public step (the TE8 world, `workflow/advance`, `decisions/queue`/`card`/`answer`);
 * no record, card or context is built and nothing is read from the store.
 *
 * Stopped case (no public refusal input exists; see the report):
 * - refusal (`answered_no_application`): `decisions/answer` cannot produce it — the automation card's `options` is
 *   empty and `selection.kind === 'other'` always sets `requiresApplication: true`
 *   (`src/core/work-graph/communication/decision-service.ts:574-580`), so no real refusal input exists.
 * The explicit-C case is folded into case 1: it is the same named-C assertion.
 */
import { afterEach, expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { ready } from '../helpers/S7A-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import {
  adoptL46Plan, applyL46Card, openS7BL46World, readL46Card, selectedL46Task,
} from '../helpers/S7B-L46-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

type AdvanceValue = Extract<WorkflowAdvanceResult, { status: 'ready' }>['value'];

const advance = async (world: S6AHostWorld, goalRef: GoalRef,
  input: { flowId: string; kind: 'select_work'; taskId?: string }) =>
  ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, {
    schemaVersion: 1, goalRef, sessionHint: null, ...input,
  })), `the L46 advance ${input.flowId}`);

const selectGoal = async (world: S6AHostWorld, goalRef: GoalRef, flowId: string) =>
  advance(world, goalRef, { flowId, kind: 'select_work' });

const selectNamed = async (world: S6AHostWorld, goalRef: GoalRef, taskId: string, flowId: string) =>
  advance(world, goalRef, { flowId, kind: 'select_work', taskId });

/** The public line responsible for a Task: `sessions/list` + the card's `responsible` link. */
async function responsibleLine(world: S6AHostWorld, taskId: string): Promise<S6ASession | null> {
  for (const card of await world.listSessions()) {
    const responsible = card.links.some(link => (link.until ?? null) === null && link.ref.relation === 'responsible'
      && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === taskId);
    if (!responsible) continue;
    return { label: `L46 ${taskId}`, ref: { projectId: card.record.ref.projectId,
      sessionId: card.record.ref.sessionId }, aggregateRef: card.record.ref, role: card.record.role,
    createdAt: card.record.createdAt };
  }
  return null;
}

/**
 * Drives the goal scope (the `next` chain) until it settles. B and D are scripted to answer as soon as their
 * line exists, so the drive reaches the all-blocked exit instead of a model failure. Returns the selections seen.
 */
async function driveGoal(world: S6AHostWorld, goalRef: GoalRef, flowId: string,
  stop?: (selections: readonly string[]) => boolean):
  Promise<{ selections: string[]; value: AdvanceValue }> {
  await world.scripted.script((await responsibleLine(world, 's7b3-b'))!, [{ kind: 'text', text: 'S7B3 B done' }]);
  let input: WorkflowAdvanceInput = { schemaVersion: 1, goalRef, sessionHint: null, flowId, kind: 'select_work' };
  const selections: string[] = [];
  let dScripted = false;
  for (let guard = 0; guard < 48; guard += 1) {
    const value: AdvanceValue = ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, input)),
      'the L46 goal advance');
    const selected = selectedL46Task(value.next);
    if (selected !== null) selections.push(selected);
    if (!dScripted) { const line = await responsibleLine(world, 's7b3-d'); if (line !== null) { await world.scripted.script(line, [{ kind: 'text', text: 'S7B3 D done' }]); dScripted = true; } }
    if (stop?.(selections) === true) return { selections, value };
    if (value.state !== 'advance' || value.next === null) return { selections, value };
    input = value.next;
  }
  throw new Error('S7B3 L46: the goal did not settle');
}

/** One goal, four Tasks, A's failed Run and its card: the default world. */
async function openDefault() {
  const opened = await openS7BL46World({ backend: 'memory' });
  worlds.push(opened.world);
  return opened;
}

it('four tasks: goal scope selects B and D while A and C wait; named A returns the gate and named C waits on A',
  async () => {
    const { world, goalRef, tasks } = await openDefault();
    const card = await readL46Card(world, goalRef);
    const gate = await selectNamed(world, goalRef, tasks.A.taskId, 'l46-four-a');
    expect(gate).toMatchObject({ state: 'waiting', receipt: null, next: null,
      reason: 'automation_confirmation_required:system_requeue' });
    expect(gate.decisionCause?.source.key).toBe(card.source.key);

    const c = await selectNamed(world, goalRef, tasks.C.taskId, 'l46-four-c');
    expect(c).toMatchObject({ state: 'waiting', receipt: null, next: null,
      reason: 'l46_dependency_blocked: the Task s7b3-c waits on s7b3-a',
      source: gate.decisionCause?.source });

    const { selections } = await driveGoal(world, goalRef, 'l46-four-goal',
      seen => seen.includes('s7b3-d'));
    expect(selections).toContain('s7b3-b');
    expect(selections).toContain('s7b3-d');
    expect(selections.filter(entry => entry === 's7b3-a' || entry === 's7b3-c')).toEqual([]);
  }, 120_000);

it('an answered-not-applied card still blocks A and C on the next advance', async () => {
  const { world, goalRef, tasks } = await openDefault();
  const { card, resolution } = await applyL46Card(world, { goalRef, label: 'answered' });
  expect(resolution.state).toBe('answered');
  const queue = ready<{ answeredPendingApplication: DecisionCardV1[] }>(
    await world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE, goalRef,
      sections: ['answered_pending_application'], page: { limit: 100 } })), 'the answered L46 queue');
  expect(queue.answeredPendingApplication.find(entry => entry.source.key === card.source.key))
    .toMatchObject({ state: 'answered_pending_application' });

  const a = await selectNamed(world, goalRef, tasks.A.taskId, 'l46-answered-a');
  expect(a).toMatchObject({ state: 'waiting', reason: 'automation_confirmation_required:system_requeue' });
  expect(a.decisionCause?.source.key).toBe(card.source.key);
  const c = await selectNamed(world, goalRef, tasks.C.taskId, 'l46-answered-c');
  expect(c).toMatchObject({ state: 'waiting',
    reason: 'l46_dependency_blocked: the Task s7b3-c waits on s7b3-a' });
});

it('a confirmed automatic rework: the covering requeue releases the block and the next advance selects A', async () => {
  const { world, goalRef, tasks, run } = await openDefault();
  const { requeue } = await applyL46Card(world, { goalRef, label: 'applied',
    apply: { taskRef: tasks.A, run } });
  expect(requeue).toMatchObject({ status: 'committed' });

  const next = await selectNamed(world, goalRef, tasks.A.taskId, 'l46-applied-a');
  expect(next.state).toBe('advance');
  expect(selectedL46Task(next.next)).toBe('s7b3-a');
}, 120_000);

it('all blocked: the Goal waits with the block root A and the merged basis', async () => {
  const { world, goalRef } = await openDefault();
  const { value } = await driveGoal(world, goalRef, 'l46-all-blocked');
  expect(value).toMatchObject({ state: 'waiting', receipt: null, next: null, reason: 'l46_blocked: s7b3-a' });
  const basis = value.waitBasis;
  if (basis === undefined) throw new Error('S7B3 L46: the all-blocked wait carries no basis');
  expect(basis.projectId).toBe(goalRef.projectId);
  expect(basis.goalId).toBe(goalRef.goalId);
  expect(basis.recordKinds.length).toBeGreaterThan(0);
  expect(basis.reasons.length).toBeGreaterThan(0);
}, 120_000);

it('a moved Plan revision recomputes the same block and keeps A blocked (the replaced-source reselect is unproven)',
  async () => {
    const { world, goalRef, tasks } = await openDefault();
    const card = await readL46Card(world, goalRef);
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const moved = await adoptL46Plan(ws, goalRef, { planId: 's7b3-l46-plan-moved', label: 'moved' });
    expect(moved.planRevision).toBeGreaterThan(1);

    // The source key carries no Plan revision; the cause is re-derived from the unchanged TaskRow failure.
    const reread = ready<DecisionCardV1>(await world.post('decisions/card', plain(S6A_SCOPE, { source: card.source })),
      'the L46 card after the moved Plan');
    expect(reread).toMatchObject({ cardKey: card.cardKey, state: 'waiting_answer' });
    const a = await selectNamed(world, goalRef, tasks.A.taskId, 'l46-moved-a');
    expect(a).toMatchObject({ state: 'waiting', receipt: null, next: null,
      reason: 'automation_confirmation_required:system_requeue' });
    expect(a.decisionCause?.source.key).toBe(card.source.key);
    // The replaced-source reselect is unproven: no public plan move in this tree changes A's failure facts
    // without also removing/replacing A; a move that leaves A in place keeps the same card and block.
  }, 120_000);

it('legacy exact artifact on D: goal scope selects B and never D; named D waits on A through the upstream read',
  async () => {
    const opened = await openS7BL46World({ backend: 'memory', legacyOnD: true });
    worlds.push(opened.world);
    const { world, goalRef, tasks } = opened;
    const gate = await selectNamed(world, goalRef, tasks.A.taskId, 'l46-legacy-a');
    expect(gate).toMatchObject({ state: 'waiting', reason: 'automation_confirmation_required:system_requeue' });

    const b = await selectGoal(world, goalRef, 'l46-legacy-goal');
    expect(b.state).toBe('advance');
    expect(selectedL46Task(b.next)).toBe('s7b3-b');

    const d = await selectNamed(world, goalRef, tasks.D.taskId, 'l46-legacy-d');
    expect(d).toMatchObject({ state: 'waiting', receipt: null, next: null,
      reason: 'l46_dependency_blocked: the Task s7b3-d waits on s7b3-a',
      source: gate.decisionCause?.source });
  }, 120_000);
